import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import { configureProxy, proxyMode, isCloudflare } from '../src/utils/proxy.js';

const appWith = value => { const app = express(); configureProxy(app, value); app.get('/ip', (req, res) => res.json({ ip: req.ip })); return app; };
const ipOf = async (app, headers = {}) => (await request(app).get('/ip').set(headers)).body.ip;

test('TRUST_PROXY accepts the documented values and refuses anything else', () => {
  assert.deepEqual(proxyMode(undefined), { hops: 0, cloudflare: false });
  assert.deepEqual(proxyMode('0'), { hops: 0, cloudflare: false });
  assert.deepEqual(proxyMode('1'), { hops: 1, cloudflare: false });
  assert.deepEqual(proxyMode(' Cloudflare '), { hops: 1, cloudflare: true });
  for (const bad of ['true', 'yes', '7', '-1', 'cf']) assert.throws(() => proxyMode(bad), /TRUST_PROXY/);
});

test('Cloudflare ranges are recognised, including IPv4 seen through a dual-stack socket', () => {
  assert.equal(isCloudflare('162.158.10.20'), true);
  assert.equal(isCloudflare('::ffff:104.21.38.104'), true);
  assert.equal(isCloudflare('2606:4700:3033::6815:2668'), true);
  assert.equal(isCloudflare('198.51.100.7'), false);
  assert.equal(isCloudflare('not-an-ip'), false);
  assert.equal(isCloudflare(''), false);
});

test('one proxy: the address it appended is the visitor, and CF-Connecting-IP is ignored', async () => {
  const app = appWith('1');
  assert.equal(await ipOf(app, { 'X-Forwarded-For': '198.51.100.7' }), '198.51.100.7');
  assert.equal(await ipOf(app, { 'X-Forwarded-For': '162.158.1.1', 'CF-Connecting-IP': '203.0.113.5' }), '162.158.1.1');
});

test('cloudflare: the visitor comes from CF-Connecting-IP when the hop before the host is Cloudflare', async () => {
  const app = appWith('cloudflare');
  assert.equal(await ipOf(app, { 'X-Forwarded-For': '162.158.1.1', 'CF-Connecting-IP': '203.0.113.5' }), '203.0.113.5');
  assert.equal(await ipOf(app, { 'X-Forwarded-For': '2400:cb00::1', 'CF-Connecting-IP': '2001:db8::5' }), '2001:db8::5');
});

test('cloudflare: a forged header from outside Cloudflare does not change who the visitor is', async () => {
  const app = appWith('cloudflare');
  // Someone calling the host directly, hoping to dodge a rate limit by claiming another address.
  assert.equal(await ipOf(app, { 'X-Forwarded-For': '198.51.100.7', 'CF-Connecting-IP': '203.0.113.5' }), '198.51.100.7');
  // An earlier, client-written X-Forwarded-For entry is not trusted either: only the last hop counts.
  assert.equal(await ipOf(app, { 'X-Forwarded-For': '162.158.1.1, 198.51.100.7', 'CF-Connecting-IP': '203.0.113.5' }), '198.51.100.7');
});

test('cloudflare: a missing or malformed header falls back to the forwarded address', async () => {
  const app = appWith('cloudflare');
  assert.equal(await ipOf(app, { 'X-Forwarded-For': '162.158.1.1' }), '162.158.1.1');
  assert.equal(await ipOf(app, { 'X-Forwarded-For': '162.158.1.1', 'CF-Connecting-IP': 'evil, 1.2.3.4' }), '162.158.1.1');
});

test('the override stays on its own app and never leaks into another', async () => {
  appWith('cloudflare');
  assert.equal(await ipOf(appWith('1'), { 'X-Forwarded-For': '162.158.1.1', 'CF-Connecting-IP': '203.0.113.5' }), '162.158.1.1');
});
