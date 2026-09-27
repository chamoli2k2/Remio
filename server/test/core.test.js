import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { schedule } from '../src/services/studyService.js';
import { roleOf } from '../src/services/accessService.js';
import { cardSchema, usernameSchema } from '../src/middleware/validate.js';
import { createApp } from '../src/app.js';
import { publicOrigin, trustedOrigins } from '../src/utils/origin.js';
import { BRAND } from '../../shared/brand.js';
test('a trailing slash on the configured origin never reaches an allow-list or a link', () => {
  const before = process.env.CLIENT_ORIGIN;
  const withOrigin = (v, fn) => { if (v === undefined) delete process.env.CLIENT_ORIGIN; else process.env.CLIENT_ORIGIN = v; try { fn(); } finally { if (before === undefined) delete process.env.CLIENT_ORIGIN; else process.env.CLIENT_ORIGIN = before; } };
  withOrigin('https://remio.example.com/', () => {
    // Browsers never send the slash on Origin, so leaving it here would match nothing at all, and
    // it would also double against the path of every link we email or hand to a gateway.
    assert.deepEqual(trustedOrigins(), ['https://remio.example.com']);
    assert.equal(`${publicOrigin()}/verify-email`, 'https://remio.example.com/verify-email');
  });
  withOrigin(' https://a.example.com//, https://b.example.com ,, ', () => {
    assert.deepEqual(trustedOrigins(), ['https://a.example.com', 'https://b.example.com'], 'spaces and empty entries are dropped');
    assert.equal(publicOrigin(), 'https://a.example.com', 'the first one is the canonical one');
  });
  // An absolute URL outlives the request that made it, so pointing it at a developer's laptop is
  // worse than pointing it at a host that is merely not deployed yet.
  withOrigin(undefined, () => {
    assert.equal(publicOrigin(), `https://${BRAND.domain}`);
    assert.deepEqual(trustedOrigins(), ['http://localhost:4173'], 'but local development still works out of the box');
  });
});
test('a forgotten card returns after ten minutes; intervals never drop below one day and grow with repeated success', () => {
  const now = new Date('2026-01-01T00:00:00Z');
  const again = schedule({ interval: 30, repetitions: 5, ease: 1.3, lastReviewedAt: new Date('2025-12-02T00:00:00Z') }, 'again', now);
  assert.equal(again.dueAt.toISOString(), '2026-01-01T00:10:00.000Z'); assert.equal(again.repetitions, 0); assert.equal(again.interval, 0);
  assert.ok(schedule({ interval: 0, repetitions: 0 }, 'hard', now).interval >= 1);
  const first = schedule({ interval: 0, repetitions: 0 }, 'good', now); assert.ok(first.interval >= 1);
  const second = schedule(first, 'good', new Date(now.getTime() + first.interval * 86400000)); assert.ok(second.interval > first.interval);
});
test('private/public visibility and explicit roles do not grant editor access to strangers', () => {
  const folder = { owner: 'owner', visibility: 'private', members: [{ user: 'editor', role: 'editor' }, { user: 'reader', role: 'viewer' }] };
  assert.equal(roleOf(folder, 'owner'), 'owner'); assert.equal(roleOf(folder, 'editor'), 'editor'); assert.equal(roleOf(folder, 'reader'), 'viewer'); assert.equal(roleOf(folder, 'stranger'), null); assert.equal(roleOf(folder, null), null);
  assert.equal(roleOf({ ...folder, visibility: 'global' }, 'stranger'), 'viewer');
});
test('card validation rejects empty sides and unsafe sources; usernames normalize', () => {
  assert.equal(usernameSchema.parse(' Learner_1 '), 'learner_1');
  assert.throws(() => cardSchema.parse({ front: { text: '' }, back: { text: 'answer' } }));
  assert.throws(() => cardSchema.parse({ front: { text: 'question' }, back: { text: 'answer' }, source: 'javascript:alert(1)' }));
  const card = cardSchema.parse({ front: { text: 'Q' }, back: { text: 'A' }, tags: [' React ', 'react'] }); assert.deepEqual(card.tags, ['react']);
  // A cloze deletion on the front is its own answer, so the back may be empty; a plain front still needs one.
  assert.throws(() => cardSchema.parse({ front: { text: 'Paris is the capital of France' }, back: { text: '' } }));
  assert.equal(cardSchema.parse({ front: { text: '{{c1::Paris}} is the capital of {{c2::France::country}}' }, back: { text: '' } }).back.text, '');
});
test('API health, anonymous writes, untrusted origins and input validation', async () => {
  const app = createApp();
  assert.equal((await request(app).get('/api/health')).body.storage, 'mongodb');
  assert.equal((await request(app).post('/api/folders').send({ title: 'No auth' })).status, 401);
  assert.equal((await request(app).post('/api/auth/signup').set('Origin', 'https://untrusted.example').send({})).status, 403);
  assert.equal((await request(app).post('/api/auth/signup').send({ username: 'x' })).status, 400);
  assert.equal((await request(app).get('/api/unknown')).status, 404);
});
test('CSRF guard: same-origin writes pass without CLIENT_ORIGIN, allow-listed origins pass, foreign origins are rejected', async () => {
  const app = createApp(); const post = () => request(app).post('/api/auth/signup').send({});
  // Same host as the request itself → allowed regardless of CLIENT_ORIGIN; reaches validation (400), not 403.
  assert.equal((await post().set('Host', 'demo.onrender.com').set('Origin', 'https://demo.onrender.com')).status, 400);
  assert.equal((await post().set('Host', 'demo.onrender.com').set('Origin', 'https://evil.example')).status, 403);
  assert.equal((await post().set('Host', 'demo.onrender.com').set('Origin', 'https://demo.onrender.com.evil.example')).status, 403);
  assert.equal((await post().set('Host', 'demo.onrender.com').set('Origin', 'https://demo.onrender.com').set('Sec-Fetch-Site', 'cross-site')).status, 403);
  assert.equal((await post().set('Origin', 'http://localhost:4173')).status, 400, 'default CLIENT_ORIGIN still allow-listed');
  assert.equal((await post().set('Origin', 'not a url')).status, 403);
});
