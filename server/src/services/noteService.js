import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { Notebook, Note, Media, User } from '../models/index.js';
import { roleOf } from './accessService.js';
import * as mediaService from './mediaService.js';
import * as storage from './storage.js';
import * as blobs from './blobStore.js';
import { assert } from '../utils/errors.js';
import { DRAWING_ID, LIMITS as DRAWING_LIMITS } from '../../../shared/drawing.js';
import { NOTE_LIMITS, embedsIn, snippetOf } from '../../../shared/notes.js';

/**
 * Notebooks and the pages in them.
 *
 * Permission works exactly as it does for a collection — owner, then members as viewer or editor,
 * and nobody else — through the same `roleOf`, so there is one definition of who may do what.
 * A notebook is never public, so a stranger gets the same 404 as for something that does not exist.
 */

const NOT_FOUND = 'Notebook not found or access has been removed.';

export async function accessNotebook(id, user, level = 'viewer', session = null) {
  assert(user && mongoose.isValidObjectId(id), 404, NOT_FOUND);
  const notebook = await Notebook.findById(id).session(session);
  assert(notebook, 404, NOT_FOUND);
  const role = roleOf(notebook, user);
  assert(role, 404, NOT_FOUND);
  assert(level === 'viewer' || role === 'owner' || (level === 'editor' && role === 'editor'), 403, 'You do not have permission to make this change.');
  notebook.$locals.role = role;
  return notebook;
}

// A page saved moves its notebook to the top of the list.
const touch = id => Notebook.updateOne({ _id: id }, { $set: { updatedAt: new Date() } }, { timestamps: false });
const writable = notebook => assert(!notebook.archived, 409, 'Restore this notebook before changing it.', 'NOTEBOOK_ARCHIVED');
const person = u => (u && typeof u === 'object' && u.username ? { id: String(u._id ?? u.id), name: u.name, username: u.username } : null);

export async function presentNotebook(notebook, user, noteCount) {
  await notebook.populate([{ path: 'owner', select: 'name username' }, { path: 'members.user', select: 'name username' }]);
  return {
    id: notebook.id, title: notebook.title, description: notebook.description, color: notebook.color, icon: notebook.icon,
    archived: notebook.archived, version: notebook.version, updatedAt: notebook.updatedAt,
    role: roleOf(notebook, user), owner: person(notebook.owner),
    members: notebook.members.filter(m => m.user?.username).map(m => ({ user: person(m.user), role: m.role })),
    ...(noteCount != null ? { noteCount } : {}),
  };
}

/** Everything this person can open: their own and the ones shared with them. */
const visibleTo = user => ({ $or: [{ owner: user.id }, { 'members.user': user.id }] });

export async function listNotebooks(user, { archived = false } = {}) {
  const rows = await Notebook.find({ ...visibleTo(user), archived }).sort({ updatedAt: -1 }).limit(NOTE_LIMITS.notebooksPerUser * 2);
  const counts = new Map((await Note.aggregate([{ $match: { notebook: { $in: rows.map(r => r._id) } } }, { $group: { _id: '$notebook', n: { $sum: 1 } } }])).map(c => [String(c._id), c.n]));
  return Promise.all(rows.map(r => presentNotebook(r, user, counts.get(r.id) || 0)));
}

export async function createNotebook(user, body) {
  const owned = await Notebook.countDocuments({ owner: user.id });
  assert(owned < NOTE_LIMITS.notebooksPerUser, 409, `You can have up to ${NOTE_LIMITS.notebooksPerUser} notebooks. Delete one you no longer need first.`, 'NOTEBOOK_LIMIT');
  return Notebook.create({ ...body, owner: user.id });
}

export async function updateNotebook(id, user, { version, ...body }) {
  const notebook = await accessNotebook(id, user, 'owner');
  assert(notebook.version === version, 409, 'This notebook was changed somewhere else. Reopen it and try again.', 'VERSION_CONFLICT');
  Object.assign(notebook, body); notebook.version += 1;
  return notebook.save();
}

