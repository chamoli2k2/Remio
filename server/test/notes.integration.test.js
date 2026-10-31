import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import request from 'supertest';
import sharp from 'sharp';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { createApp } from '../src/app.js';
import { allModels, Blob, Media, Note, Notebook, NoteCollection, User } from '../src/models/index.js';
import { BRAND } from '../../shared/brand.js';
import { emptyDrawing } from '../../shared/drawing.js';
import { NOTE_LIMITS, embedLine } from '../../shared/notes.js';

/**
 * Notebooks: who can open them, what a page may point at, how two editors are kept from
 * overwriting each other, and that nothing is left behind when a page, a notebook or an account goes.
 */

const enabled = process.env.RUN_INTEGRATION === '1';
const password = 'Notes-integration-2026';
let mongo, app, owner, editor, viewer, stranger;

before(async () => {
  if (!enabled) return;
  process.env.DISABLE_RATE_LIMIT = '1';
  const dbName = `${BRAND.slug}_notes_${crypto.randomBytes(6).toString('hex')}`;
  if (!process.env.TEST_MONGODB_URI) mongo = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  await mongoose.connect(process.env.TEST_MONGODB_URI || mongo.getUri(), { dbName });
  await Promise.all(allModels.map(m => m.init()));
  app = createApp();
  [owner, editor, viewer, stranger] = [request.agent(app), request.agent(app), request.agent(app), request.agent(app)];
  for (const [agent, username] of [[owner, 'noteowner'], [editor, 'noteeditor'], [viewer, 'noteviewer'], [stranger, 'notestranger']]) {
    const r = await agent.post('/api/auth/signup').send({ username, name: username, email: `${username}@example.test`, password, country: 'India', acceptedTerms: true });
    assert.equal(r.status, 201, JSON.stringify(r.body));
  }
  await User.updateMany({}, { $set: { emailVerifiedAt: new Date() } });
});

after(async () => {
  if (mongoose.connection.readyState) { await mongoose.connection.dropDatabase(); await mongoose.disconnect(); }
  if (mongo) await mongo.stop();
  delete process.env.DISABLE_RATE_LIMIT;
});

const integration = (name, fn) => test(name, { skip: !enabled }, fn);
const sketch = () => ({ ...emptyDrawing(), strokes: [{ t: 'pen', c: '#1f1d28', s: 4, p: [100, 100, 140, 120, 180, 160] }] });
const png = (color = '#6545d1') => sharp({ create: { width: 8, height: 8, channels: 3, background: color } }).png().toBuffer();

const homes = new Map();
async function collection(agent = owner, title = `Collection ${crypto.randomBytes(3).toString('hex')}`) {
  const r = await agent.post('/api/note-collections').send({ title });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.collection;
}
async function notebook(agent = owner, title = `Notebook ${crypto.randomBytes(3).toString('hex')}`, inside) {
  if (!inside) { if (!homes.has(agent)) homes.set(agent, (await collection(agent)).id); inside = homes.get(agent); }
  const r = await agent.post('/api/notebooks').send({ title, collection: inside });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.notebook;
}
async function page(notebookId, body = {}, agent = owner) {
  const r = await agent.post(`/api/notebooks/${notebookId}/notes`).send({ title: 'Lecture 1', body: 'Hello **world**', ...body });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.note;
}
async function share(notebookId, username, role) {
  const r = await owner.post(`/api/notebooks/${notebookId}/members`).send({ username, role });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.notebook;
}

