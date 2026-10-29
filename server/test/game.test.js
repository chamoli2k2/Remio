import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import request from 'supertest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { createApp } from '../src/app.js';
import { allModels, GameProfile, Review, User } from '../src/models/index.js';
import { BRAND } from '../../shared/brand.js';
import { answerParts, gradeAnswer, plainOf, compareAnswer } from '../../shared/answers.js';
import { xpForReview, levelOf, levelFloor, BADGES, XP } from '../../shared/game.js';

const card = (back, front = 'Q') => ({ front: { text: front }, back: { text: back } });

test('a long answer is reduced to its bold key term; a short one is kept whole', () => {
  assert.deepEqual(answerParts(card('Paris')), { display: 'Paris', target: 'Paris', whole: true });
  const long = answerParts(card('**Mitochondria** are where the cell makes ATP.\n\nFor example, muscle cells have thousands of them.'));
  assert.equal(long.display, 'Mitochondria'); assert.equal(long.target, 'Mitochondria');
  const prose = answerParts(card('Photosynthesis is how plants turn light into sugar. It happens in the chloroplasts and needs water.'));
  assert.equal(prose.display, 'Photosynthesis is how plants turn light into sugar.');
  assert.equal(prose.target, null, 'a sentence is not something to type');
  const lead = answerParts(card('The Constitution. Every other law — federal, state or local — has to give way to it.'));
  assert.equal(lead.display, 'The Constitution.');
  assert.equal(answerParts(card('"We the People." The point is that the government’s authority comes from the governed.')).display, '"We the People."'); assert.equal(gradeAnswer('constitution', lead.target), 'exact');
  assert.equal(answerParts(card('$E = mc^2$')).target, null, 'equations are not typed');
  assert.equal(answerParts(card('', 'The {{c1::heart}} pumps {{c2::blood}}.')).display, 'heart, blood');
  assert.equal(answerParts(card('')), null);
  assert.equal(plainOf('**bold** and `code` and [a link](https://x.test) and snake_case_name'), 'bold and code and a link and snake_case_name');
});

test('typed and spoken answers forgive case, accents, articles, small typos and number words', () => {
  assert.equal(gradeAnswer('paris', 'Paris'), 'exact');
  assert.equal(gradeAnswer('The Paris', 'Paris'), 'exact');
  assert.equal(gradeAnswer('it is paris', 'Paris'), 'exact', 'said out loud with extra words');
  assert.equal(gradeAnswer('Cafe', 'Café'), 'exact');
  assert.equal(gradeAnswer('seven', '7'), 'exact');
  assert.equal(gradeAnswer('27', 'Twenty-seven.'), 'exact');
  assert.equal(gradeAnswer('color', 'colour / color'), 'exact');
  assert.equal(gradeAnswer('mitocondria', 'Mitochondria'), 'close');
  assert.equal(gradeAnswer('berlin', 'Paris'), 'wrong');
  assert.equal(gradeAnswer('17', '7'), 'wrong', 'a number inside another is not the number');
  assert.equal(gradeAnswer('cat', 'car'), 'wrong', 'no typo allowance on three letters');
  assert.equal(gradeAnswer('', 'Paris'), 'wrong');
});

test('a spoken answer is compared with the whole written answer, weighting its opening', () => {
  const photo = card('Photosynthesis is how plants turn light into sugar. It happens in the chloroplasts and needs water and carbon dioxide.', 'What is photosynthesis?');
  assert.equal(compareAnswer('plants use light to make sugar in the chloroplasts with water and carbon dioxide', photo).verdict, 'right');
  assert.equal(compareAnswer('plants make sugar from light', photo).verdict, 'close');
  assert.equal(compareAnswer('it is about animals eating', photo).verdict, 'wrong');
  const mito = card('**Mitochondria** are where the cell makes ATP.\n\nFor example, muscle cells have thousands of them.', 'Where does the cell make ATP?');
  assert.equal(compareAnswer('the mitochondria', mito).score, 1, 'the key term alone is enough');
  assert.equal(compareAnswer('ribosomes', mito).verdict, 'wrong');
  const result = compareAnswer('plants make sugar from light', photo);
  assert.ok(result.hit.includes('sugar') && result.missed.includes('chloroplasts'), 'reports which key words were said and missed');
  assert.ok(!result.missed.includes('photosynthesis'), 'words the question already says are not expected back');
});