export async function archiveNotebook(id, user, archived) {
  const notebook = await accessNotebook(id, user, 'owner');
  notebook.archived = archived; notebook.version += 1;
  return notebook.save();
}

export async function setMember(id, user, username, role) {
  const notebook = await accessNotebook(id, user, 'owner');
  const target = await User.findOne({ username }).select('_id');
  assert(target, 404, 'No user with that username. Ask them to create an account first.');
  assert(String(target._id) !== String(notebook.owner), 400, 'The owner already has full access.');
  notebook.members = notebook.members.filter(m => String(m.user) !== String(target._id));
  if (role !== 'remove') {
    assert(notebook.members.length < 50, 409, 'A notebook can be shared with up to 50 people.', 'MEMBER_LIMIT');
    notebook.members.push({ user: target._id, role });
  }
  notebook.version += 1;
  return notebook.save();
}

/** Storage keys and rows for a notebook's images and drawings, removed after the rows are gone. */
const drawingPrefix = notebookId => `notebook-drawings/${notebookId}/`;
const drawingKey = (notebookId, id) => `${drawingPrefix(notebookId)}${id}.json`;

export async function deleteNotebook(id, user, confirm) {
  const notebook = await accessNotebook(id, user, 'owner');
  assert(confirm === notebook.title, 400, 'Type the notebook name exactly to delete it.', 'CONFIRMATION_MISMATCH');
  const images = await Media.find({ notebook: notebook._id }).select('_id').lean();
  let keys = [];
  await mongoose.connection.transaction(async session => {
    ({ keys } = await mediaService.purge(images.map(i => i._id), { session }));
    await Note.deleteMany({ notebook: notebook._id }, { session });
    await Notebook.deleteOne({ _id: notebook._id }, { session });
  });
  await storage.remove(keys);
  await removeNotebookDrawings(notebook.id);
  return { deleted: true };
}

export async function removeNotebookDrawings(notebookId) {
  try { return await blobs.remove(await blobs.list(drawingPrefix(notebookId))); } catch { return { removed: 0 }; }
}

/* Pages */

const presentNote = (note, { body = true } = {}) => ({
  id: note.id ?? String(note._id), notebook: String(note.notebook), title: note.title, tags: note.tags || [], pinned: !!note.pinned,
  version: note.version, updatedAt: note.updatedAt, createdAt: note.createdAt,
  updatedBy: person(note.updatedBy), createdBy: person(note.createdBy),
  ...(body ? { body: note.body } : { snippet: snippetOf(note.body) }),
});

export async function listNotes(notebookId, user) {
  const notebook = await accessNotebook(notebookId, user);
  const rows = await Note.find({ notebook: notebook._id }).sort({ pinned: -1, updatedAt: -1 }).limit(NOTE_LIMITS.notesPerNotebook).populate('updatedBy', 'name username').lean();
  return { notebook: await presentNotebook(notebook, user, rows.length), notes: rows.map(n => presentNote(n, { body: false })) };
}

async function noteFor(id, user, level) {
  assert(mongoose.isValidObjectId(id), 404, 'Page not found.');
  const note = await Note.findById(id);
  assert(note, 404, 'Page not found.');
  const notebook = await accessNotebook(note.notebook, user, level);
  return { note, notebook };
}

export async function getNote(id, user) {
  const { note, notebook } = await noteFor(id, user, 'viewer');
  await note.populate([{ path: 'updatedBy', select: 'name username' }, { path: 'createdBy', select: 'name username' }]);
  return { note: presentNote(note), role: notebook.$locals.role };
}

/**
 * Every picture and drawing a page points at must belong to its own notebook, and there is a
 * ceiling on how many. Only embeds the page did not already have are looked up, so an autosave of
 * a long page costs nothing extra.
 */