integration('a notebook and its pages are private to the owner until shared', async () => {
  const nb = await notebook();
  assert.equal(nb.role, 'owner'); assert.equal(nb.noteCount, 0); assert.equal(nb.icon, 'book');
  const note = await page(nb.id);
  assert.equal(note.body, 'Hello **world**'); assert.equal(note.version, 0);

  for (const path of [`/api/notebooks/${nb.id}`, `/api/notes/${note.id}`]) {
    assert.equal((await stranger.get(path)).status, 404, `${path} must not exist for a stranger`);
    assert.equal((await request(app).get(path)).status, 401, `${path} needs a session`);
  }
  assert.equal((await stranger.patch(`/api/notes/${note.id}`).send({ body: 'mine now', version: 0 })).status, 404);
  assert.ok(!(await stranger.get('/api/notebooks')).body.notebooks.some(n => n.id === nb.id));

  const listed = (await owner.get(`/api/notebooks/${nb.id}`)).body;
  assert.equal(listed.notes.length, 1);
  assert.equal(listed.notes[0].snippet, 'Hello world');
  assert.equal(listed.notes[0].body, undefined, 'the list carries snippets, not whole pages');
});

integration('a viewer reads but cannot write; an editor writes but cannot manage the notebook', async () => {
  const nb = await notebook();
  const note = await page(nb.id);
  await share(nb.id, 'noteviewer', 'viewer');
  const shared = await share(nb.id, 'noteeditor', 'editor');
  assert.deepEqual(shared.members.map(m => [m.user.username, m.role]).sort(), [['noteeditor', 'editor'], ['noteviewer', 'viewer']]);

  assert.equal((await viewer.get(`/api/notes/${note.id}`)).body.role, 'viewer');
  assert.equal((await viewer.patch(`/api/notes/${note.id}`).send({ body: 'x', version: 0 })).status, 403);
  assert.equal((await viewer.post(`/api/notebooks/${nb.id}/notes`).send({ title: 'x' })).status, 403);
  assert.equal((await viewer.post(`/api/notebooks/${nb.id}/drawings`).send(sketch())).status, 403);
  assert.equal((await viewer.delete(`/api/notes/${note.id}`)).status, 403);

  const saved = await editor.patch(`/api/notes/${note.id}`).send({ body: 'Edited by the editor', version: 0 });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.equal(saved.body.note.version, 1); assert.equal(saved.body.note.updatedBy.username, 'noteeditor');
  assert.equal((await editor.post(`/api/notebooks/${nb.id}/members`).send({ username: 'notestranger', role: 'viewer' })).status, 403);
  assert.equal((await editor.patch(`/api/notebooks/${nb.id}`).send({ title: 'Renamed', version: shared.version })).status, 403);
  assert.equal((await editor.delete(`/api/notebooks/${nb.id}`).send({ confirm: nb.title })).status, 403);

  // Sharing is free: neither account here has Premium.
  await share(nb.id, 'noteviewer', 'remove');
  assert.equal((await viewer.get(`/api/notes/${note.id}`)).status, 404, 'removing someone takes their access away at once');
});

integration('a stale save is refused with the current page, and the draft is the client’s to keep', async () => {
  const nb = await notebook();
  const note = await page(nb.id);
  await share(nb.id, 'noteeditor', 'editor');
  assert.equal((await owner.patch(`/api/notes/${note.id}`).send({ body: 'Owner first', version: 0 })).status, 200);
  const stale = await editor.patch(`/api/notes/${note.id}`).send({ body: 'Editor second', version: 0 });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.code, 'VERSION_CONFLICT');
  assert.equal(stale.body.details.note.body, 'Owner first');
  assert.equal(stale.body.details.note.version, 1);
  // Choosing to keep their own draft means saving it against the version they were shown.
  const kept = await editor.patch(`/api/notes/${note.id}`).send({ body: 'Editor second', version: 1 });
  assert.equal(kept.status, 200); assert.equal(kept.body.note.body, 'Editor second');
});

