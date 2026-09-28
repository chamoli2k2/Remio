import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import request from 'supertest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { createApp } from '../src/app.js';
import {
  allModels, User, Session, AuthToken, Folder, Card, Progress, Review, Project,
  Notification, Relationship, PremiumOrder, Team, TeamMember,
} from '../src/models/index.js';
import { _setTransport } from '../src/services/mailService.js';
import { BRAND } from '../../shared/brand.js';

const enabled = process.env.RUN_INTEGRATION === '1';
let mongo, app;
const password = 'Account-tests-password-2026';
/** Captures what would have gone out, and hands back the link so a test can follow it. */
const sent = [];
const mailTo = to => sent.filter(m => m.to === to);
/**
 * Signup does not wait for the mail to go out, because a slow SMTP server must not slow down
 * creating an account. Tests therefore wait for it rather than assuming it already landed, and
 * they wait on the address they care about: a straggler from an earlier test must not be mistaken
 * for this one's.
 */
const waitForMail = async (to, count = 1, timeoutMs = 2000) => {
  const deadline = Date.now() + timeoutMs;
  while (mailTo(to).length < count && Date.now() < deadline) await new Promise(r => setTimeout(r, 10));
  const found = mailTo(to);
  assert.ok(found.length >= count, `expected ${count} email(s) to ${to}, saw ${found.length}`);
  return found.at(-1);
};
const linkFor = (to, page = 'verify-email') => {
  const mail = mailTo(to).at(-1);
  return mail && (mail.text.match(new RegExp(`https?://\\S+/${page}\\?token=([a-f\\d]{64})`)) || [])[1];
};

before(async () => {
  if (!enabled) return;
  process.env.SMTP_HOST = 'test.invalid';
  // Every request here comes from one IP, and the suite makes far more auth calls than a person would.
  process.env.DISABLE_RATE_LIMIT = '1';
  _setTransport({ sendMail: async mail => { sent.push(mail); return { messageId: 'test' }; } });
  const dbName = `${BRAND.slug}_acct_${crypto.randomBytes(6).toString('hex')}`;
  if (!process.env.TEST_MONGODB_URI) mongo = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  await mongoose.connect(process.env.TEST_MONGODB_URI || mongo.getUri(), { dbName });
  await Promise.all(allModels.map(m => m.init()));
  app = createApp();
});
after(async () => {
  if (mongoose.connection.readyState) { await mongoose.connection.dropDatabase(); await mongoose.disconnect(); }
  if (mongo) await mongo.stop();
  delete process.env.SMTP_HOST;
  delete process.env.DISABLE_RATE_LIMIT;
});
beforeEach(() => { sent.length = 0; });

const acct = (name, fn) => test(name, { skip: !enabled }, fn);

/** A signed-in agent with a unique username, so tests do not collide on the unique index. */
async function signUp(prefix) {
  const username = `${prefix}${crypto.randomBytes(3).toString('hex')}`;
  const agent = request.agent(app);
  const email = `${username}@example.test`;
  const r = await agent.post('/api/auth/signup').send({ username, name: prefix, email, password, country: 'India', acceptedTerms: true });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  await waitForMail(email);
  return { agent, username, email, id: r.body.user.id };
}

/** Follows the emailed link. Anything that announces itself by email needs a confirmed address. */
async function confirmEmail(email) {
  const r = await request(app).post('/api/auth/verify-email').send({ token: linkFor(email) });
  assert.equal(r.status, 200, JSON.stringify(r.body));
}

acct('signing up sends a confirmation link and the account starts unconfirmed', async () => {
  const { id, email } = await signUp('verify');
  assert.equal(mailTo(email).length, 1);
  assert.match(mailTo(email)[0].subject, /confirm your email/i);
  assert.ok(linkFor(email), 'the email carries a token');
  assert.equal((await User.findById(id)).emailVerifiedAt, null);
});

acct('following the link confirms the address, and following it again is not an error', async () => {
  const { id, email } = await signUp('once');
  const token = linkFor(email);

  const first = await request(app).post('/api/auth/verify-email').send({ token });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  const confirmedAt = (await User.findById(id)).emailVerifiedAt;
  assert.ok(confirmedAt, 'now confirmed');
  assert.ok((await AuthToken.findOne({ user: id })).usedAt, 'the token is spent');

  // A double-click, a reload, or a mail scanner prefetching the link must not look like a failure.
  const again = await request(app).post('/api/auth/verify-email').send({ token });
  assert.equal(again.status, 200);
  assert.deepEqual((await User.findById(id)).emailVerifiedAt, confirmedAt, 'and it is not re-stamped');
});

