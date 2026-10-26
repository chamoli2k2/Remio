import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import request from 'supertest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { createApp } from '../src/app.js';
import { allModels, Blob, User } from '../src/models/index.js';
import { BRAND } from '../../shared/brand.js';
import { emptyDrawing, LIMITS } from '../../shared/drawing.js';

/**
 * Drawings on cards: stored outside the card, readable only through the folder they belong to,
 * and gone when the card or the folder is.
 *
 * Without a bucket configured the documents land in the fallback key–value collection, which is
 * what these assertions look at to prove something was or was not left behind.
 */

const enabled = process.env.RUN_INTEGRATION === '1';
const password = 'Drawings-integration-2026';
let mongo, app, owner, stranger;

before(async () => {
  if (!enabled) return;
  process.env.DISABLE_RATE_LIMIT = '1';
  const dbName = `${BRAND.slug}_drawings_${crypto.randomBytes(6).toString('hex')}`;
  if (!process.env.TEST_MONGODB_URI) mongo = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  await mongoose.connect(process.env.TEST_MONGODB_URI || mongo.getUri(), { dbName });
  await Promise.all(allModels.map(m => m.init()));
  app = createApp();
  [owner, stranger] = [request.agent(app), request.agent(app)];
  for (const [agent, username] of [[owner, 'sketcher'], [stranger, 'onlooker']]) {
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

const sketch = (overrides = {}) => ({
  ...emptyDrawing(),
  paper: 'ruled',
  strokes: [
    { t: 'pen', c: '#1f1d28', s: 4, p: [100, 100, 140, 120, 180, 160] },
    { t: 'highlighter', c: '#ffe14d', s: 26, p: [90, 200, 400, 200] },
    { t: 'eraser', c: '#000000', s: 30, p: [120, 110, 130, 115] },
  ],
  ...overrides,
});

async function folder(agent = owner, title = `Sketches ${crypto.randomBytes(3).toString('hex')}`) {
  const r = await agent.post('/api/folders').send({ title });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.folder;
}
const save = (folderId, doc = sketch(), agent = owner) => agent.post(`/api/folders/${folderId}/drawings`).send(doc);
const blobsUnder = folderId => Blob.countDocuments({ _id: { $regex: `^drawings/${folderId}/` } });

integration('a drawing is saved, read back exactly, and cached as the immutable thing it is', async () => {
  const f = await folder();
  const saved = await save(f.id);
  assert.equal(saved.status, 201, JSON.stringify(saved.body));
  assert.match(saved.body.id, /^[0-9a-f-]{36}$/);

  const read = await owner.get(`/api/folders/${f.id}/drawings/${saved.body.id}`);
  assert.equal(read.status, 200);
  assert.deepEqual(read.body, sketch());
  assert.match(read.headers['cache-control'], /private.*immutable/);
  assert.equal(read.headers['x-content-type-options'], 'nosniff');

  // Saving again is a new document, never an overwrite.
  const again = await save(f.id);
  assert.notEqual(again.body.id, saved.body.id);
  assert.equal(await blobsUnder(f.id), 2);
});

integration('only people who can see the folder can see its drawings, and only editors can add one', async () => {
  const f = await folder();
  const { body } = await save(f.id);
  // Refused the same way a private folder is everywhere else, which may be "not found" so as not
  // to confirm that it exists.
  const refused = r => assert.ok([403, 404].includes(r.status), `expected a refusal, got ${r.status}`);
  refused(await stranger.get(`/api/folders/${f.id}/drawings/${body.id}`));
  refused(await request(app).get(`/api/folders/${f.id}/drawings/${body.id}`));
  refused(await save(f.id, sketch(), stranger));

  // A real id asked for through another folder finds nothing, because it is not stored there.
  const theirs = await folder(stranger);
  assert.equal((await stranger.get(`/api/folders/${theirs.id}/drawings/${body.id}`)).status, 404);
  assert.equal((await owner.get(`/api/folders/${f.id}/drawings/not-a-uuid`)).status, 404);
  assert.equal((await owner.get(`/api/folders/${f.id}/drawings/../../etc`)).status, 404);
});

integration('anything that is not a drawing is refused before it is stored', async () => {
  const f = await folder();
  const bad = {
    'a colour that is CSS, not hex': sketch({ strokes: [{ t: 'pen', c: 'red;background:url(x)', s: 4, p: [1, 1, 2, 2] }] }),
    'an unknown tool': sketch({ strokes: [{ t: 'script', c: '#000000', s: 4, p: [1, 1, 2, 2] }] }),
    'an extra field': sketch({ strokes: [{ t: 'pen', c: '#000000', s: 4, p: [1, 1, 2, 2], html: '<img onerror=x>' }] }),
    'an extra top-level field': { ...sketch(), note: '<script>' },
    'an odd number of coordinates': sketch({ strokes: [{ t: 'pen', c: '#000000', s: 4, p: [1, 1, 2] }] }),
    'a tip size out of range': sketch({ strokes: [{ t: 'pen', c: '#000000', s: 900, p: [1, 1, 2, 2] }] }),
    'a coordinate off the page': sketch({ strokes: [{ t: 'pen', c: '#000000', s: 4, p: [1, 1, 99999, 2] }] }),
    'another page size': sketch({ w: 4000 }),
    'an unknown paper': sketch({ paper: 'papyrus' }),
    'nothing drawn': sketch({ strokes: [] }),
    'only rubbing out': sketch({ strokes: [{ t: 'eraser', c: '#000000', s: 30, p: [1, 1, 2, 2] }] }),
    'too many strokes': sketch({ strokes: Array.from({ length: LIMITS.strokes + 1 }, () => ({ t: 'pen', c: '#000000', s: 2, p: [1, 1] })) }),
  };
  for (const [why, doc] of Object.entries(bad)) {
    const r = await save(f.id, doc);
    assert.ok([400, 413].includes(r.status), `${why}: ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
  }
  assert.equal(await blobsUnder(f.id), 0, 'and nothing was written');
});

integration('a full page of handwriting fits, which a form-sized body limit would not allow', async () => {
  const f = await folder();
  // Around 40k points: well past the 256 kB the rest of the API accepts.
  const strokes = Array.from({ length: 200 }, (_, i) => ({ t: 'pen', c: '#2f6fdf', s: 3, p: Array.from({ length: 400 }, (_, j) => (j % 2 ? 100 + (i * 4) % 900 : 100 + j)) }));
  const doc = sketch({ strokes });
  assert.ok(Buffer.byteLength(JSON.stringify(doc)) > 256 * 1024);
  const r = await save(f.id, doc);
  assert.equal(r.status, 201, JSON.stringify(r.body).slice(0, 300));
});

integration('a card can carry a drawing from its own folder only, and counts it as content', async () => {
  const f = await folder(), other = await folder();
  const mine = (await save(f.id)).body.id;
  const elsewhere = (await save(other.id)).body.id;

  const card = await owner.post(`/api/folders/${f.id}/cards`).send({ front: { text: '', drawing: mine }, back: { text: 'The answer' } });
  assert.equal(card.status, 201, JSON.stringify(card.body));
  assert.equal(card.body.card.front.drawing, mine);

  const foreign = await owner.post(`/api/folders/${f.id}/cards`).send({ front: { text: 'Q', drawing: elsewhere }, back: { text: 'A' } });
  assert.equal(foreign.status, 400, JSON.stringify(foreign.body));
  const invented = await owner.post(`/api/folders/${f.id}/cards`).send({ front: { text: 'Q', drawing: crypto.randomUUID() }, back: { text: 'A' } });
  assert.equal(invented.status, 400);

  // Editing the drawing points the card at a new one; the history keeps the old one readable.
  const edited = (await save(f.id, sketch({ paper: 'grid' }))).body.id;
  const updated = await owner.patch(`/api/cards/${card.body.card.id}`).send({ front: { text: '', drawing: edited }, back: { text: 'The answer' }, version: 0 });
  assert.equal(updated.status, 200, JSON.stringify(updated.body));
  assert.equal((await owner.get(`/api/folders/${f.id}/drawings/${mine}`)).status, 200, 'the previous version is still there for the history');

  // Deleting the card takes its drawings, current and historical, with it.
  assert.equal((await owner.delete(`/api/cards/${card.body.card.id}`)).status, 200);
  assert.equal((await owner.get(`/api/folders/${f.id}/drawings/${mine}`)).status, 404);
  assert.equal((await owner.get(`/api/folders/${f.id}/drawings/${edited}`)).status, 404);
});

integration('copying a folder copies its drawings, and deleting a folder removes them', async () => {
  const f = await folder();
  const id = (await save(f.id)).body.id;
  assert.equal((await owner.post(`/api/folders/${f.id}/cards`).send({ front: { text: 'Draw it', drawing: id }, back: { text: 'Like this' } })).status, 201);

  const copy = await owner.post(`/api/folders/${f.id}/copy`);
  assert.equal(copy.status, 201, JSON.stringify(copy.body));
  const copied = (await owner.get(`/api/folders/${copy.body.folder.id}/cards`)).body.cards[0];
  assert.equal(copied.front.drawing, id, 'the copy keeps the id');
  assert.equal((await owner.get(`/api/folders/${copy.body.folder.id}/drawings/${id}`)).status, 200, 'and has its own copy of the document');

  assert.equal((await owner.delete(`/api/folders/${f.id}`).send({ confirm: f.title })).status, 200);
  assert.equal(await blobsUnder(f.id), 0, 'nothing of the deleted folder is left');
  assert.equal((await owner.get(`/api/folders/${copy.body.folder.id}/drawings/${id}`)).status, 200, 'and the copy is unaffected');
});

integration('an imported card cannot smuggle in a drawing id', async () => {
  const f = await folder();
  await User.updateOne({ username: 'sketcher' }, { $set: { account: 'premium' } });
  const file = JSON.stringify({ cards: [{ front: { text: 'Q', drawing: crypto.randomUUID() }, back: { text: 'A' } }] });
  const r = await owner.post(`/api/folders/${f.id}/import`).attach('file', Buffer.from(file), 'cards.json');
  if (r.status === 201) {
    const [card] = (await owner.get(`/api/folders/${f.id}/cards`)).body.cards;
    assert.equal(card.front.drawing, null);
  } else assert.ok(r.status >= 400, JSON.stringify(r.body));
});
