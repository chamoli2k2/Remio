import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import request from 'supertest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { createApp } from '../src/app.js';
import { allModels, Card, Note, User } from '../src/models/index.js';
import { BRAND } from '../../shared/brand.js';

/** The phone creates cards and pages offline and may send the same one twice; it must never double up. */

const enabled = process.env.RUN_INTEGRATION === '1';
const password = 'Offline-create-2026';
let mongo, app, owner, other;

before(async () => {
  if (!enabled) return;
  process.env.DISABLE_RATE_LIMIT = '1';
  const dbName = `${BRAND.slug}_offline_${crypto.randomBytes(6).toString('hex')}`;
  if (!process.env.TEST_MONGODB_URI) mongo = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  await mongoose.connect(process.env.TEST_MONGODB_URI || mongo.getUri(), { dbName });
  await Promise.all(allModels.map(m => m.init()));
  app = createApp();
  [owner, other] = [request.agent(app), request.agent(app)];
  for (const [agent, username] of [[owner, 'offlineowner'], [other, 'offlineother']]) {
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
const card = text => ({ front: { text }, back: { text: 'answer' } });

integration('creating the same card twice with one key makes one card', async () => {
  const folder = (await owner.post('/api/folders').send({ title: 'Offline folder' })).body.folder;
  const key = `key_${crypto.randomBytes(8).toString('hex')}`;
  const a = await owner.post(`/api/folders/${folder.id}/cards`).set('Idempotency-Key', key).send(card('one'));
  const b = await owner.post(`/api/folders/${folder.id}/cards`).set('Idempotency-Key', key).send(card('one'));
  assert.equal(a.status, 201); assert.equal(b.status, 201);
  assert.equal(a.body.card.id, b.body.card.id);
  assert.equal(a.body.card.clientId, undefined, 'the key is not shown back');
  assert.equal(await Card.countDocuments({ folder: folder.id }), 1);

  const c = await owner.post(`/api/folders/${folder.id}/cards`).set('Idempotency-Key', `key_${crypto.randomBytes(8).toString('hex')}`).send(card('two'));
  assert.notEqual(c.body.card.id, a.body.card.id);
  const plain = await owner.post(`/api/folders/${folder.id}/cards`).send(card('three'));
  const plain2 = await owner.post(`/api/folders/${folder.id}/cards`).send(card('three'));
  assert.notEqual(plain.body.card.id, plain2.body.card.id, 'without a key every create is new');
  const junk = await owner.post(`/api/folders/${folder.id}/cards`).set('Idempotency-Key', 'x').send(card('four'));
  assert.equal(junk.status, 201, 'a malformed key is ignored, not an error');
});

integration('a key from one person never returns another person\'s card', async () => {
  const mine = (await owner.post('/api/folders').send({ title: 'Mine' })).body.folder;
  const theirs = (await other.post('/api/folders').send({ title: 'Theirs' })).body.folder;
  const key = `shared_${crypto.randomBytes(8).toString('hex')}`;
  const a = await owner.post(`/api/folders/${mine.id}/cards`).set('Idempotency-Key', key).send(card('mine'));
  const b = await other.post(`/api/folders/${theirs.id}/cards`).set('Idempotency-Key', key).send(card('theirs'));
  assert.equal(b.status, 201); assert.notEqual(a.body.card.id, b.body.card.id);
  const leak = await other.post(`/api/folders/${mine.id}/cards`).set('Idempotency-Key', key).send(card('x'));
  assert.equal(leak.status, 404, 'no access to the folder, no answer');
});

integration('creating the same page twice with one key makes one page', async () => {
  const home = (await owner.post('/api/note-collections').send({ title: 'Offline notes' })).body.collection;
  const nb = (await owner.post('/api/notebooks').send({ title: 'Offline book', collection: home.id })).body.notebook;
  const key = `note_${crypto.randomBytes(8).toString('hex')}`;
  const a = await owner.post(`/api/notebooks/${nb.id}/notes`).set('Idempotency-Key', key).send({ title: 'Quick', body: 'jot' });
  const b = await owner.post(`/api/notebooks/${nb.id}/notes`).set('Idempotency-Key', key).send({ title: 'Quick', body: 'jot' });
  assert.equal(a.status, 201); assert.equal(a.body.note.id, b.body.note.id);
  assert.equal(await Note.countDocuments({ notebook: nb.id }), 1);
});