integration('a page may only show pictures and drawings stored in its own notebook', async () => {
  const mine = await notebook(), theirs = await notebook(stranger);
  const image = await owner.post(`/api/notebooks/${mine.id}/images`).attach('image', await png(), 'diagram.png');
  assert.equal(image.status, 201, JSON.stringify(image.body));
  const drawing = await owner.post(`/api/notebooks/${mine.id}/drawings`).send(sketch());
  assert.equal(drawing.status, 201, JSON.stringify(drawing.body));
  const body = ['Notes', embedLine('media', image.body.id, 'diagram'), embedLine('drawing', drawing.body.id, 'sketch')].join('\n');
  const note = await page(mine.id, { body });

  const read = await owner.get(`/api/notebooks/${mine.id}/drawings/${drawing.body.id}`);
  assert.equal(read.status, 200); assert.match(read.headers['cache-control'], /private.*immutable/);
  assert.equal((await owner.get(`/api/media/${image.body.id}`)).status, 200);
  assert.equal((await stranger.get(`/api/media/${image.body.id}`)).status, 404, 'a notebook picture is as private as the notebook');
  assert.equal((await stranger.get(`/api/notebooks/${mine.id}/drawings/${drawing.body.id}`)).status, 404);

  // Someone with their own notebook cannot point a page at another notebook's things.
  for (const line of [embedLine('media', image.body.id), embedLine('drawing', drawing.body.id)]) {
    const r = await stranger.post(`/api/notebooks/${theirs.id}/notes`).send({ title: 'Borrowed', body: line });
    assert.equal(r.status, 400, JSON.stringify(r.body));
  }
  // Nor can a drawing id from one notebook be read through another the person can open.
  assert.equal((await stranger.get(`/api/notebooks/${theirs.id}/drawings/${drawing.body.id}`)).status, 404);
  // A made-up id is refused too.
  assert.equal((await owner.patch(`/api/notes/${note.id}`).send({ body: embedLine('drawing', crypto.randomUUID()), version: 0 })).status, 400);
  // A card cannot borrow a notebook picture either.
  const folder = (await owner.post('/api/folders').send({ title: 'Deck' })).body.folder;
  assert.equal((await owner.post(`/api/folders/${folder.id}/cards`).send({ front: { text: 'Q', image: image.body.id }, back: { text: 'A' } })).status, 400);
  // And a collection image cannot sit in a page.
  const cardImage = await owner.post(`/api/folders/${folder.id}/images`).attach('image', await png('#123456'), 'card.png');
  assert.equal((await owner.patch(`/api/notes/${note.id}`).send({ body: embedLine('media', cardImage.body.id), version: 0 })).status, 400);
});

integration('limits: page length, embeds per page, and notebooks stay notebooks', async () => {
  const nb = await notebook();
  const huge = await owner.post(`/api/notebooks/${nb.id}/notes`).send({ title: 'Too long', body: 'x'.repeat(NOTE_LIMITS.body + 1) });
  assert.equal(huge.status, 400);
  // Long non-Latin pages fit in the request even though they are three bytes a character.
  const hindi = await owner.post(`/api/notebooks/${nb.id}/notes`).send({ title: 'हिंदी', body: 'नमस्ते '.repeat(12_000) });
  assert.equal(hindi.status, 201, JSON.stringify(hindi.body).slice(0, 200));

  const ids = Array.from({ length: NOTE_LIMITS.drawingsPerNote + 1 }, () => crypto.randomUUID());
  const tooMany = await owner.post(`/api/notebooks/${nb.id}/notes`).send({ title: 'Sketchy', body: ids.map(id => embedLine('drawing', id)).join('\n') });
  assert.equal(tooMany.status, 400); assert.equal(tooMany.body.code, 'TOO_MANY_DRAWINGS');

  // A notebook never shows up anywhere a flashcard collection would.
  const folders = (await owner.get('/api/folders')).body.folders;
  assert.ok(!folders.some(f => f.id === nb.id));
  assert.equal((await owner.get(`/api/folders/${nb.id}`)).status, 404);
  assert.equal((await owner.get(`/api/folders/${nb.id}/cards`)).status, 404);
});