test('XP rewards effort and streaks, pays almost nothing for a repeat, and levels follow the curve', () => {
  assert.equal(xpForReview({ rating: 'good' }), 10);
  assert.equal(xpForReview({ rating: 'good', mode: 'voice' }), 18);
  assert.equal(xpForReview({ rating: 'again', mode: 'type', combo: 0 }), 3);
  assert.equal(xpForReview({ rating: 'good', combo: 50 }), 10 + XP.comboCap);
  assert.equal(xpForReview({ rating: 'good', firstSight: true }), 10 + XP.firstSight);
  assert.equal(xpForReview({ rating: 'easy', mode: 'voice', combo: 20, repeat: true }), XP.repeatXp);
  assert.equal(levelOf(0).level, 1); assert.equal(levelOf(99).level, 1); assert.equal(levelOf(100).level, 2); assert.equal(levelOf(1000).level, 5);
  for (const xp of [0, 57, 300, 4999, 123456]) { const l = levelOf(xp); assert.ok(xp >= levelFloor(l.level) && xp < levelFloor(l.level + 1)); }
  assert.equal(new Set(BADGES.map(b => b.id)).size, BADGES.length, 'badge ids are unique');
});

const enabled = process.env.RUN_INTEGRATION === '1';
const integration = (name, fn) => test(name, { skip: !enabled }, fn);
let mongo, app, learner, folderId, cards = [];
const password = 'Game-tests-password-2026';
const review = (c, extra = {}) => learner.post('/api/reviews').send({ cardId: c.id, rating: 'good', requestId: crypto.randomUUID(), version: c.progress?.version || 0, ...extra });
const freshCards = async () => (await learner.get(`/api/folders/${folderId}/cards`)).body.cards;

before(async () => {
  if (!enabled) return;
  process.env.DISABLE_RATE_LIMIT = '1';
  if (!process.env.TEST_MONGODB_URI) mongo = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  await mongoose.connect(process.env.TEST_MONGODB_URI || mongo.getUri(), { dbName: `${BRAND.slug}_game_${crypto.randomBytes(6).toString('hex')}` });
  await Promise.all(allModels.map(m => m.init()));
  app = createApp(); learner = request.agent(app);
  const signup = await learner.post('/api/auth/signup').send({ username: 'gamer', name: 'Gamer', email: 'gamer@example.test', password, country: 'India', acceptedTerms: true });
  assert.equal(signup.status, 201, JSON.stringify(signup.body));
  await User.updateOne({ username: 'gamer' }, { $set: { dailyGoal: 3 } });
  folderId = (await learner.post('/api/folders').send({ title: 'Capitals' })).body.folder.id;
  for (const [q, a] of [['France?', 'Paris'], ['Germany?', 'Berlin'], ['Italy?', 'Rome'], ['Spain?', 'Madrid'], ['Japan?', 'Tokyo'], ['Peru?', 'Lima'], ['Chile?', 'Santiago']]) {
    const r = await learner.post(`/api/folders/${folderId}/cards`).send({ front: { text: q }, back: { text: a } }); assert.equal(r.status, 201);
  }
  cards = await freshCards();
});
after(async () => {
  if (mongoose.connection.readyState) { await mongoose.connection.dropDatabase(); await mongoose.disconnect(); }
  if (mongo) await mongo.stop();
  delete process.env.DISABLE_RATE_LIMIT;
});

