import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import request from 'supertest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { createApp } from '../src/app.js';
import { allModels, Referral, Review, User } from '../src/models/index.js';
import { grantPremiumDays, studyDays } from '../src/services/referralService.js';
import { REFERRAL, REFERRAL_CAP } from '../src/constants/index.js';
import { BRAND } from '../../shared/brand.js';

const enabled = process.env.RUN_INTEGRATION === '1';
const DAY = 86400000;
let mongo, app, sequence = 0;
const password = 'Referral-integration-2026';

before(async () => {
  if (!enabled) return;
  process.env.DISABLE_RATE_LIMIT = '1';
  const dbName = `${BRAND.slug}_referral_${crypto.randomBytes(6).toString('hex')}`;
  if (!process.env.TEST_MONGODB_URI) mongo = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  await mongoose.connect(process.env.TEST_MONGODB_URI || mongo.getUri(), { dbName });
  await Promise.all(allModels.map(m => m.init()));
  app = createApp();
});

after(async () => {
  if (mongoose.connection.readyState) { await mongoose.connection.dropDatabase(); await mongoose.disconnect(); }
  if (mongo) await mongo.stop();
  delete process.env.DISABLE_RATE_LIMIT;
});

const integration = (name, fn) => test(name, { skip: !enabled }, fn);

/** A signed-in person, optionally invited. Their email counts as proven, as it would be in production. */
async function person(referralCode) {
  const username = `ref${++sequence}${crypto.randomBytes(2).toString('hex')}`;
  const agent = request.agent(app);
  const r = await agent.post('/api/auth/signup').send({ username, name: `Person ${sequence}`, email: `${username}@example.test`, password, country: 'India', acceptedTerms: true, ...(referralCode ? { referralCode } : {}) });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  await User.updateOne({ username }, { $set: { emailVerifiedAt: new Date() } });
  return { agent, username, id: r.body.user.id };
}

/** Study on `n` different days, written straight to the log the way real reviews would land. */
async function studyOn(user, n) {
  const rows = Array.from({ length: n }, (_, i) => ({ user: new mongoose.Types.ObjectId(user.id), card: new mongoose.Types.ObjectId(), requestId: crypto.randomUUID(), rating: 'good', createdAt: new Date(Date.now() - i * DAY), updatedAt: new Date() }));
  await Review.collection.insertMany(rows);
}

const premiumDaysLeft = async user => {
  const doc = await User.findById(user.id).select('account premiumExpiresAt premiumPlan');
  return { account: doc.account, plan: doc.premiumPlan, days: doc.premiumExpiresAt ? Math.round((doc.premiumExpiresAt - Date.now()) / DAY) : 0 };
};

integration('everybody gets a code of their own, and can pick a better one until it is used', async () => {
  const a = await person();
  const first = await a.agent.get('/api/referrals');
  assert.equal(first.status, 200);
  assert.match(first.body.code, /^[A-Z0-9]{4,20}$/);
  assert.equal(first.body.program.cap, REFERRAL_CAP, 'the cap is stated, not implied');

  const chosen = `ALPHA${sequence}X`;
  const set = await a.agent.put('/api/referrals/code').send({ code: chosen.toLowerCase() });
  assert.equal(set.status, 200);
  assert.equal(set.body.code, chosen, 'case and punctuation do not make a different code');

  const b = await person();
  const taken = await b.agent.put('/api/referrals/code').send({ code: chosen });
  assert.equal(taken.status, 409);
  assert.equal(taken.body.code, 'CODE_TAKEN');
  assert.equal((await b.agent.put('/api/referrals/code').send({ code: 'ab' })).status, 400, 'too short');
  assert.equal((await b.agent.put('/api/referrals/code').send({ code: 'admin' })).status, 400, 'reserved words are refused');

  await person(chosen);
  const locked = await a.agent.put('/api/referrals/code').send({ code: `BETA${sequence}X` });
  assert.equal(locked.status, 409, 'a code somebody has joined with cannot be pulled out from under them');
  assert.equal(locked.body.code, 'CODE_LOCKED');
});