integration('archiving freezes a notebook; searching finds pages across every notebook you can open', async () => {
  const nb = await notebook();
  const note = await page(nb.id, { title: 'Photosynthesis', body: 'Chlorophyll absorbs light', tags: ['biology'] });
  await share(nb.id, 'noteviewer', 'viewer');
  for (const [q, agent] of [['chloro', owner], ['PHOTO', owner], ['biology', owner], ['chloro', viewer]]) {
    const r = await agent.get(`/api/notes/search?q=${encodeURIComponent(q)}`);
    assert.equal(r.status, 200);
    assert.ok(r.body.notes.some(n => n.id === note.id), `“${q}” should find the page`);
  }
  assert.ok(!(await stranger.get('/api/notes/search?q=chloro')).body.notes.length, 'search never reaches other people’s notebooks');
  assert.ok(!(await owner.get('/api/notes/search?q=.*')).body.notes.length, 'the query is text, not a pattern');

  assert.equal((await owner.patch(`/api/notebooks/${nb.id}/archive`).send({ archived: true })).status, 200);
  assert.equal((await owner.patch(`/api/notes/${note.id}`).send({ body: 'x', version: 0 })).status, 409);
  assert.ok((await owner.get('/api/notebooks?archived=1')).body.notebooks.some(n => n.id === nb.id));
  assert.ok(!(await owner.get('/api/notebooks')).body.notebooks.some(n => n.id === nb.id));
  assert.equal((await owner.patch(`/api/notebooks/${nb.id}/archive`).send({ archived: false })).status, 200);
});

integration('deleting a page takes the pictures and drawings only it used', async () => {
  const nb = await notebook();
  const shared = (await owner.post(`/api/notebooks/${nb.id}/drawings`).send(sketch())).body.id;
  const only = (await owner.post(`/api/notebooks/${nb.id}/drawings`).send(sketch())).body.id;
  const image = (await owner.post(`/api/notebooks/${nb.id}/images`).attach('image', await png('#aa3377'), 'only.png')).body.id;
  const first = await page(nb.id, { body: [embedLine('drawing', shared), embedLine('drawing', only), embedLine('media', image)].join('\n') });
  await page(nb.id, { title: 'Keeps one', body: embedLine('drawing', shared) });

  assert.equal((await owner.delete(`/api/notes/${first.id}`)).status, 200);
  assert.equal(await Blob.countDocuments({ _id: `notebook-drawings/${nb.id}/${only}.json` }), 0);
  assert.equal(await Blob.countDocuments({ _id: `notebook-drawings/${nb.id}/${shared}.json` }), 1, 'still shown on the other page');
  assert.equal(await Media.countDocuments({ _id: image }), 0);
});

integration('deleting a notebook needs its name and leaves nothing behind', async () => {
  const nb = await notebook();
  await owner.post(`/api/notebooks/${nb.id}/drawings`).send(sketch());
  await owner.post(`/api/notebooks/${nb.id}/images`).attach('image', await png('#335577'), 'x.png');
  await page(nb.id);
  assert.equal((await owner.delete(`/api/notebooks/${nb.id}`).send({ confirm: 'wrong' })).status, 400);
  assert.equal((await owner.delete(`/api/notebooks/${nb.id}`).send({ confirm: nb.title })).status, 200);
  assert.equal(await Notebook.countDocuments({ _id: nb.id }), 0);
  assert.equal(await Note.countDocuments({ notebook: nb.id }), 0);
  assert.equal(await Media.countDocuments({ notebook: nb.id }), 0);
  assert.equal(await Blob.countDocuments({ _id: { $regex: `^notebook-drawings/${nb.id}/` } }), 0);
});