async function verifyEmbeds(notebookId, body, previous = '') {
  const embeds = embedsIn(body);
  const media = [...new Set(embeds.filter(e => e.kind === 'media').map(e => e.id))];
  const drawings = [...new Set(embeds.filter(e => e.kind === 'drawing').map(e => e.id))];
  assert(media.length <= NOTE_LIMITS.imagesPerNote, 400, `A page can hold up to ${NOTE_LIMITS.imagesPerNote} images.`, 'TOO_MANY_IMAGES');
  assert(drawings.length <= NOTE_LIMITS.drawingsPerNote, 400, `A page can hold up to ${NOTE_LIMITS.drawingsPerNote} drawings.`, 'TOO_MANY_DRAWINGS');
  const known = new Set(embedsIn(previous).map(e => `${e.kind}:${e.id}`));
  const freshMedia = media.filter(id => !known.has(`media:${id}`));
  if (freshMedia.length) {
    assert(freshMedia.every(id => mongoose.isValidObjectId(id)), 400, 'That image does not belong to this notebook.', 'IMAGE_NOT_FOUND');
    const found = await Media.countDocuments({ _id: { $in: freshMedia }, notebook: notebookId });
    assert(found === freshMedia.length, 400, 'That image does not belong to this notebook.', 'IMAGE_NOT_FOUND');
  }
  for (const id of drawings.filter(d => !known.has(`drawing:${d}`))) {
    assert(DRAWING_ID.test(id) && await blobs.exists(drawingKey(notebookId, id)), 400, 'That drawing does not belong to this notebook.', 'DRAWING_NOT_FOUND');
  }
}

export async function createNote(notebookId, user, body) {
  const notebook = await accessNotebook(notebookId, user, 'editor');
  writable(notebook);
  const count = await Note.countDocuments({ notebook: notebook._id });
  assert(count < NOTE_LIMITS.notesPerNotebook, 409, `A notebook can hold up to ${NOTE_LIMITS.notesPerNotebook} pages. Start another notebook.`, 'NOTE_LIMIT');
  await verifyEmbeds(notebook._id, body.body);
  const note = await Note.create({ ...body, notebook: notebook._id, createdBy: user.id, updatedBy: user.id });
  await Notebook.updateOne({ _id: notebook._id }, { $currentDate: { updatedAt: true } });
  return presentNote(note);
}

/**
 * Saves are checked against the version the editor started from. A stale one is refused with the
 * page as it now stands, so the person can choose between their draft and the other change rather
 * than one silently replacing the other.
 */
export async function updateNote(id, user, { version, ...body }) {
  const { note, notebook } = await noteFor(id, user, 'editor');
  writable(notebook);
  if (note.version !== version) {
    await note.populate('updatedBy', 'name username');
    assert(false, 409, `${note.updatedBy?.name || 'Someone'} changed this page while you were editing. Your draft is kept.`, 'VERSION_CONFLICT', { details: { note: presentNote(note) } });
  }
  if (body.body !== undefined) await verifyEmbeds(notebook._id, body.body, note.body);
  const saved = await Note.findOneAndUpdate({ _id: note._id, version }, { $set: { ...body, updatedBy: user.id }, $inc: { version: 1 } }, { new: true });
  assert(saved, 409, 'Someone changed this page at the same moment. Your draft is kept; save again to keep it.', 'VERSION_CONFLICT');
  await Notebook.updateOne({ _id: notebook._id }, { $currentDate: { updatedAt: true } });
  await saved.populate('updatedBy', 'name username');
  return presentNote(saved);
}

/** Deleting a page takes its pictures and drawings too, unless another page still shows them. */
export async function deleteNote(id, user) {
  const { note, notebook } = await noteFor(id, user, 'editor');
  writable(notebook);
  const embeds = embedsIn(note.body);
  await Note.deleteOne({ _id: note._id });
  const others = (await Note.find({ notebook: notebook._id }).select('body').lean()).flatMap(n => embedsIn(n.body).map(e => `${e.kind}:${e.id}`));
  const stillUsed = new Set(others);
  const media = [...new Set(embeds.filter(e => e.kind === 'media' && !stillUsed.has(`media:${e.id}`)).map(e => e.id))].filter(i => mongoose.isValidObjectId(i));
  const drawings = [...new Set(embeds.filter(e => e.kind === 'drawing' && !stillUsed.has(`drawing:${e.id}`)).map(e => e.id))];
  if (media.length) {
    const owned = (await Media.find({ _id: { $in: media }, notebook: notebook._id }).select('_id').lean()).map(m => m._id);
    const { keys } = await mediaService.purge(owned);
    await storage.remove(keys);
  }
  if (drawings.length) await blobs.remove(drawings.filter(d => DRAWING_ID.test(d)).map(d => drawingKey(notebook.id, d)));
  return { deleted: true };
}