acct('a token nobody issued is refused', async () => {
  const r = await request(app).post('/api/auth/verify-email').send({ token: 'a'.repeat(64) });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /not valid/i);
});

acct('only the hash of a confirmation token is stored', async () => {
  const { email } = await signUp('hashed');
  const token = linkFor(email);
  const rows = await AuthToken.find({ purpose: 'verify-email' }).lean();
  assert.ok(rows.length);
  for (const row of rows) assert.notEqual(row.tokenHash, token, 'the raw token must not be in the database');
});

acct('an expired link is refused', async () => {
  const { id, email } = await signUp('expired');
  const token = linkFor(email);
  await AuthToken.updateOne({ user: id }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
  const r = await request(app).post('/api/auth/verify-email').send({ token });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /expired/i);
});

acct('a garbled token is rejected before it reaches the database', async () => {
  const r = await request(app).post('/api/auth/verify-email').send({ token: 'not-a-token' });
  assert.equal(r.status, 400);
});

acct('resending replaces the previous link rather than leaving both usable', async () => {
  const { agent, id, email } = await signUp('resend');
  const first = linkFor(email);

  const immediate = await agent.post('/api/auth/verify-email/resend').send({});
  assert.equal(immediate.body.sent, false, 'asking again straight away does not mint a second link');
  assert.equal(immediate.body.reason, 'too-soon');

  // Age the link past the resend gap. This goes through the driver because Mongoose treats
  // `createdAt` as immutable and would quietly drop the change.
  await AuthToken.collection.updateOne({ user: new mongoose.Types.ObjectId(id) }, { $set: { createdAt: new Date(Date.now() - 120000) } });

  const r = await agent.post('/api/auth/verify-email/resend').send({});
  assert.equal(r.status, 200);
  assert.equal(r.body.sent, true);
  await waitForMail(email, 2);
  const second = linkFor(email);
  assert.notEqual(second, first);

  assert.equal((await request(app).post('/api/auth/verify-email').send({ token: first })).status, 400, 'the old link is dead');
  assert.equal((await request(app).post('/api/auth/verify-email').send({ token: second })).status, 200);
});

acct('changing a password is refused until the address is confirmed', async () => {
  const { agent } = await signUp('gated');
  const r = await agent.post('/api/auth/password').send({ currentPassword: password, newPassword: 'A-brand-new-password-2026' });
  assert.equal(r.status, 403);
  assert.equal(r.body.code, 'EMAIL_UNVERIFIED');
});

acct('changing a password needs the current one and signs out the other devices', async () => {
  const { agent, username, email } = await signUp('pw');
  await confirmEmail(email);

  // A second device on the same account.
  const other = request.agent(app);
  assert.equal((await other.post('/api/auth/login').send({ identifier: username, password })).status, 200);
  assert.equal((await other.get('/api/auth/me')).body.user?.username, username);

  const wrong = await agent.post('/api/auth/password').send({ currentPassword: 'not-the-password', newPassword: 'A-brand-new-password-2026' });
  assert.equal(wrong.status, 400);

  const same = await agent.post('/api/auth/password').send({ currentPassword: password, newPassword: password });
  assert.equal(same.status, 400, 'reusing the current password is refused');

  const ok = await agent.post('/api/auth/password').send({ currentPassword: password, newPassword: 'A-brand-new-password-2026' });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.signedOutElsewhere, 1);

  assert.equal((await other.get('/api/auth/me')).body.user, null, 'the other device is signed out');
  assert.equal((await agent.get('/api/auth/me')).body.user?.username, username, 'the device that changed it stays in');
  assert.match(mailTo(email).at(-1).subject, /password was changed/i);

  assert.equal((await request(app).post('/api/auth/login').send({ identifier: username, password })).status, 401);
  assert.equal((await request(app).post('/api/auth/login').send({ identifier: username, password: 'A-brand-new-password-2026' })).status, 200);
});