integration('deleting an account erases its notebooks and its place in other people’s', async () => {
  const leaving = request.agent(app);
  const r = await leaving.post('/api/auth/signup').send({ username: 'noteleaver', name: 'Leaver', email: 'noteleaver@example.test', password, country: 'India', acceptedTerms: true });
  assert.equal(r.status, 201);
  await User.updateOne({ username: 'noteleaver' }, { $set: { emailVerifiedAt: new Date() } });
  const theirs = await notebook(leaving);
  await leaving.post(`/api/notebooks/${theirs.id}/drawings`).send(sketch());
  await page(theirs.id, {}, leaving);
  const ownersNotebook = await notebook();
  await share(ownersNotebook.id, 'noteleaver', 'editor');
  const ownersShelf = await collection();
  await shareCollection(ownersShelf.id, 'noteleaver', 'viewer');

  const leaverId = (await User.findOne({ username: 'noteleaver' }))._id;
  assert.equal(await NoteCollection.countDocuments({ owner: leaverId }), 1);
  const gone = await leaving.delete('/api/auth/account').send({ password, confirm: 'delete my account' });
  assert.equal(gone.status, 200, JSON.stringify(gone.body));
  assert.equal(await Notebook.countDocuments({ _id: theirs.id }), 0);
  assert.equal(await Note.countDocuments({ notebook: theirs.id }), 0);
  assert.equal(await Blob.countDocuments({ _id: { $regex: `^notebook-drawings/${theirs.id}/` } }), 0);
  assert.equal((await Notebook.findById(ownersNotebook.id)).members.length, 0);
  assert.equal(await NoteCollection.countDocuments({ owner: leaverId }), 0);
  assert.equal((await NoteCollection.findById(ownersShelf.id)).members.length, 0);
});

async function shareCollection(id, username, role, agent = owner) {
  const r = await agent.post(`/api/note-collections/${id}/members`).send({ username, role });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.collection;
}

integration('sharing a collection shares every notebook in it, and taking it back takes them all', async () => {
  const shelf = await collection(owner, 'Semester 3');
  const bio = await notebook(owner, 'Biology', shelf.id), phy = await notebook(owner, 'Physics', shelf.id);
  const page1 = await page(bio.id);
  assert.equal(bio.collection.id, shelf.id);
  assert.equal((await stranger.get(`/api/note-collections/${shelf.id}`)).status, 404);

  await shareCollection(shelf.id, 'noteviewer', 'viewer');
  const seen = (await viewer.get(`/api/note-collections/${shelf.id}`)).body;
  assert.deepEqual(seen.notebooks.map(n => n.title).sort(), ['Biology', 'Physics']);
  assert.ok(seen.notebooks.every(n => n.role === 'viewer'));
  assert.equal((await viewer.get(`/api/notes/${page1.id}`)).status, 200);
  assert.equal((await viewer.patch(`/api/notes/${page1.id}`).send({ body: 'x', version: 0 })).status, 403);
  assert.ok((await viewer.get('/api/note-collections')).body.collections.some(c => c.id === shelf.id));
  assert.ok((await viewer.get('/api/notes/search?q=hello')).body.notes.some(n => n.id === page1.id), 'search reaches notebooks through a shared collection');

  // The stronger of the two grants wins: viewer through the collection, editor on the notebook itself.
  await share(phy.id, 'noteviewer', 'editor');
  assert.equal((await viewer.get(`/api/notebooks/${phy.id}`)).body.notebook.role, 'editor');

  await shareCollection(shelf.id, 'noteviewer', 'remove');
  assert.equal((await viewer.get(`/api/notes/${page1.id}`)).status, 404);
  assert.equal((await viewer.get(`/api/notebooks/${phy.id}`)).status, 200, 'a notebook shared on its own stays shared');
  const tab = (await viewer.get('/api/note-collections')).body;
  assert.ok(!tab.collections.some(c => c.id === shelf.id));
  assert.ok(tab.sharedNotebooks.some(n => n.id === phy.id), 'and shows up on its own on the Notes tab');
});

