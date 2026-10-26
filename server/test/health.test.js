import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import mongoose from 'mongoose';
import { createApp } from '../src/app.js';
import { checkDatabase } from '../src/services/healthService.js';
import { run, checkOnce } from '../../scripts/healthcheck.js';
import { BRAND } from '../../shared/brand.js';
const abortingFetch = () => (_url, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
const collect = () => { const lines = []; return { lines, logger: (level, message) => lines.push(`${level} ${message}`) }; };
test('GET /api/health is public, returns 200 without a database, and does not leak configuration', async () => {
  assert.notEqual(mongoose.connection.readyState, 1, 'this test expects no database connection');
  process.env.MONGODB_URI ||= 'mongodb://secret-user:secret-pass@db.internal/app';
  const started = Date.now();
  const res = await request(createApp()).get('/api/health').set('Cookie', `${BRAND.cookies.access}=stale-token`);
  assert.equal(res.status, 200); assert.deepEqual(res.body, { ok: true, app: BRAND.slug, storage: 'mongodb' });
  assert.ok(Date.now() - started < 2000, 'liveness must not wait on Mongoose buffering');
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.equal(JSON.stringify(res.body).includes('secret-'), false);
});
test('GET /api/ready returns 503 with a safe body when the database is unavailable', async () => {
  assert.notEqual(mongoose.connection.readyState, 1);
  const res = await request(createApp()).get('/api/ready').set('Cookie', `${BRAND.cookies.access}=stale-token`);
  assert.equal(res.status, 503);
  assert.deepEqual(res.body, { ok: false, status: 'unavailable', checks: { database: 'down' } });
});
test('checkDatabase reports up on a fast ping, down on a failed ping, and down on a ping that exceeds the timeout', async () => {
  const connection = (command) => ({ readyState: 1, db: { admin: () => ({ command }) } });
  assert.equal(await checkDatabase({ connection: connection(async () => ({ ok: 1 })), timeoutMs: 100 }), true);
  assert.equal(await checkDatabase({ connection: connection(async () => { throw new Error('MongoNetworkError: host secret-host'); }), timeoutMs: 100 }), false);
  assert.equal(await checkDatabase({ connection: connection(() => new Promise(() => {})), timeoutMs: 20 }), false);
  assert.equal(await checkDatabase({ connection: { readyState: 0 }, timeoutMs: 100 }), false);
});
test('healthcheck script exits 0 on HTTP 200 and 1 after one retry on non-200 responses', async () => {
  const ok = collect();
  assert.equal(await run({ url: 'https://health.example/api/health', fetchImpl: async () => new Response('{}', { status: 200 }), logger: ok.logger }), 0);
  assert.equal(ok.lines.length, 1); assert.match(ok.lines[0], /^info healthy: HTTP 200/);
  let calls = 0; const bad = collect();
  assert.equal(await run({ url: 'https://health.example/api/health', fetchImpl: async () => { calls++; return new Response('down', { status: 503 }); }, logger: bad.logger }), 1);
  assert.equal(calls, 2, 'exactly one retry');
  assert.deepEqual(bad.lines.map(l => l.split(' ')[0]), ['warn', 'warn', 'error']); assert.match(bad.lines[0], /HTTP 503/);
  const redirect = collect();
  assert.equal(await run({ url: 'https://health.example/api/health', fetchImpl: async () => new Response('', { status: 302, headers: { location: '/login' } }), logger: redirect.logger }), 1, 'redirects are not treated as healthy');
});
test('healthcheck script aborts slow requests at the timeout, retries once, and exits nonzero', async () => {
  const single = await checkOnce('https://health.example/api/health', { fetchImpl: abortingFetch(), timeoutMs: 30 });
  assert.equal(single.ok, false); assert.match(single.reason, /timed out after 30ms/);
  let calls = 0; const out = collect();
  const code = await run({ url: 'https://health.example/api/health', fetchImpl: (...args) => { calls++; return abortingFetch()(...args); }, timeoutMs: 30, logger: out.logger });
  assert.equal(code, 1); assert.equal(calls, 2); assert.match(out.lines[0], /timed out/);
  const net = collect();
  assert.equal(await run({ url: 'https://health.example/api/health', fetchImpl: async () => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } }); }, logger: net.logger }), 1);
  assert.match(net.lines[0], /ECONNREFUSED/);
});
test('healthcheck script exits 2 when HEALTHCHECK_URL is missing or not http(s)', async () => {
  const out = collect();
  assert.equal(await run({ url: undefined, logger: out.logger }), 2);
  assert.equal(await run({ url: 'ftp://health.example/health', logger: out.logger }), 2);
  assert.match(out.lines[0], /HEALTHCHECK_URL/);
});