const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export async function searchNotes(user, q) {
  const query = String(q || '').trim().slice(0, NOTE_LIMITS.searchQuery);
  if (query.length < 2) return [];
  const notebooks = await Notebook.find({ ...visibleTo(user), archived: false }).select('_id title color');
  const byId = new Map(notebooks.map(n => [n.id, n]));
  const match = new RegExp(escape(query), 'i');
  const rows = await Note.find({ notebook: { $in: notebooks.map(n => n._id) }, $or: [{ title: match }, { body: match }, { tags: query.toLowerCase() }] })
    .sort({ updatedAt: -1 }).limit(NOTE_LIMITS.searchResults).populate('updatedBy', 'name username').lean();
  return rows.map(n => ({ ...presentNote(n, { body: false }), notebookTitle: byId.get(String(n.notebook))?.title || '', notebookColor: byId.get(String(n.notebook))?.color || 'violet' }));
}

/* Pictures and drawings */

export async function uploadImage(notebookId, user, file) {
  assert(file, 400, 'Choose an image.');
  const image = await mediaService.ingest(file.buffer);
  const notebook = await accessNotebook(notebookId, user, 'editor');
  writable(notebook);
  const stored = await Media.countDocuments({ notebook: notebook._id });
  assert(stored < NOTE_LIMITS.imagesPerNotebook, 409, `A notebook can hold up to ${NOTE_LIMITS.imagesPerNotebook} images. Delete pages you no longer need first.`, 'IMAGE_LIMIT');
  const { media } = await mediaService.persist(image, { notebook: notebook._id, user: user.id, name: file.originalname });
  return { id: String(media._id), url: `/api/media/${media._id}` };
}

export async function saveDrawing(notebookId, user, doc) {
  const notebook = await accessNotebook(notebookId, user, 'editor');
  writable(notebook);
  const body = JSON.stringify(doc);
  assert(Buffer.byteLength(body) <= DRAWING_LIMITS.bytes, 413, 'This drawing is too large to save. Try clearing part of it.', 'DRAWING_TOO_LARGE');
  const existing = await blobs.list(drawingPrefix(notebook.id));
  assert(existing.length < NOTE_LIMITS.drawingsPerNotebook, 409, `A notebook can hold up to ${NOTE_LIMITS.drawingsPerNotebook} drawings. Delete pages you no longer need first.`, 'DRAWING_LIMIT');
  const id = crypto.randomUUID();
  await blobs.put(drawingKey(notebook.id, id), body, 'application/json');
  return { id };
}

export async function readDrawing(notebookId, id, user) {
  assert(DRAWING_ID.test(id), 404, 'Drawing not found.');
  const notebook = await accessNotebook(notebookId, user);
  const body = await blobs.get(drawingKey(notebook.id, id));
  assert(body, 404, 'Drawing not found.');
  return body;
}

/** For account erasure: what an owner's notebooks leave in storage, read before the rows go. */
export async function erasureFor(userId, session) {
  const notebooks = await Notebook.find({ owner: userId }).select('_id').session(session).lean();
  const ids = notebooks.map(n => n._id);
  const keys = (await Media.find({ notebook: { $in: ids } }).select('key variants').session(session).lean()).filter(m => m.key).flatMap(m => storage.allKeysFor(m.key, m.variants));
  await Media.deleteMany({ notebook: { $in: ids } }, { session });
  await Note.deleteMany({ notebook: { $in: ids } }, { session });
  await Notebook.deleteMany({ owner: userId }, { session });
  await Notebook.updateMany({ 'members.user': userId }, { $pull: { members: { user: userId } } }, { session });
  return { keys, notebookIds: ids.map(String) };
}
