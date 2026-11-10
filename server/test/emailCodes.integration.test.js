import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import request from 'supertest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { createApp } from '../src/app.js';
import { allModels, User, EmailCode, Folder } from '../src/models/index.js';
import { _setTransport } from '../src/services/mailService.js';
import { BRAND } from '../../shared/brand.js';

const enabled = process.env.RUN_INTEGRATION === '1';
let mongo, app;
const password = 'Email-code-tests-2026';
const sent = [];
const codeFor = to => (sent.filter(m => m.to === to).at(-1)?.text.match(/\b(\d{6})\b/) || [])[1];
// A second request inside the minute is refused on purpose; tests that ask twice move the clock instead.
const ageCode = (email, purpose) => EmailCode.updateOne({ email, purpose }, { $set: { sentAt: new Date(Date.now() - 120_000) } });

before(async () => {
  if (!enabled) return;
  process.env.SMTP_HOST = 'test.invalid';
  process.env.DISABLE_RATE_LIMIT = '1';
  process.env.EMAIL_CODES = 'on';
  _setTransport({ sendMail: async mail => { sent.push(mail); return { messageId: 'test' }; } });
  if (!process.env.TEST_MONGODB_URI) mongo = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  await mongoose.connect(process.env.TEST_MONGODB_URI || mongo.getUri(), { dbName: `${BRAND.slug}_codes_${crypto.randomBytes(6).toString('hex')}` });
  await Promise.all(allModels.map(m => m.init()));
  app = createApp();
});
after(async () => {
  if (mongoose.connection.readyState) { await mongoose.connection.dropDatabase(); await mongoose.disconnect(); }
  if (mongo) await mongo.stop();
  for (const k of ['SMTP_HOST', 'DISABLE_RATE_LIMIT', 'EMAIL_CODES']) delete process.env[k];
});
beforeEach(() => { sent.length = 0; });
const integration = (name, fn) => test(name, { skip: !enabled }, fn);
const form = (email, extra = {}) => ({ username: email.split('@')[0].replace(/[^a-z0-9_]/g, '_'), name: 'Code Tester', email, password, country: 'India', acceptedTerms: true, ...extra });

integration('an account is only created once the emailed code comes back, and it starts verified', async () => {
  const email = 'newcomer@example.test';
  const noCode = await request(app).post('/api/auth/signup').send(form(email));
  assert.equal(noCode.status, 400, 'no code, no account');
  assert.equal(await User.countDocuments({ email }), 0);

  assert.equal((await request(app).post('/api/auth/signup/code').send({ email })).status, 200);
  const code = codeFor(email);
  assert.match(code, /^\d{6}$/);

  const wrong = await request(app).post('/api/auth/signup').send(form(email, { emailCode: code === '000000' ? '111111' : '000000' }));
  assert.equal(wrong.status, 400);
  assert.equal(await User.countDocuments({ email }), 0);

  const made = await request(app).post('/api/auth/signup').send(form(email, { emailCode: code }));
  assert.equal(made.status, 201, JSON.stringify(made.body));
  const row = await User.findOne({ email }).select('+email');
  assert.ok(row.emailVerifiedAt, 'the address is verified from the start');

  const again = await request(app).post('/api/auth/signup').send(form('other@example.test', { emailCode: code }));
  assert.equal(again.status, 400, 'a code belongs to the address it was sent to');
  assert.equal((await request(app).post('/api/auth/signup/code').send({ email })).status, 409, 'an address with an account is not asked for a code');
});