integration('a code can be checked before signing up, and a wrong one never blocks an account', async () => {
  const a = await person();
  const { body: { code } } = await a.agent.get('/api/referrals');
  const ok = await request(app).get(`/api/referrals/check/${code.toLowerCase()}`);
  assert.equal(ok.body.valid, true);
  assert.equal(ok.body.refereeRewardDays, REFERRAL.refereeRewardDays);
  assert.equal(ok.body.name.includes(' '), false, 'only a first name is shown to a stranger');
  assert.equal((await request(app).get('/api/referrals/check/NOSUCHCODE')).body.valid, false);

  const stray = await person('NOSUCHCODE');
  assert.equal((await stray.agent.get('/api/referrals')).body.invitedBy, null, 'the account exists, with no inviter');
});

integration('you cannot invite yourself, or somebody who invited you', async () => {
  const a = await person();
  const { body: { code } } = await a.agent.get('/api/referrals');
  const own = await a.agent.post('/api/referrals/redeem').send({ code });
  assert.equal(own.status, 400);
  assert.equal(own.body.code, 'SELF_REFERRAL');

  const b = await person(code);
  const { body: { code: bCode } } = await b.agent.get('/api/referrals');
  const back = await a.agent.post('/api/referrals/redeem').send({ code: bCode });
  assert.equal(back.status, 400);
  assert.equal(back.body.code, 'CYCLE');
});

integration('a code is used once, and only in the first week', async () => {
  const a = await person();
  const { body: { code } } = await a.agent.get('/api/referrals');
  const b = await person();
  assert.equal((await b.agent.post('/api/referrals/redeem').send({ code })).status, 200, 'an account made another way can add one');
  const again = await b.agent.post('/api/referrals/redeem').send({ code });
  assert.equal(again.status, 409);
  assert.equal(again.body.code, 'ALREADY_REFERRED');

  const old = await person();
  await User.collection.updateOne({ _id: new mongoose.Types.ObjectId(old.id) }, { $set: { createdAt: new Date(Date.now() - (REFERRAL.redeemWindowDays + 1) * DAY) } });
  const late = await old.agent.post('/api/referrals/redeem').send({ code });
  assert.equal(late.status, 400);
  assert.equal(late.body.code, 'WINDOW_CLOSED');
});

integration('nothing is paid until the invited person has studied on seven different days', async () => {
  const a = await person();
  const { body: { code } } = await a.agent.get('/api/referrals');
  const b = await person(code);

  await studyOn(b, REFERRAL.activeDaysRequired - 1);
  const early = await b.agent.get('/api/referrals');
  assert.equal(early.body.invitedBy.status, 'joined');
  assert.equal(early.body.invitedBy.activeDays, REFERRAL.activeDaysRequired - 1);
  assert.equal((await premiumDaysLeft(b)).account, 'normal');
  assert.equal((await premiumDaysLeft(a)).account, 'normal');

  // Ten reviews on one day are one day, not ten.
  await Review.collection.insertMany(Array.from({ length: 10 }, () => ({ user: new mongoose.Types.ObjectId(b.id), card: new mongoose.Types.ObjectId(), requestId: crypto.randomUUID(), rating: 'good', createdAt: new Date(), updatedAt: new Date() })));
  assert.equal(await studyDays(b.id), REFERRAL.activeDaysRequired - 1);

  await studyOn(b, REFERRAL.activeDaysRequired + 1);
  const done = await b.agent.get('/api/referrals');
  assert.equal(done.body.invitedBy.status, 'qualified');

  const invitee = await premiumDaysLeft(b);
  assert.equal(invitee.account, 'premium');
  assert.equal(invitee.plan, 'referral');
  assert.equal(invitee.days, REFERRAL.refereeRewardDays, 'the invited person gets their days');
  const inviter = await premiumDaysLeft(a);
  assert.equal(inviter.days, REFERRAL.milestones[0].days, 'and the inviter reaches their first milestone');

  // Looking again, or studying more, can never pay a second time.
  await b.agent.get('/api/referrals'); await a.agent.get('/api/referrals');
  assert.equal((await premiumDaysLeft(b)).days, REFERRAL.refereeRewardDays);
  assert.equal((await premiumDaysLeft(a)).days, REFERRAL.milestones[0].days);

  const mine = await a.agent.get('/api/referrals');
  assert.equal(mine.body.qualified, 1);
  assert.equal(mine.body.invitees[0].status, 'qualified');
  assert.equal(mine.body.next.remaining, REFERRAL.milestones[1].qualified - 1);
  const note = await a.agent.get('/api/notifications');
  assert.ok(note.body.notifications.some(n => n.type === 'referral.qualified'), 'the inviter is told');
});

