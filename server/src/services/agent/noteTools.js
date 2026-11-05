import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { NoteCollection, Notebook, Note, Media, AgentBatch } from '../../models/index.js';
import { roleOf } from '../accessService.js';
import * as notes from '../noteService.js';
import * as media from '../mediaService.js';
import { fetchImage } from '../fetchImage.js';
import { AppError, assert, toAppError } from '../../utils/errors.js';
import { notebookSchema, noteSchema, notePatchSchema, agentImageUrl } from '../../middleware/validate.js';
import { AGENT_LIMITS, CONDITIONAL_SCOPES, TOOL_SCOPES } from '../../../../shared/agent.js';
import { NOTE_LIMITS, clampWidth, embedLine, embedsIn, snippetOf } from '../../../../shared/notes.js';
import { allows, requireImageQuota, requireScope } from './tokens.js';

/**
 * What a connected assistant can do in the Notes tab.
 *
 * It follows the rules the flashcard tools follow, for the same reasons. The default is additive:
 * an assistant may start a notebook, start a page and add to the end of one, and none of that can
 * remove a word a person wrote. Rewriting an existing page is a separate permission nobody gets
 * unless they asked for it. There is no delete tool and nothing here can share or publish.
 *
 * Writes go through the same checks a person's save does — the notebook's role, the archived
 * check, the limits, and the rule that a picture on a page must belong to its notebook — and are
 * made safe to retry with a request id and recorded as a batch, so the person can see what an
 * assistant did and undo what it created. Anything that changes a page that already exists first
 * keeps what it said, so "Earlier versions" can put it back.
 */

/** Swapped by tests, which have no network to fetch a picture from. */
export const deps = { fetchImage };

const NO_PAGE = 'That page was not found, or you do not have access to it.';
const NO_NOTEBOOK = 'That notebook was not found, or you do not have access to it.';
const escapeRx = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const oid = id => new mongoose.Types.ObjectId(String(id));
const fingerprint = (tool, value) => crypto.createHash('sha256').update(JSON.stringify([tool, value])).digest('hex');
const refusal = (status, message, code, result) => new AppError(status, message, code, { details: { result } });

const unify = (code, message) => e => { throw toAppError(e).status === 404 ? new AppError(404, message, code) : e; };

function requireRequestId(requestId) {
  const id = String(requestId ?? '').trim();
  assert(id, 400, 'Send a requestId — a fresh random string per call, reused only when retrying the same call.');
  assert(id.length <= AGENT_LIMITS.requestIdLength, 400, `Keep the requestId under ${AGENT_LIMITS.requestIdLength} characters.`);
  return id;
}

function replayOf(done, print) {
  if (done.fingerprint !== print) {
    throw new AppError(409, 'That requestId was already used for a different request. Use a new requestId for new content; reuse one only to retry exactly the same call.', 'REQUEST_ID_REUSED');
  }
  return { ...done.result, replayed: true };
}

/**
 * Text an assistant writes into a page is untrusted, and a page is read in a browser. Pictures in a
 * page are only ever this notebook's own (`media:` / `drawing:` lines, checked on save). A link to a
 * picture somewhere else would make the reader's browser fetch an address the writer chose — a
 * tracking pixel, or a way to carry the page's contents out in the URL — so it is refused, along
 * with raw HTML that loads things. Plain links and everything else Markdown does are fine.
 */
const LOADS_REMOTE = [
  [/!\[[^\]]*\]\((?!\s*(?:media|drawing):)/i, 'Pictures cannot be linked from an address inside page text. Use add_image_to_page to put a picture on a page.'],
  [/!\[[^\]]*\]\[/, 'Reference-style image links are not allowed in page text. Use add_image_to_page to put a picture on a page.'],
  [/<\s*(?:img|picture|source|video|audio|iframe|object|embed|link|svg|form|input|script|style)\b/i, 'Raw HTML that loads content is not allowed in page text. Write Markdown instead.'],
];
export function assertSafeText(text) {
  for (const [rx, message] of LOADS_REMOTE) assert(!rx.test(text), 400, message, 'UNSAFE_CONTENT');
}