integration('a collection editor adds notebooks for the owner but cannot manage or delete them', async () => {
  const shelf = await collection();
  await shareCollection(shelf.id, 'noteeditor', 'editor');
  const r = await editor.post('/api/notebooks').send({ title: 'Added by editor', collection: shelf.id });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.notebook.owner.username, 'noteowner', 'the collection owner owns everything in it');
  assert.equal(r.body.notebook.role, 'editor');
  assert.equal((await editor.post(`/api/notebooks/${r.body.notebook.id}/notes`).send({ title: 'p' })).status, 201);
  assert.equal((await editor.delete(`/api/notebooks/${r.body.notebook.id}`).send({ confirm: 'Added by editor' })).status, 403);
  assert.equal((await editor.post(`/api/note-collections/${shelf.id}/members`).send({ username: 'notestranger', role: 'viewer' })).status, 403);
  assert.equal((await editor.delete(`/api/note-collections/${shelf.id}`).send({ confirm: shelf.title })).status, 403);
  // A viewer of a collection cannot add to it, and nobody can add to a stranger's.
  await shareCollection(shelf.id, 'noteviewer', 'viewer');
  assert.equal((await viewer.post('/api/notebooks').send({ title: 'nope', collection: shelf.id })).status, 403);
  assert.equal((await stranger.post('/api/notebooks').send({ title: 'nope', collection: shelf.id })).status, 404);
  assert.equal((await owner.post('/api/notebooks').send({ title: 'no home' })).status, 400, 'a notebook needs a collection');
});

integration('a notebook moves only between collections its owner owns', async () => {
  const a = await collection(), b = await collection(), theirs = await collection(stranger);
  const nb = await notebook(owner, 'Mover', a.id);
  const moved = await owner.patch(`/api/notebooks/${nb.id}`).send({ title: nb.title, version: nb.version, collection: b.id });
  assert.equal(moved.status, 200, JSON.stringify(moved.body)); assert.equal(moved.body.notebook.collection.id, b.id);
  assert.equal((await owner.patch(`/api/notebooks/${nb.id}`).send({ title: nb.title, version: moved.body.notebook.version, collection: theirs.id })).status, 404);
});

integration('notebooks made before collections are gathered into one on first visit', async () => {
  const legacy = await Notebook.create({ title: 'Old notebook', owner: (await User.findOne({ username: 'noteowner' }))._id });
  const tab = (await owner.get('/api/note-collections')).body;
  const home = tab.collections.find(c => c.title === 'My notebooks');
  assert.ok(home, 'a home collection was made');
  assert.equal(String((await Notebook.findById(legacy._id)).noteCollection), home.id);
  assert.equal((await owner.get('/api/note-collections')).body.collections.filter(c => c.title === 'My notebooks').length, 1, 'only once');
});

integration('deleting a collection needs its name and takes every notebook, page and file inside', async () => {
  const shelf = await collection(owner, 'Throwaway shelf');
  const nb = await notebook(owner, 'Inside', shelf.id);
  await owner.post(`/api/notebooks/${nb.id}/drawings`).send(sketch());
  await owner.post(`/api/notebooks/${nb.id}/images`).attach('image', await png('#778899'), 'x.png');
  await page(nb.id);
  assert.equal((await owner.delete(`/api/note-collections/${shelf.id}`).send({ confirm: 'wrong' })).status, 400);
  const gone = await owner.delete(`/api/note-collections/${shelf.id}`).send({ confirm: 'Throwaway shelf' });
  assert.equal(gone.status, 200); assert.equal(gone.body.notebooks, 1);
  assert.equal(await NoteCollection.countDocuments({ _id: shelf.id }), 0);
  assert.equal(await Notebook.countDocuments({ _id: nb.id }), 0);
  assert.equal(await Note.countDocuments({ notebook: nb.id }), 0);
  assert.equal(await Media.countDocuments({ notebook: nb.id }), 0);
  assert.equal(await Blob.countDocuments({ _id: { $regex: `^notebook-drawings/${nb.id}/` } }), 0);
});