integration('a review earns XP and the first badge, and a retried request is not paid twice', async () => {
  const body = { cardId: cards[0].id, rating: 'good', requestId: crypto.randomUUID(), version: 0, mode: 'type', localHour: 2 };
  const first = await learner.post('/api/reviews').send(body);
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.equal(first.body.game.xp, xpForReview({ rating: 'good', mode: 'type', combo: 1, firstSight: true }));
  assert.deepEqual(first.body.game.badges, ['first-light']);
  const again = await learner.post('/api/reviews').send(body);
  assert.deepEqual(again.body.game, first.body.game, 'the stored result comes back');
  const profile = await GameProfile.findOne({}).lean();
  assert.equal(profile.xp, first.body.game.xp); assert.equal(profile.reviews, 1);
  assert.equal(profile.correct.type, 1); assert.equal(profile.night, 1); assert.deepEqual(profile.modesTried, ['type']);
  assert.equal((await Review.findOne({ requestId: body.requestId })).mode, 'type');
});

integration('the same card again within minutes pays one XP, and a wrong answer resets the streak', async () => {
  const [c] = (await freshCards()).filter(x => x.id === cards[0].id);
  const repeat = await review(c, { rating: 'again' });
  assert.equal(repeat.status, 200); assert.equal(repeat.body.game.xp, XP.repeatXp); assert.equal(repeat.body.game.combo, 0);
});

integration('reaching the daily goal adds the bonus once', async () => {
  const fresh = await freshCards();
  const third = await review(fresh[1], { mode: 'mcq' });
  assert.equal(third.body.game.goalBonus, true, 'the third review of the day meets a goal of 3');
  assert.ok(third.body.game.xp >= XP.goalBonus);
  const fourth = await review(fresh[2], { mode: 'mcq' });
  assert.equal(fourth.body.game.goalBonus, false);
});

integration('a match board only counts after its pairs were actually reviewed', async () => {
  const fresh = await freshCards();
  const cheat = await review(fresh[4], { mode: 'match', board: { pairs: 6, mistakes: 0 } });
  assert.equal(cheat.status, 200);
  assert.equal((await GameProfile.findOne({}).lean()).boards, 0, 'one review cannot claim a six-pair board');
  const honest = await review(fresh[5], { mode: 'match', board: { pairs: 2, mistakes: 0 } });
  assert.equal(honest.status, 200);
  const p = await GameProfile.findOne({}).lean();
  assert.equal(p.boards, 1); assert.equal(p.flawless, 0, 'a two-pair board is not a clean sweep');
});

integration('XP stops at the daily cap', async () => {
  await GameProfile.updateOne({}, { $set: { 'today.xp': XP.dailyCap - 2 } });
  const fresh = await freshCards();
  const capped = await review(fresh[6], { mode: 'voice' });
  assert.equal(capped.body.game.xp, 2); assert.equal(capped.body.game.capped, true);
});

integration('unknown modes and impossible boards are refused', async () => {
  const fresh = await freshCards();
  assert.equal((await review(fresh[6], { mode: 'cheat' })).status, 400);
  assert.equal((await review(fresh[6], { mode: 'match', board: { pairs: 40, mistakes: 0 } })).status, 400);
  assert.equal((await review(fresh[6], { localHour: 25 })).status, 400);
});

integration('stats carry the level and every badge with its progress', async () => {
  const { stats } = (await learner.get('/api/stats')).body;
  assert.ok(stats.game.level.level >= 1);
  assert.equal(stats.game.badges.length, BADGES.length);
  assert.ok(stats.game.badges.find(b => b.id === 'first-light').at);
  const chameleon = stats.game.badges.find(b => b.id === 'chameleon');
  assert.equal(chameleon.at, null); assert.equal(chameleon.value, 5, 'type, classic, mcq, match and voice so far');
});

integration('deleting the account deletes its game profile', async () => {
  const res = await learner.delete('/api/auth/account').send({ password, confirm: 'delete my account' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(await GameProfile.countDocuments({}), 0);
});
