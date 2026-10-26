import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import request from 'supertest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { createApp } from '../src/app.js';
import { allModels, User, RefreshToken } from '../src/models/index.js';
import { BRAND } from '../../shared/brand.js';

const enabled = process.env.RUN_INTEGRATION === '1';
const it = (name, fn) => test(name, { skip: !enabled }, fn);
let mongo, app;
const password = 'Jwt-tests-password-2026';

before(async () => {
  if (!enabled) return;
  process.env.DISABLE_RATE_LIMIT = '1';
  if (!process.env.TEST_MONGODB_URI) mongo = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  await mongoose.connect(process.env.TEST_MONGODB_URI || mongo.getUri(), { dbName: `${BRAND.slug}_jwt_${crypto.randomBytes(6).toString('hex')}` });
  await Promise.all(allModels.map(m => m.init()));
  app = createApp();
});
after(async () => {
  if (mongoose.connection.readyState) { await mongoose.connection.dropDatabase(); await mongoose.disconnect(); }
  if (mongo) await mongo.stop();
  delete process.env.DISABLE_RATE_LIMIT;
});

const cookiesOf = res => Object.fromEntries((res.headers['set-cookie'] || []).map(c => { const [pair, ...attrs] = c.split(';'); const [k, ...v] = pair.split('='); return [k.trim(), { value: v.join('='), attrs: attrs.map(a => a.trim().toLowerCase()) }]; }));
const decode = part => JSON.parse(Buffer.from(part, 'base64url').toString());
const bearer = token => ({ Authorization: `Bearer ${token}` });
const native = { 'X-Auth-Mode': 'token' };

async function account(prefix, extra = {}) {
  const username = `${prefix}${crypto.randomBytes(3).toString('hex')}`;
  const r = await request(app).post('/api/auth/signup').set(extra).send({ username, name: prefix, email: `${username}@example.test`, password, country: 'India', acceptedTerms: true });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return { username, id: r.body.user.id, res: r };
}

it('a browser sign-in sets an HttpOnly JWT cookie and a refresh cookie scoped to /api/auth', async () => {
  const { res, id } = await account('web');
  const jar = cookiesOf(res);
  const access = jar[BRAND.cookies.access], refresh = jar[BRAND.cookies.refresh];
  assert.ok(access && refresh, 'both cookies are set');
  assert.ok(access.attrs.includes('httponly') && refresh.attrs.includes('httponly'));
  assert.ok(refresh.attrs.includes('path=/api/auth'), 'the refresh token only travels to the auth routes');
  assert.equal(res.body.tokens, undefined, 'a browser never sees the tokens themselves');
  assert.ok(res.body.auth.accessExpiresAt);

  const [header, payload] = access.value.split('.');
  assert.deepEqual(decode(header), { alg: 'HS256', typ: 'JWT' });
  const claims = decode(payload);
  assert.equal(claims.sub, id);
  assert.equal(claims.acct, (await User.findById(id)).account);
  assert.equal(claims.exp - claims.iat, 15 * 60);
  assert.equal(await RefreshToken.countDocuments({ user: id, tokenHash: refresh.value }), 0, 'only the hash is stored');
});

it('a native app gets tokens in the body, and the bearer token works on the API', async () => {
  const { res, username } = await account('app', native);
  assert.equal(res.headers['set-cookie'], undefined, 'no cookies for a native client');
  const { accessToken, refreshToken, tokenType } = res.body.tokens;
  assert.equal(tokenType, 'Bearer');
  assert.match(refreshToken, /^[a-f\d]{64}$/);
  const me = await request(app).get('/api/auth/me').set(bearer(accessToken));
  assert.equal(me.body.user?.username, username);
});

it('refresh tokens rotate, a racing duplicate is forgiven, and a replay signs the device out', async () => {
  const { res, id } = await account('rot', native);
  const first = res.body.tokens.refreshToken;

  const r1 = await request(app).post('/api/auth/refresh').set(native).send({ refreshToken: first });
  assert.equal(r1.status, 200, JSON.stringify(r1.body));
  const second = r1.body.tokens.refreshToken;
  assert.ok(second && second !== first, 'a new refresh token every time');

  const race = await request(app).post('/api/auth/refresh').set(native).send({ refreshToken: first });
  assert.equal(race.status, 200, 'the same token a moment later is two tabs, not a thief');
  assert.ok(race.body.tokens.accessToken);
  assert.equal(race.body.tokens.refreshToken, undefined, 'but it does not mint a second refresh token');

  await RefreshToken.updateOne({ user: id }, { $set: { rotatedAt: new Date(Date.now() - 60_000) } });
  const replay = await request(app).post('/api/auth/refresh').set(native).send({ refreshToken: first });
  assert.equal(replay.status, 401);
  assert.equal(replay.body.code, 'REFRESH_INVALID');
  assert.equal(await RefreshToken.countDocuments({ user: id }), 0, 'the device is signed out');
  assert.equal((await request(app).post('/api/auth/refresh').set(native).send({ refreshToken: second })).status, 401, 'including whoever held the newest token');
});

