import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import request from 'supertest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { createApp } from '../src/app.js';
import { allModels, Folder, GameProfile, Progress, Review } from '../src/models/index.js';
import { BRAND } from '../../shared/brand.js';

const enabled = process.env.RUN_INTEGRATION === '1';
const integration = (name, fn) => test(name, { skip: !enabled }, fn);
let mongo, app, learner, stranger, folderId, cards = [], privateCard;
const password = 'Batch-tests-password-2026';
const item = (c, extra = {}) => ({ cardId: c.id, rating: 'good', requestId: crypto.randomUUID(), version: 0, mode: 'classic', ...extra });
const sync = (reviews, agent = learner) => agent.post('/api/reviews/batch').send({ reviews });

async function signup(agent, username) {
  const r = await agent.post('/api/auth/signup').send({ username, name: username, email: `${username}@example.test`, password, country: 'India', acceptedTerms: true });
  assert.equal(r.status, 201, JSON.stringify(r.body));
}

before(async () => {
  if (!enabled) return;
  process.env.DISABLE_RATE_LIMIT = '1';
  if (!process.env.TEST_MONGODB_URI) mongo = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  await mongoose.connect(process.env.TEST_MONGODB_URI || mongo.getUri(), { dbName: `${BRAND.slug}_batch_${crypto.randomBytes(6).toString('hex')}` });
  await Promise.all(allModels.map(m => m.init()));
  app = createApp(); learner = request.agent(app); stranger = request.agent(app);
  await signup(learner, 'batcher'); await signup(stranger, 'outsider');
  folderId = (await learner.post('/api/folders').send({ title: 'Rivers' })).body.folder.id;
  for (const [q, a] of [['Longest river?', 'Nile'], ['River through Paris?', 'Seine'], ['River through London?', 'Thames'], ['River through Vienna?', 'Danube']]) {
    assert.equal((await learner.post(`/api/folders/${folderId}/cards`).send({ front: { text: q }, back: { text: a } })).status, 201);
  }
  cards = (await learner.get(`/api/folders/${folderId}/cards`)).body.cards;
  const theirs = (await stranger.post('/api/folders').send({ title: 'Private' })).body.folder.id;
  privateCard = (await stranger.post(`/api/folders/${theirs}/cards`).send({ front: { text: 'Secret?' }, back: { text: 'Yes' } })).body.card;
});
after(async () => {
  if (mongoose.connection.readyState) { await mongoose.connection.dropDatabase(); await mongoose.disconnect(); }
  if (mongo) await mongo.stop();
  delete process.env.DISABLE_RATE_LIMIT;
});

integration('a batch applies every review in one request, keeping when each was answered', async () => {
  const epoch = (await Folder.findById(folderId).lean()).writeEpoch;
  const answeredAt = new Date(Date.now() - 3 * 60000).toISOString();
  const batch = [item(cards[0], { reviewedAt: answeredAt }), item(cards[1], { rating: 'again' }), item(cards[2], { rating: 'easy' })];
  const res = await sync(batch);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body.results.map(r => [r.requestId, r.ok]), batch.map(b => [b.requestId, true]));
  assert.ok(res.body.results.every(r => r.progress.version === 1 && r.game));
  const stored = await Review.findOne({ requestId: batch[0].requestId }).lean();
  assert.equal(stored.createdAt.toISOString(), answeredAt, 'stats count the review when it happened, not when it synced');
  assert.equal((await Progress.findOne({ card: cards[0].id }).lean()).lastReviewedAt.toISOString(), answeredAt);
  const profile = await GameProfile.findOne({}).lean();
  assert.equal(profile.reviews, 3); assert.equal(profile.xp, res.body.results.reduce((n, r) => n + r.game.xp, 0));
  assert.equal((await Folder.findById(folderId).lean()).writeEpoch, epoch, 'studying does not take the folder write lock');

  const resent = await sync(batch);
  assert.deepEqual(resent.body.results, res.body.results, 'a resent batch answers from what was stored');
  assert.equal(await Review.countDocuments({}), 3); assert.equal((await GameProfile.findOne({}).lean()).xp, profile.xp);
});

integration('one stale or forbidden review is refused on its own; the rest still apply', async () => {
  const [c] = (await learner.get(`/api/folders/${folderId}/cards`)).body.cards.filter(x => x.id === cards[0].id);
  const batch = [
    item(c, { version: c.progress.version }),
    item(c, { version: c.progress.version + 1, rating: 'hard' }),
    item(c, { version: c.progress.version }),
    item(privateCard),
    item(cards[3]),
  ];
  const { body } = await sync(batch);
  assert.deepEqual(body.results.map(r => r.ok), [true, true, false, false, true]);
  assert.equal(body.results[1].progress.version, c.progress.version + 2, 'the same card twice in a batch chains its versions');
  assert.equal(body.results[2].code, 'VERSION_CONFLICT'); assert.equal(body.results[2].progress.version, c.progress.version + 2);
  assert.equal(body.results[3].status, 404, 'another learner’s private card stays invisible');
  assert.equal(await Progress.countDocuments({ card: privateCard.id }), 0);
});

integration('a request id reused for a different card is refused, and clocks are clamped', async () => {
  const fresh = (await learner.get(`/api/folders/${folderId}/cards`)).body.cards;
  const reused = item(fresh[1], { version: fresh[1].progress.version });
  const { body } = await sync([reused, { ...item(fresh[2], { version: fresh[2].progress.version }), requestId: reused.requestId }]);
  assert.equal(body.results[0].ok, true); assert.equal(body.results[1].code, 'CONFLICT');

  const future = item(fresh[3], { version: fresh[3].progress.version, reviewedAt: new Date(Date.now() + 86400000).toISOString() });
  const before = Date.now();
  await sync([future]);
  const at = (await Review.findOne({ requestId: future.requestId }).lean()).createdAt.getTime();
  assert.ok(at <= Date.now() && at >= before - 1000, 'a clock in the future counts as now');
  const ancient = item(fresh[0], { version: (await Progress.findOne({ card: fresh[0].id }).lean()).version, reviewedAt: '2020-01-01T00:00:00.000Z' });
  await sync([ancient]);
  const old = (await Review.findOne({ requestId: ancient.requestId }).lean()).createdAt.getTime();
  assert.ok(old >= Date.now() - 7 * 86400000 - 5000, 'nothing is backdated past a week');
});

integration('batches are bounded and validated', async () => {
  assert.equal((await sync([])).status, 400);
  assert.equal((await sync(Array.from({ length: 101 }, () => item(cards[0])))).status, 400);
  assert.equal((await sync([item(cards[0], { reviewedAt: 'yesterday' })])).status, 400);
  assert.equal((await sync([item(cards[0])], request(app))).status, 401);
});