/** Today's use, counted from the batches so undoing one gives it back. */
async function usage(userId) {
  const since = new Date(); since.setUTCHours(0, 0, 0, 0);
  const rows = await AgentBatch.aggregate([
    { $match: { user: oid(userId), createdAt: { $gte: since }, undoneAt: null, kind: { $in: ['notes', 'noteedit'] } } },
    { $group: { _id: '$kind', pages: { $sum: '$pageCount' }, notebooks: { $sum: { $cond: ['$createdNotebook', 1, 0] } }, edits: { $sum: 1 } } },
  ]);
  const made = rows.find(r => r._id === 'notes');
  const edited = rows.find(r => r._id === 'noteedit');
  return { pages: made?.pages || 0, notebooks: made?.notebooks || 0, edits: edited?.edits || 0 };
}
async function requireRoom(userId, { pages = 0, notebooks = 0, edits = 0 }) {
  const u = await usage(userId);
  assert(u.pages + pages <= AGENT_LIMITS.pagesPerDay, 429, `That would take today's assistant total past ${AGENT_LIMITS.pagesPerDay} new pages. It resets at midnight UTC, and undoing a batch gives it back.`, 'AGENT_QUOTA');
  assert(u.notebooks + notebooks <= AGENT_LIMITS.notebooksPerDay, 429, `That would take today's assistant total past ${AGENT_LIMITS.notebooksPerDay} new notebooks. It resets at midnight UTC, and undoing a batch gives it back.`, 'AGENT_QUOTA');
  assert(u.edits + edits <= AGENT_LIMITS.pageEditsPerDay, 429, `That would take today's assistant total past ${AGENT_LIMITS.pageEditsPerDay} page changes. It resets at midnight UTC.`, 'AGENT_QUOTA');
}

/**
 * Write the batch row in the same transaction as the change it describes, so a crash cannot leave
 * a change nobody can see or undo, nor a retry that duplicates it. Losing the race on the unique
 * request id means a concurrent retry won, and its answer is the answer.
 */
async function recorded(user, grant, { requestId, print, kind, fields = {} }, work) {
  try {
    return await mongoose.connection.transaction(async session => {
      const { result, batch = {} } = await work(session);
      await AgentBatch.create([{
        user: user.id, token: grant?._id ?? null, tokenName: grant?.name || '', requestId, fingerprint: print, kind, result, ...fields, ...batch,
      }], { session });
      return result;
    });
  } catch (e) {
    if (e?.code === 11000 || e?.cause?.code === 11000) {
      const winner = await AgentBatch.findOne({ user: user.id, requestId });
      if (winner) return replayOf(winner, print);
    }
    throw e;
  }
}

/* Reading */

async function writableCollections(user) {
  const rows = await NoteCollection.find({ $or: [{ owner: user.id }, { members: { $elemMatch: { user: user.id, role: 'editor' } } }] }).sort({ updatedAt: -1 }).limit(AGENT_LIMITS.notebooksListed).select('title owner members').lean();
  return rows.map(c => ({ id: String(c._id), title: c.title }));
}

export async function listNotebooks(user, { query = '' } = {}) {
  const filter = { ...(await notes.visibleTo(user)), archived: false };
  if (query.trim()) filter.title = { $regex: escapeRx(query.trim()), $options: 'i' };
  const rows = await Notebook.find(filter).sort({ updatedAt: -1 }).limit(AGENT_LIMITS.notebooksListed);
  const shown = await notes.presentNotebooks(rows, user);
  return {
    notebooks: shown.map(n => ({
      id: n.id, title: n.title, description: n.description || undefined, pages: n.noteCount, role: n.role,
      ...(n.collection ? { collection: n.collection.title } : {}),
    })),
    collections: await writableCollections(user),
  };
}