it('a tampered, unsigned, or expired access token is refused with TOKEN_EXPIRED', async () => {
  const { res } = await account('bad', native);
  const [h, p, s] = res.body.tokens.accessToken.split('.');
  const forged = Buffer.from(JSON.stringify({ ...decode(p), acct: 'superadmin' })).toString('base64url');
  const none = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const expired = Buffer.from(JSON.stringify({ ...decode(p), exp: Math.floor(Date.now() / 1000) - 5 })).toString('base64url');
  for (const token of [`${h}.${forged}.${s}`, `${none}.${p}.`, `${h}.${expired}.${s}`, 'not-a-jwt']) {
    const r = await request(app).get('/api/auth/me').set(bearer(token));
    assert.equal(r.status, 401, token);
    assert.equal(r.body.code, 'TOKEN_EXPIRED');
  }
  const refresh = await request(app).post('/api/auth/refresh').set(native).set(bearer('not-a-jwt')).send({ refreshToken: res.body.tokens.refreshToken });
  assert.equal(refresh.status, 200, 'a dead access token never blocks renewing it');
});

it('authorization comes from the claims, and a role change makes the old token renew itself', async () => {
  const { res, id } = await account('role', native);
  const { accessToken, refreshToken } = res.body.tokens;
  const forbidden = await request(app).get('/api/admin/reports').set(bearer(accessToken));
  assert.equal(forbidden.status, 403);

  await User.updateOne({ _id: id }, { $set: { account: 'admin' } });
  const stale = await request(app).get('/api/admin/reports').set(bearer(accessToken));
  assert.equal(stale.status, 401, 'claims that disagree with the database are not trusted either way');
  assert.equal(stale.body.code, 'TOKEN_EXPIRED');

  const renewed = await request(app).post('/api/auth/refresh').set(native).send({ refreshToken });
  assert.equal(decode(renewed.body.tokens.accessToken.split('.')[1]).acct, 'admin');
  assert.equal((await request(app).get('/api/admin/reports').set(bearer(renewed.body.tokens.accessToken))).status, 200);
});

it('signing out revokes the refresh token, and a revoked user is a stranger at once', async () => {
  const { res, id } = await account('out', native);
  const { accessToken, refreshToken } = res.body.tokens;
  assert.equal((await request(app).post('/api/auth/logout').set(native).send({ refreshToken })).status, 200);
  assert.equal((await request(app).post('/api/auth/refresh').set(native).send({ refreshToken })).status, 401);

  await User.updateOne({ _id: id }, { $inc: { tokenVersion: 1 } });
  const me = await request(app).get('/api/auth/me').set(bearer(accessToken));
  assert.equal(me.status, 200);
  assert.equal(me.body.user, null, 'a token from before the version bump signs nobody in');
});

it('a browser renews from its cookie, and a failed renewal clears both cookies', async () => {
  const agent = request.agent(app);
  const username = `cookie${crypto.randomBytes(3).toString('hex')}`;
  await agent.post('/api/auth/signup').send({ username, name: 'c', email: `${username}@example.test`, password, country: 'India', acceptedTerms: true });
  const ok = await agent.post('/api/auth/refresh');
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.ok(cookiesOf(ok)[BRAND.cookies.refresh], 'the rotated refresh token is set again');
  assert.equal((await agent.get('/api/auth/me')).body.user?.username, username);

  await User.updateOne({ username }, { $set: { account: 'admin' } });
  const promoted = await agent.get('/api/admin/reports');
  assert.equal(promoted.status, 200, 'a browser is never bounced for claims that changed under it');
  const resigned = cookiesOf(promoted)[BRAND.cookies.access];
  assert.equal(decode(resigned.value.split('.')[1]).acct, 'admin', 'its cookie is re-signed with the new role');

  const dead = await request(app).post('/api/auth/refresh').set('Cookie', `${BRAND.cookies.refresh}=${'0'.repeat(64)}`);
  assert.equal(dead.status, 401);
  const cleared = cookiesOf(dead);
  assert.equal(cleared[BRAND.cookies.access]?.value, '');
  assert.equal(cleared[BRAND.cookies.refresh]?.value, '');
});