acct('asking to reset emails a link, and an address nobody owns gets the same answer', async () => {
  const { email } = await signUp('forgot');

  const mine = await request(app).post('/api/auth/password/forgot').send({ email });
  assert.equal(mine.status, 200);
  assert.deepEqual(mine.body, { ok: true });
  const mail = await waitForMail(email, 2);
  assert.match(mail.subject, /reset your/i);
  assert.ok(linkFor(email, 'reset-password'), 'the email carries a reset token');

  // Identical response and no email, so this cannot be used to discover who has an account.
  const stranger = 'nobody-at-all@example.test';
  const theirs = await request(app).post('/api/auth/password/forgot').send({ email: stranger });
  assert.equal(theirs.status, 200);
  assert.deepEqual(theirs.body, { ok: true });
  assert.equal(mailTo(stranger).length, 0);
});

acct('a reset link sets the password, confirms the address, and signs out every device', async () => {
  const { agent, username, email, id } = await signUp('reset');

  // A second device, and an attacker's stolen session is no different from one.
  const other = request.agent(app);
  assert.equal((await other.post('/api/auth/login').send({ identifier: username, password })).status, 200);

  await request(app).post('/api/auth/password/forgot').send({ email });
  await waitForMail(email, 2);
  const token = linkFor(email, 'reset-password');
  const rows = await AuthToken.find({ purpose: 'reset-password' }).lean();
  for (const row of rows) assert.notEqual(row.tokenHash, token, 'the raw token must not be in the database');

  const fresh = 'A-reset-password-2026';
  const r = await request(app).post('/api/auth/password/reset').send({ token, newPassword: fresh });
  assert.equal(r.status, 200, JSON.stringify(r.body));

  assert.equal((await request(app).post('/api/auth/login').send({ identifier: username, password })).status, 401, 'the old password is dead');
  assert.equal((await request(app).post('/api/auth/login').send({ identifier: username, password: fresh })).status, 200);

  assert.equal((await other.get('/api/auth/me')).body.user, null, 'the other device is signed out');
  assert.equal((await agent.get('/api/auth/me')).body.user, null, 'and so is the one that asked');

  // Reading the link is proof they hold the mailbox, so there is nothing left to confirm.
  assert.ok((await User.findById(id)).emailVerifiedAt, 'the address is now confirmed');
  assert.equal(await AuthToken.countDocuments({ user: id }), 0, 'no link is left usable');
  assert.match(mailTo(email).at(-1).subject, /password was changed/i);
});