export async function searchPages(user, { query = '', notebookId = null, tags = [] } = {}) {
  const text = String(query || '').trim();
  const wanted = [...new Set((Array.isArray(tags) ? tags : []).map(t => String(t).trim().toLowerCase().replace(/^#/, '')).filter(Boolean))];
  assert(wanted.length <= AGENT_LIMITS.searchTags, 400, `Search with at most ${AGENT_LIMITS.searchTags} tags at once.`);
  assert(text.length >= 2 || wanted.length, 400, 'Give search text of at least two characters, or at least one tag.');
  const books = notebookId
    ? [await notes.accessNotebook(notebookId, user).catch(unify('NOTEBOOK_NOT_FOUND', NO_NOTEBOOK))]
    : await Notebook.find({ ...(await notes.visibleTo(user)), archived: false }).select('_id title');
  if (!books.length) return { matches: [] };
  const titles = new Map(books.map(b => [String(b._id), b.title]));
  const filter = { notebook: { $in: books.map(b => b._id) } };
  if (text) { const rx = { $regex: escapeRx(text), $options: 'i' }; filter.$or = [{ title: rx }, { body: rx }]; }
  if (wanted.length) filter.tags = { $all: wanted };
  const rows = await Note.find(filter).select('title body tags notebook version').sort({ updatedAt: -1 }).limit(AGENT_LIMITS.searchResults + 1).lean();
  return {
    matches: rows.slice(0, AGENT_LIMITS.searchResults).map(n => ({
      id: String(n._id), notebookId: String(n.notebook), notebook: titles.get(String(n.notebook)) || '',
      title: n.title, snippet: snippetOf(n.body).slice(0, 160), tags: n.tags || [], version: n.version ?? 0,
    })),
    ...(rows.length > AGENT_LIMITS.searchResults ? { more: true } : {}),
  };
}

/** The page and the notebook it sits in, as someone who can at least read it, with one answer for "missing" and "not yours". */
async function pageFor(user, pageId, level = 'viewer') {
  assert(mongoose.isValidObjectId(pageId), 404, NO_PAGE, 'PAGE_NOT_FOUND');
  const note = await Note.findById(pageId);
  assert(note, 404, NO_PAGE, 'PAGE_NOT_FOUND');
  const notebook = await notes.accessNotebook(note.notebook, user, level).catch(unify('PAGE_NOT_FOUND', NO_PAGE));
  return { note, notebook };
}

export async function getPage(user, grant, { pageId }) {
  const { note, notebook } = await pageFor(user, pageId);
  const role = notebook.$locals.role;
  const canWrite = (role === 'owner' || role === 'editor') && !notebook.archived;
  const pictures = embedsIn(note.body).map(e => ({ kind: e.kind, caption: e.caption || undefined, ...(e.width ? { width: e.width } : {}) }));
  return {
    id: String(note._id), notebookId: String(notebook._id), notebook: notebook.title,
    title: note.title, tags: note.tags || [], version: note.version ?? 0, updatedAt: note.updatedAt,
    body: note.body,
    ...(pictures.length ? { pictures } : {}),
    // What this connection could do to it, so an assistant can say so instead of trying.
    canAppend: canWrite && allows(grant, TOOL_SCOPES.append_to_page),
    canRewrite: canWrite && allows(grant, TOOL_SCOPES.update_page),
  };
}

/* Writing: new notebooks and pages */

export async function createNotebook(user, grant, { collectionId = '', requestId, ...input }) {
  const body = notebookSchema.parse({ title: input.title, description: input.description, color: input.color, icon: input.icon });
  const id = requireRequestId(requestId);
  const print = fingerprint('create_notebook', { collectionId: String(collectionId || ''), body });
  const done = await AgentBatch.findOne({ user: user.id, requestId: id });
  if (done) return replayOf(done, print);
  await requireRoom(user.id, { notebooks: 1 });

  let collection;
  if (collectionId) {
    collection = await notes.accessCollection(collectionId, user, 'editor').catch(unify('COLLECTION_NOT_FOUND', 'That collection was not found, or you do not have access to it.'));
  } else {
    // No collection named: the person's own first one, or a home for it if they have none yet.
    collection = await NoteCollection.findOne({ owner: user.id }).sort({ createdAt: 1 })
      || await NoteCollection.create({ title: 'My notebooks', owner: user.id });
  }
  const owned = await Notebook.countDocuments({ owner: collection.owner });
  assert(owned < NOTE_LIMITS.notebooksPerUser, 409, `A person can have up to ${NOTE_LIMITS.notebooksPerUser} notebooks.`, 'NOTEBOOK_LIMIT');

  return recorded(user, grant, { requestId: id, print, kind: 'notes' }, async session => {
    const [created] = await Notebook.create([{ ...body, owner: collection.owner, noteCollection: collection._id }], { session });
    await NoteCollection.updateOne({ _id: collection._id }, { $set: { updatedAt: new Date() } }, { session, timestamps: false });
    return {
      result: { notebookId: created.id, title: created.title, collection: collection.title, pages: 0 },
      batch: { notebook: created._id, notebookTitle: created.title, createdNotebook: true, pageCount: 0 },
    };
  });
}

export async function createPage(user, grant, { notebookId, title = '', body = '', tags = [], requestId }) {
  const input = noteSchema.parse({ title, body, tags });
  assertSafeText(input.body);
  const id = requireRequestId(requestId);
  const print = fingerprint('create_page', { notebookId: String(notebookId), input });
  const done = await AgentBatch.findOne({ user: user.id, requestId: id });
  if (done) return replayOf(done, print);
  await requireRoom(user.id, { pages: 1 });

  const notebook = await notes.accessNotebook(notebookId, user, 'editor').catch(unify('NOTEBOOK_NOT_FOUND', NO_NOTEBOOK));
  notes.writable(notebook);
  const count = await Note.countDocuments({ notebook: notebook._id });
  assert(count < NOTE_LIMITS.notesPerNotebook, 409, `A notebook can hold up to ${NOTE_LIMITS.notesPerNotebook} pages. Start another notebook.`, 'NOTE_LIMIT');
  await notes.verifyEmbeds(notebook._id, input.body);

  return recorded(user, grant, { requestId: id, print, kind: 'notes' }, async session => {
    const [page] = await Note.create([{ ...input, notebook: notebook._id, createdBy: user.id, updatedBy: user.id }], { session });
    await Notebook.updateOne({ _id: notebook._id }, { $currentDate: { updatedAt: true } }, { session });
    return {
      result: { pageId: page.id, notebookId: notebook.id, notebook: notebook.title, title: page.title, version: page.version, chars: page.body.length },
      batch: { notebook: notebook._id, notebookTitle: notebook.title, notes: [page._id], pageCount: 1 },
    };
  });
}

/* Writing: changing a page that exists */

const STALE = new Error('The page changed while it was being written.');

/** The 409 an assistant gets when the page moved on, with the page as it now is, to show the person. */
async function conflictFor(pageId, expectedVersion, draft) {
  const latest = await Note.findById(pageId).lean();
  const current = latest ? { id: String(latest._id), title: latest.title, tags: latest.tags || [], body: latest.body, version: latest.version ?? 0 } : null;
  return refusal(409,
    `This page has changed since version ${expectedVersion} was read${current ? ` and is now at version ${current.version}` : ''}. Nothing was saved. Show the person the current page and your draft, and only try again with the new version if they still want the change.`,
    'VERSION_CONFLICT', { status: 409, pageId: String(pageId), expectedVersion, currentVersion: current?.version ?? null, current, draft });
}

/**
 * Add text to the end of a page, or a picture.
 *
 * Appending commutes with whatever else is being written, so unlike a rewrite it need not name a
 * version: if someone saved in between, it reads the page again and adds to that, a few times,
 * rather than failing a call that could never have overwritten anything. It still keeps the
 * previous text in the page's history, still checks the limits, and is recorded in the same
 * transaction as the change.
 */
async function appendTo(user, grant, { pageId, requestId, print, expectedVersion, prepare }) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { note, notebook } = await pageFor(user, pageId, 'editor');
    notes.writable(notebook);
    if (expectedVersion !== undefined && note.version !== expectedVersion) throw await conflictFor(pageId, expectedVersion, {});
    try {
      return await recorded(user, grant, { requestId, print, kind: 'noteedit', fields: { notebook: notebook._id, notebookTitle: notebook.title, notes: [note._id] } }, async session => {
        const { text, batch = {}, extra = {} } = await prepare({ note, notebook, session });
        const next = note.body ? `${note.body.replace(/\s+$/, '')}\n\n${text}` : text;
        assert(next.length <= NOTE_LIMITS.body, 400, `That would make the page longer than ${NOTE_LIMITS.body.toLocaleString('en')} characters (${Math.max(0, NOTE_LIMITS.body - note.body.length).toLocaleString('en')} left). Put the rest on a new page with create_page.`, 'PAGE_FULL');
        await notes.verifyEmbeds(notebook._id, next, note.body, session);
        await notes.snapshot(note, { via: 'assistant', user, byName: grant?.name || 'An assistant', force: true, session });
        const saved = await Note.findOneAndUpdate({ _id: note._id, version: note.version }, { $set: { body: next, updatedBy: user.id }, $inc: { version: 1 } }, { new: true, session });
        if (!saved) throw STALE;
        await Notebook.updateOne({ _id: notebook._id }, { $currentDate: { updatedAt: true } }, { session });
        return { result: { pageId: String(saved._id), notebook: notebook.title, version: saved.version, chars: saved.body.length, ...extra }, batch };
      });
    } catch (e) {
      if (e !== STALE) throw e;
    }
  }
  throw new AppError(409, 'This page is being changed by someone else right now. Wait a moment and try again.', 'PAGE_BUSY');
}

export async function appendToPage(user, grant, { pageId, text, requestId, expectedVersion }) {
  const added = String(text ?? '').trim();
  assert(added, 400, 'Send the text to add.');
  assert(added.length <= NOTE_LIMITS.body, 400, `Send at most ${NOTE_LIMITS.body.toLocaleString('en')} characters at once.`);
  assertSafeText(added);
  const id = requireRequestId(requestId);
  const print = fingerprint('append_to_page', { pageId: String(pageId), added, expectedVersion: expectedVersion ?? null });
  const done = await AgentBatch.findOne({ user: user.id, requestId: id });
  if (done) return replayOf(done, print);
  await requireRoom(user.id, { edits: 1 });
  return appendTo(user, grant, { pageId, requestId: id, print, expectedVersion, prepare: async () => ({ text: added }) });
}

const nameFromUrl = url => { try { return decodeURIComponent(new URL(url).pathname.split('/').pop() || '').slice(0, 150); } catch { return ''; } };

export async function addImageToPage(user, grant, { pageId, imageUrl, caption = '', width, requestId }) {
  const url = agentImageUrl.parse(imageUrl);
  assert(url, 400, 'Give the https address of an image to add.');
  requireScope(grant, CONDITIONAL_SCOPES.add_image_to_page.images);
  const id = requireRequestId(requestId);
  const note = String(caption ?? '').replace(/[\]\n\r]/g, ' ').trim().slice(0, 200);
  const wide = width == null || width === '' ? null : clampWidth(width);
  const print = fingerprint('add_image_to_page', { pageId: String(pageId), url, caption: note, width: wide });
  const done = await AgentBatch.findOne({ user: user.id, requestId: id });
  if (done) return replayOf(done, print);

  // Everything that can refuse runs before the fetch, so naming a page this account cannot write to
  // cannot be used to make the server request an address and throw the answer away.
  const { note: page, notebook } = await pageFor(user, pageId, 'editor');
  notes.writable(notebook);
  assert(embedsIn(page.body).filter(e => e.kind === 'media').length < NOTE_LIMITS.imagesPerNote, 409, `A page can hold up to ${NOTE_LIMITS.imagesPerNote} images.`, 'TOO_MANY_IMAGES');
  await requireRoom(user.id, { edits: 1 });
  await requireImageQuota(user.id, 1);
  const image = await media.ingest((await deps.fetchImage(url)).body);

  return appendTo(user, grant, {
    pageId, requestId: id, print,
    prepare: async ({ notebook: book, session }) => {
      const stored = await Media.countDocuments({ notebook: book._id }).session(session);
      const { media: row, reused } = await media.persist(image, { notebook: book._id, user: user.id, sourceUrl: url, name: nameFromUrl(url), session });
      assert(reused || stored < NOTE_LIMITS.imagesPerNotebook, 409, `A notebook can hold up to ${NOTE_LIMITS.imagesPerNotebook} images.`, 'IMAGE_LIMIT');
      return {
        text: embedLine('media', String(row._id), note, wide),
        batch: { media: reused ? [] : [row._id], imageCount: reused ? 0 : 1 },
        extra: { image: 'added', width: image.width, height: image.height },
      };
    },
  });
}

/**
 * Replace parts of a page that exists, if it is still the page the assistant read.
 *
 * A patch, with the same version rule as a person's save: a page someone has changed since is
 * refused with both versions, so a model working from a stale copy never overwrites a person.
 * Pictures and drawings on the page are the person's and cannot be dropped by a rewrite that
 * forgot to copy their lines; what the page said is kept in its history first.
 */
export async function updatePage(user, grant, { pageId, expectedVersion, title, body, tags, dryRun = false }) {
  assert(Number.isInteger(expectedVersion) && expectedVersion >= 0, 400, 'Send expectedVersion: the version get_page returned for this page.');
  const sent = Object.fromEntries(Object.entries({ title, body, tags }).filter(([, v]) => v !== undefined));
  assert(Object.keys(sent).length, 400, 'Send at least one of title, body or tags to change.');
  const patch = notePatchSchema.parse({ ...sent, version: expectedVersion });
  delete patch.version;
  if (patch.body !== undefined) assertSafeText(patch.body);

  const { note, notebook } = await pageFor(user, pageId, 'editor');
  notes.writable(notebook);
  const changed = [];
  if (patch.title !== undefined && patch.title !== note.title) changed.push('title');
  if (patch.body !== undefined && patch.body !== note.body) changed.push('body');
  if (patch.tags !== undefined && JSON.stringify(patch.tags) !== JSON.stringify(note.tags || [])) changed.push('tags');

  if (note.version !== expectedVersion) {
    // A retry of a change that already went through: the page is one version on and already says it.
    if (note.version === expectedVersion + 1 && !changed.length) return { pageId: String(note._id), version: note.version, changed: [], replayed: true };
    throw await conflictFor(pageId, expectedVersion, patch);
  }
  if (!changed.length) return { pageId: String(note._id), version: note.version, changed: [], unchanged: true };

  if (patch.body !== undefined) {
    const keep = new Set(embedsIn(patch.body).map(e => `${e.kind}:${e.id}`));
    const lost = embedsIn(note.body).filter(e => !keep.has(`${e.kind}:${e.id}`));
    if (lost.length) {
      throw refusal(400, `This rewrite would remove ${lost.length} picture or drawing line${lost.length === 1 ? '' : 's'} from the page, which an assistant may not do. Copy these lines into the new text exactly as they are and send it again: ${lost.map(e => `![${e.caption || ''}](${e.kind}:${e.id})`).join(' ')}`,
        'REMOVES_PICTURES', { pageId: String(note._id), keep: lost.map(e => `![${e.caption || ''}](${e.kind}:${e.id})`) });
    }
    await notes.verifyEmbeds(notebook._id, patch.body, note.body);
  }
  if (dryRun) {
    return {
      dryRun: true, pageId: String(note._id), version: note.version, nextVersion: note.version + 1, changed,
      ...(changed.includes('body') ? { chars: { before: note.body.length, after: patch.body.length } } : {}),
    };
  }
  await requireRoom(user.id, { edits: 1 });

  return recorded(user, grant, {
    requestId: `noteedit:${note._id}:${note.version}`, print: fingerprint('update_page', { pageId: String(pageId), patch }), kind: 'noteedit',
    fields: { notebook: notebook._id, notebookTitle: notebook.title, notes: [note._id] },
  }, async session => {
    await notes.snapshot(note, { via: 'assistant', user, byName: grant?.name || 'An assistant', force: true, session });
    const saved = await Note.findOneAndUpdate({ _id: note._id, version: note.version }, { $set: { ...patch, updatedBy: user.id }, $inc: { version: 1 } }, { new: true, session });
    if (!saved) throw await conflictFor(pageId, expectedVersion, patch);
    await Notebook.updateOne({ _id: notebook._id }, { $currentDate: { updatedAt: true } }, { session });
    return { result: { pageId: String(saved._id), previousVersion: expectedVersion, version: saved.version, changed, chars: saved.body.length } };
  }).catch(async e => {
    // Two edits at the same version collide on the audit row's id: the loser has been overtaken,
    // which is a conflict like any other, not a reused request id.
    if (toAppError(e).code === 'REQUEST_ID_REUSED') throw await conflictFor(pageId, expectedVersion, patch);
    throw e;
  });
}

/**
 * Undo a batch that created notebooks or pages: remove what it made, and nothing else.
 *
 * Pages go one by one through the ordinary delete, so their pictures and drawings are cleaned up
 * exactly as when a person deletes them. A notebook the batch created is only removed if it is
 * empty by then; if the person has since put pages in it, it stays, and the reply says so.
 */
export async function undoNotesBatch(user, batch) {
  let removed = 0, kept = 0;
  for (const id of batch.notes || []) {
    try { await notes.deleteNote(String(id), user); removed += 1; }
    catch (e) { if (toAppError(e).status !== 404) kept += 1; }
  }
  let notebookRemoved = false;
  if (batch.createdNotebook && batch.notebook) {
    const book = await Notebook.findById(batch.notebook).select('title').lean();
    if (book && !(await Note.exists({ notebook: book._id }))) {
      try { await notes.deleteNotebook(String(book._id), user, book.title); notebookRemoved = true; } catch { kept += 1; }
    }
  }
  await AgentBatch.updateOne({ _id: batch._id }, { $set: { undoneAt: new Date() } });
  return { removed, notebookRemoved, kept, collection: batch.notebookTitle };
}