integration('a code is single use, expires, and locks after five wrong guesses', async () => {
  const email = 'guesser@example.test';
  await request(app).post('/api/auth/signup/code').send({ email });
  const code = codeFor(email);
  const bad = code === '123456' ? '654321' : '123456';
  for (let i = 0; i < 5; i += 1) assert.equal((await request(app).post('/api/auth/signup').send(form(email, { emailCode: bad }))).status, 400);
  const locked = await request(app).post('/api/auth/signup').send(form(email, { emailCode: code }));
  assert.equal(locked.status, 429, 'even the right code is refused once it is burnt');
  assert.equal(locked.body.code, 'CODE_LOCKED');

  assert.equal((await request(app).post('/api/auth/signup/code').send({ email })).status, 429, 'asking again inside a minute is refused');
  await ageCode(email, 'signup');
  assert.equal((await request(app).post('/api/auth/signup/code').send({ email })).status, 200);
  const fresh = codeFor(email);
  assert.equal((await request(app).post('/api/auth/signup').send(form(email, { emailCode: fresh }))).status, 201);

  await request(app).post('/api/auth/signup/code').send({ email: 'late@example.test' });
  await EmailCode.updateOne({ email: 'late@example.test' }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
  const late = await request(app).post('/api/auth/signup').send(form('late@example.test', { emailCode: codeFor('late@example.test') }));
  assert.equal(late.status, 400);
  assert.equal(late.body.code, 'CODE_EXPIRED');
});

integration('the public delete page needs the emailed code, says nothing about who has an account, and erases everything', async () => {
  const email = 'leaver@example.test';
  await request(app).post('/api/auth/signup/code').send({ email });
  const agent = request.agent(app);
  assert.equal((await agent.post('/api/auth/signup').send(form(email, { emailCode: codeFor(email) }))).status, 201);
  const user = await User.findOne({ email });
  await agent.post('/api/folders').send({ title: 'Mine', description: '', visibility: 'private' });
  assert.equal(await Folder.countDocuments({ owner: user.id }), 1);

  const stranger = await request(app).post('/api/auth/delete-account/code').send({ email: 'nobody@example.test' });
  const real = await request(app).post('/api/auth/delete-account/code').send({ email });
  assert.deepEqual(stranger.body, real.body, 'the answer is the same either way');
  assert.equal(sent.filter(m => m.to === 'nobody@example.test').length, 0, 'and nothing is mailed to a stranger');

  const code = codeFor(email);
  const noPhrase = await request(app).post('/api/auth/delete-account').send({ email, code, confirm: 'nope' });
  assert.equal(noPhrase.status, 400);
  const wrong = await request(app).post('/api/auth/delete-account').send({ email, code: code === '000000' ? '111111' : '000000', confirm: 'delete my account' });
  assert.equal(wrong.status, 400);
  assert.equal(await User.countDocuments({ email }), 1, 'a wrong code deletes nothing');

  const gone = await request(app).post('/api/auth/delete-account').send({ email, code, confirm: 'delete my account' });
  assert.equal(gone.status, 200, JSON.stringify(gone.body));
  assert.equal(await User.countDocuments({ email }), 0);
  assert.equal(await Folder.countDocuments({ owner: user.id }), 0);
  assert.equal((await request(app).post('/api/auth/delete-account').send({ email, code, confirm: 'delete my account' })).status, 400, 'the code is spent');
});

integration('signed-in deletion also asks for the emailed code, on top of the password', async () => {
  const email = 'signedin@example.test';
  await request(app).post('/api/auth/signup/code').send({ email });
  const agent = request.agent(app);
  await agent.post('/api/auth/signup').send(form(email, { emailCode: codeFor(email) }));

  const without = await agent.delete('/api/auth/account').send({ password, confirm: 'delete my account' });
  assert.equal(without.status, 400, 'the password alone is not enough');
  assert.equal((await agent.post('/api/auth/account/code').send({})).status, 200);
  const code = codeFor(email);
  assert.equal((await agent.delete('/api/auth/account').send({ password: 'wrong-password-123', emailCode: code, confirm: 'delete my account' })).status, 400);
  assert.equal((await agent.delete('/api/auth/account').send({ password, emailCode: code, confirm: 'delete my account' })).status, 200);
  assert.equal(await User.countDocuments({ email }), 0);
});