acct('a reset link is spent once, and an expired or invented one is refused', async () => {
  const { email, id } = await signUp('spent');
  await request(app).post('/api/auth/password/forgot').send({ email });
  await waitForMail(email, 2);
  const token = linkFor(email, 'reset-password');

  assert.equal((await request(app).post('/api/auth/password/reset').send({ token, newPassword: 'A-reset-password-2026' })).status, 200);
  const again = await request(app).post('/api/auth/password/reset').send({ token, newPassword: 'Another-reset-password-2026' });
  assert.equal(again.status, 400, 'the same link cannot be used twice');
  assert.match(again.body.error, /not valid/i);

  const invented = await request(app).post('/api/auth/password/reset').send({ token: 'b'.repeat(64), newPassword: 'A-reset-password-2026' });
  assert.equal(invented.status, 400);
  assert.equal((await request(app).post('/api/auth/password/reset').send({ token: 'nope', newPassword: 'A-reset-password-2026' })).status, 400, 'a garbled token stops at validation');

  await request(app).post('/api/auth/password/forgot').send({ email });
  await waitForMail(email, 4);
  const stale = linkFor(email, 'reset-password');
  await AuthToken.updateOne({ user: id, purpose: 'reset-password' }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
  assert.equal((await request(app).post('/api/auth/password/reset').send({ token: stale, newPassword: 'A-reset-password-2026' })).status, 400);
});

acct('deleting an account needs the password and the typed confirmation', async () => {
  const { agent } = await signUp('guard');
  assert.equal((await agent.delete('/api/auth/account').send({ password, confirm: 'nope' })).status, 400);
  assert.equal((await agent.delete('/api/auth/account').send({ password: 'wrong', confirm: 'delete my account' })).status, 400);
});

acct('deleting an account erases the content it owned and signs the session out', async () => {
  const { agent, id, email } = await signUp('erase');
  await User.updateOne({ _id: id }, { $set: { account: 'premium' } });

  const folder = (await agent.post('/api/folders').send({ title: 'Going away', visibility: 'private' })).body.folder;
  const card = (await agent.post(`/api/folders/${folder.id}/cards`).send({ front: { text: 'Q' }, back: { text: 'A' } })).body.card;
  await agent.post('/api/reviews').send({ cardId: card.id, rating: 'good', requestId: crypto.randomUUID() });
  await agent.post('/api/projects').send({ title: 'Also going', visibility: 'private' });

  const gone = await agent.delete('/api/auth/account').send({ password, confirm: 'delete my account' });
  assert.equal(gone.status, 200, JSON.stringify(gone.body));

  assert.equal(await User.findById(id), null);
  assert.equal(await Folder.countDocuments({ owner: id }), 0);
  assert.equal(await Card.countDocuments({ folder: folder.id }), 0);
  assert.equal(await Progress.countDocuments({ user: id }), 0);
  assert.equal(await Review.countDocuments({ user: id }), 0);
  assert.equal(await Project.countDocuments({ owner: id }), 0);
  assert.equal(await Session.countDocuments({ user: id }), 0);
  assert.equal(await AuthToken.countDocuments({ user: id }), 0);
  assert.equal(await Notification.countDocuments({ user: id }), 0);
  assert.equal(await Relationship.countDocuments({ $or: [{ from: id }, { to: id }] }), 0);

  assert.equal((await agent.get('/api/auth/me')).body.user, null, 'the cookie is cleared');
  assert.match(mailTo(email).at(-1).subject, /account has been deleted/i);
});

acct('a payment record survives deletion with the personal details stripped out', async () => {
  const { agent, id } = await signUp('paid');
  await PremiumOrder.create({
    user: id, plan: 'monthly', name: 'Real Name', email: 'real@example.test', phone: '9999999999',
    country: 'India', address: '1 Somewhere Street', amount: 19900, status: 'approved',
  });

  assert.equal((await agent.delete('/api/auth/account').send({ password, confirm: 'delete my account' })).status, 200);

  const order = await PremiumOrder.findOne({ user: id }).lean();
  assert.ok(order, 'the record of the payment is still there');
  assert.equal(order.amount, 19900, 'the amount is untouched');
  assert.equal(order.name, 'Deleted account');
  assert.equal(order.phone, '');
  assert.equal(order.address, '');
  assert.notEqual(order.email, 'real@example.test');
});

acct('deletion is refused while others are still in a classroom you own', async () => {
  const { agent: ownerAgent, id: ownerId } = await signUp('teacher');
  const { id: studentId } = await signUp('student');
  await User.updateOne({ _id: ownerId }, { $set: { account: 'premium' } });

  const team = await Team.create({ name: 'Physics 101', owner: ownerId, seats: 5, memberCount: 2 });
  await TeamMember.create({ team: team.id, user: ownerId, role: 'owner' });
  await TeamMember.create({ team: team.id, user: studentId, role: 'student' });

  const blocked = await ownerAgent.delete('/api/auth/account').send({ password, confirm: 'delete my account' });
  assert.equal(blocked.status, 409);
  assert.match(blocked.body.error, /Physics 101/);
  assert.ok(await User.findById(ownerId), 'still there');

  // Once the classroom is empty the account can go, and the classroom goes with it.
  await TeamMember.deleteOne({ team: team.id, user: studentId });
  assert.equal((await ownerAgent.delete('/api/auth/account').send({ password, confirm: 'delete my account' })).status, 200);
  assert.equal(await Team.findById(team.id), null);
});

acct('signing in never grants staff access, whatever the username is', async () => {
  // This account name used to be promoted to superadmin on login, which made staff access
  // self-service on any deploy where the seed had not already claimed the name.
  const username = 'demolearner';
  await User.create({ username, name: 'Demo', email: 'demo@example.test', passwordHash: await bcrypt.hash(password, 12) });

  const agent = request.agent(app);
  assert.equal((await agent.post('/api/auth/login').send({ identifier: username, password })).status, 200);
  assert.equal((await User.findOne({ username })).account, 'normal', 'still an ordinary account');
  assert.equal((await agent.get('/api/admin/users')).status, 403, 'and the dashboard stays shut');
});

acct('the usernames that would pass for staff cannot be registered', async () => {
  for (const username of ['admin', 'superadmin', 'support', 'security', 'billing', 'demolearner', BRAND.slug]) {
    const r = await request(app).post('/api/auth/signup')
      .send({ username, name: 'Chancer', email: `${username}-taken@example.test`, password, country: 'India', acceptedTerms: true });
    assert.equal(r.status, 400, `${username} should be reserved`);
    assert.match(r.body.error, /reserved/i);
  }
  // An ordinary name that merely contains one of them is still fine.
  const ok = await request(app).post('/api/auth/signup').send({ username: 'admirer', name: 'Fine', email: 'admirer@example.test', password, country: 'India', acceptedTerms: true });
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
});

acct('money cannot change hands until the address is confirmed', async () => {
  const { agent, id, email } = await signUp('buyer');
  const billing = { plan: 'monthly', name: 'A Buyer', phone: '+919999999999', country: 'India', address: '1 Somewhere Street' };

  const blocked = await agent.post('/api/premium/checkout').send(billing);
  assert.equal(blocked.status, 403);
  assert.equal(blocked.body.code, 'EMAIL_UNVERIFIED');

  // Anyone can sign up with somebody else's address, so a receipt or refund has to be able to
  // reach the person who actually paid.
  const token = linkFor(email);
  assert.equal((await request(app).post('/api/auth/verify-email').send({ token })).status, 200);
  assert.ok((await User.findById(id)).emailVerifiedAt);

  const allowed = await agent.post('/api/premium/checkout').send(billing);
  assert.notEqual(allowed.status, 403, JSON.stringify(allowed.body));
});

acct('the rate limit is still on when the suite is not the one asking', async () => {
  delete process.env.DISABLE_RATE_LIMIT;
  try {
    let limited = false;
    for (let i = 0; i < 40 && !limited; i++) {
      const r = await request(app).post('/api/auth/login').send({ identifier: 'nobody', password: 'wrong-password-here' });
      limited = r.status === 429;
    }
    assert.ok(limited, 'guessing at passwords gets cut off');
  } finally {
    process.env.DISABLE_RATE_LIMIT = '1';
  }
});

acct('someone else cannot change your password or delete your account', async () => {
  const { id } = await signUp('victim');
  const stranger = request.agent(app);
  assert.equal((await stranger.post('/api/auth/password').send({ currentPassword: password, newPassword: 'Another-password-2026' })).status, 401);
  assert.equal((await stranger.delete('/api/auth/account').send({ password, confirm: 'delete my account' })).status, 401);
  assert.ok(await User.findById(id));
});

acct('an account cannot be created without agreeing to the terms', async () => {
  // The tick is the whole record that somebody accepted them, so it has to be refused rather than
  // assumed. Sent explicitly false as well as omitted, because a client that posts the field with
  // the wrong value is the more likely mistake.
  const base = { name: 'No Consent', email: 'noconsent@example.test', password, country: 'India' };
  for (const [label, payload] of [
    ['omitted', { ...base, username: 'noconsent1' }],
    ['false', { ...base, username: 'noconsent2', acceptedTerms: false }],
  ]) {
    const r = await request(app).post('/api/auth/signup').send(payload);
    assert.equal(r.status, 400, `${label}: ${JSON.stringify(r.body)}`);
    assert.match(r.body.error, /terms/i, `${label} is refused for the right reason`);
  }
  assert.equal(await User.countDocuments({ email: 'noconsent@example.test' }), 0, 'and no account was left behind');

  const ok = await request(app).post('/api/auth/signup').send({ ...base, username: 'didconsent', acceptedTerms: true });
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  // Stored as a moment and a version rather than a boolean: what you would need later is when they
  // agreed and to which wording, not merely that they did.
  const saved = await User.findOne({ username: 'didconsent' }).lean();
  assert.ok(saved.termsAcceptedAt instanceof Date, 'the time of acceptance is recorded');
  assert.equal(saved.termsVersion, BRAND.policyUpdated, 'along with the version accepted');
  assert.equal(saved.acceptedTerms, undefined, 'and the raw flag is never written to the document');
});