integration('rewards follow the milestones and stop at the cap, while every invited person still gets theirs', async () => {
  const a = await person();
  const { body: { code } } = await a.agent.get('/api/referrals');
  let total = 0;
  for (let i = 1; i <= REFERRAL_CAP + 1; i++) {
    const invitee = await person(code);
    await studyOn(invitee, REFERRAL.activeDaysRequired);
    await invitee.agent.get('/api/referrals');
    const milestone = REFERRAL.milestones.find(m => m.qualified === i);
    if (milestone) total += milestone.days;
    assert.equal((await premiumDaysLeft(invitee)).days, REFERRAL.refereeRewardDays, `invitee ${i} is rewarded`);
    assert.equal((await premiumDaysLeft(a)).days, total, `the inviter has ${total} days after ${i}`);
  }
  const overview = await a.agent.get('/api/referrals');
  assert.equal(overview.body.capReached, true);
  assert.equal(overview.body.earnedDays, total);
});

integration('two invited people qualifying at the same moment do not share a milestone', async () => {
  const a = await person();
  const { body: { code } } = await a.agent.get('/api/referrals');
  const invitees = [await person(code), await person(code), await person(code)];
  for (const i of invitees) await studyOn(i, REFERRAL.activeDaysRequired);
  await Promise.all(invitees.map(i => i.agent.get('/api/referrals')));
  const expected = REFERRAL.milestones.filter(m => m.qualified <= 3).reduce((s, m) => s + m.days, 0);
  assert.equal((await premiumDaysLeft(a)).days, expected);
  assert.equal(await Referral.countDocuments({ referrer: a.id, status: 'qualified' }), 3);
});

integration('an account without a verified email earns nothing yet', async () => {
  const a = await person();
  const { body: { code } } = await a.agent.get('/api/referrals');
  const b = await person(code);
  await User.updateOne({ _id: b.id }, { $set: { emailVerifiedAt: null } });
  await studyOn(b, REFERRAL.activeDaysRequired);
  const r = await b.agent.get('/api/referrals');
  // Sign-up proves the inbox in production, so this only bites where proof is required.
  const required = process.env.NODE_ENV === 'production' || process.env.EMAIL_CODES !== 'off';
  assert.equal(r.body.invitedBy.status, required ? 'joined' : 'qualified');
});

integration('adding days never shortens or replaces what somebody already has', async () => {
  const lasting = await person();
  await User.updateOne({ _id: lasting.id }, { $set: { account: 'premium', premiumPlan: 'yearly', premiumExpiresAt: null } });
  assert.equal(await grantPremiumDays(lasting.id, 15), false, 'a plan with no end date is left alone');
  assert.equal((await User.findById(lasting.id)).premiumExpiresAt, null);

  const staff = await person();
  await User.updateOne({ _id: staff.id }, { $set: { account: 'admin' } });
  assert.equal(await grantPremiumDays(staff.id, 15), false);
  assert.equal((await User.findById(staff.id)).account, 'admin');

  const paid = await person();
  const end = new Date(Date.now() + 100 * DAY);
  await User.updateOne({ _id: paid.id }, { $set: { account: 'premium', premiumPlan: 'quarterly', premiumExpiresAt: end } });
  assert.equal(await grantPremiumDays(paid.id, 15), true);
  const after = await User.findById(paid.id);
  assert.equal(after.premiumPlan, 'quarterly', 'a paid plan keeps its name');
  assert.equal(Math.round((after.premiumExpiresAt - end) / DAY), 15, 'and the days are added on top');
});
