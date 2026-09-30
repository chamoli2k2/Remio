import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import request from 'supertest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { createApp } from '../src/app.js';
import sharp from 'sharp';
import { allModels, User, Card, Folder, Media, Setting, AgentToken, AgentBatch } from '../src/models/index.js';
import { reload } from '../src/services/settingsService.js';
import * as mediaService from '../src/services/mediaService.js';
import * as tools from '../src/services/agent/tools.js';
import { cardSchema } from '../src/middleware/validate.js';
import { BRAND } from '../../shared/brand.js';
import { AGENT_LIMITS, SCOPE_IDS } from '../../shared/agent.js';

/**
 * The assistant integration, end to end: registration, approval, tokens, tool calls, and the
 * limits that hold when a model does something unreasonable.
 *
 * Driven through HTTP rather than by calling the services, because most of what is being checked
 * here lives in the wiring — which middleware runs, which header comes back, what a client sees
 * when it is refused. A test that called `addCards` directly would pass while the endpoint was
 * unauthenticated.
 */

const enabled = process.env.RUN_INTEGRATION === '1';
const password = 'Integration-only-password-2026';
let mongo, app, owner, stranger, ownerId, strangerId;

const REDIRECT = 'https://claude.ai/api/mcp/auth_callback';

before(async () => {
  if (!enabled) return;
  process.env.DISABLE_RATE_LIMIT = '1';
  const dbName = `${BRAND.slug}_agent_${crypto.randomBytes(6).toString('hex')}`;
  if (!process.env.TEST_MONGODB_URI) mongo = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  await mongoose.connect(process.env.TEST_MONGODB_URI || mongo.getUri(), { dbName });
  await Promise.all(allModels.map(m => m.init()));
  app = createApp();
  [owner, stranger] = [request.agent(app), request.agent(app)];
  for (const [agent, username] of [[owner, 'deckowner'], [stranger, 'nosyperson']]) {
    const r = await agent.post('/api/auth/signup').send({ username, name: username, email: `${username}@example.test`, password, country: 'India', acceptedTerms: true });
    assert.equal(r.status, 201, JSON.stringify(r.body));
  }
  await User.updateMany({}, { $set: { account: 'premium', emailVerifiedAt: new Date() } });
  ownerId = (await User.findOne({ username: 'deckowner' })).id;
  strangerId = (await User.findOne({ username: 'nosyperson' })).id;
});

after(async () => {
  if (mongoose.connection.readyState) { await mongoose.connection.dropDatabase(); await mongoose.disconnect(); }
  if (mongo) await mongo.stop();
  delete process.env.DISABLE_RATE_LIMIT;
});

const integration = (name, fn) => test(name, { skip: !enabled }, fn);

/** One turn of the JSON-RPC conversation, with the Accept header every MCP client sends. */
let rpcId = 0;
const mcp = (token, method, params = {}) => request(app).post('/mcp')
  .set('Authorization', `Bearer ${token}`)
  .set('Accept', 'application/json, text/event-stream')
  .send({ jsonrpc: '2.0', id: ++rpcId, method, params });

/** A tool result carries JSON as text; this is what the model reads back. */
const resultOf = res => {
  const payload = res.body?.result;
  const text = payload?.content?.[0]?.text;
  try { return { data: JSON.parse(text), isError: !!payload?.isError }; }
  catch { return { data: text, isError: !!payload?.isError }; }
};
const callTool = async (token, name, args) => resultOf(await mcp(token, 'tools/call', { name, arguments: args }));

/**
 * The whole approval dance, as a client and a browser would perform it between them.
 *
 * Starts by disconnecting everything, because both the per-account connection cap and the daily
 * card allowance are cumulative by design — so without this the suite's own earlier tests
 * eventually trip the limits that later tests are not about, and the failure lands nowhere near
 * its cause.
 */
async function connect(agent = owner, scopes) {
  await agent.delete('/api/agent/grants');
  const reg = await request(app).post('/oauth/register').send({ client_name: 'Claude', redirect_uris: [REDIRECT] });
  assert.equal(reg.status, 201, JSON.stringify(reg.body));
  const verifier = crypto.randomBytes(48).toString('base64url');
  const query = {
    response_type: 'code', client_id: reg.body.client_id, redirect_uri: REDIRECT,
    code_challenge: crypto.createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256', state: 'st4te',
    ...(scopes ? { scope: scopes.join(' ') } : {}),
  };
  const approved = await agent.post('/api/oauth/consent').send({ ...query, approve: true });
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  const code = new URL(approved.body.redirect).searchParams.get('code');
  const tok = await request(app).post('/oauth/token')
    .send({ grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: REDIRECT, client_id: reg.body.client_id });
  assert.equal(tok.status, 200, JSON.stringify(tok.body));
  return { ...tok.body, clientId: reg.body.client_id, verifier, query };
}

// ── Discovery and registration ──────────────────────────────────────────────────────────────

integration('an unauthenticated call is refused with the header that starts discovery', async () => {
  const res = await request(app).post('/mcp').set('Accept', 'application/json, text/event-stream')
    .send({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
  assert.equal(res.status, 401);
  // Without this a client reports "the server said no" and stops; with it, it registers itself.
  assert.match(res.headers['www-authenticate'], /resource_metadata=".*\/\.well-known\/oauth-protected-resource"/);
  assert.equal(res.headers['access-control-expose-headers']?.includes('WWW-Authenticate'), true,
    'a browser client has to be able to read the challenge');
});

integration('a session cookie is not a way into the assistant endpoint', async () => {
  // The cookie authenticates the browser, and a browser attaches it to any site's request. If it
  // worked here, /mcp would be a cross-site write endpoint with no origin check in front of it.
  const res = await owner.post('/mcp').set('Accept', 'application/json, text/event-stream')
    .send({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
  assert.equal(res.status, 401);
});

integration('registration accepts https and loopback, and refuses anything else', async () => {
  const good = await request(app).post('/oauth/register').send({ client_name: 'Desktop', redirect_uris: ['http://127.0.0.1:9000/cb'] });
  assert.equal(good.status, 201);
  assert.equal(good.body.token_endpoint_auth_method, 'none', 'public client by default; PKCE is the proof');
  assert.ok(!good.body.client_secret, 'no secret handed to a client that cannot keep one');

  for (const uri of ['evil-scheme://steal', 'http://attacker.example/cb', 'javascript:alert(1)']) {
    const bad = await request(app).post('/oauth/register').send({ client_name: 'Evil', redirect_uris: [uri] });
    assert.equal(bad.status, 400, uri);
    assert.equal(bad.body.error, 'invalid_redirect_uri', uri);
  }
  const none = await request(app).post('/oauth/register').send({ client_name: 'Evil' });
  assert.equal(none.body.error, 'invalid_client_metadata');
});

// ── The authorization flow ──────────────────────────────────────────────────────────────────

integration('an authorization request may only be sent where the client registered', async () => {
  const reg = await request(app).post('/oauth/register').send({ client_name: 'Claude', redirect_uris: [REDIRECT] });
  const base = {
    response_type: 'code', client_id: reg.body.client_id,
    code_challenge: crypto.randomBytes(32).toString('base64url'), code_challenge_method: 'S256',
  };
  // The redirect is checked before anything is echoed back to it, so this can never become an
  // open redirect for an error response.
  const moved = await owner.get('/api/oauth/consent').query({ ...base, redirect_uri: 'https://attacker.example/steal' });
  assert.equal(moved.status, 400);

  const plain = await owner.get('/api/oauth/consent').query({ ...base, redirect_uri: REDIRECT, code_challenge_method: 'plain' });
  assert.equal(plain.status, 400, 'PKCE cannot be downgraded');

  const noPkce = await owner.get('/api/oauth/consent').query({ response_type: 'code', client_id: reg.body.client_id, redirect_uri: REDIRECT });
  assert.equal(noPkce.status, 400, 'PKCE cannot be skipped');

  const wrongResource = await owner.get('/api/oauth/consent').query({ ...base, redirect_uri: REDIRECT, resource: 'https://somewhere.else/mcp' });
  assert.equal(wrongResource.status, 400, 'a token for another service is not ours to issue');

  const ok = await owner.get('/api/oauth/consent').query({ ...base, redirect_uri: REDIRECT });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.client.redirectHost, 'claude.ai', 'the screen names where the result is going');
  // Asking for nothing in particular means every scope, and the screen lists all of them.
  assert.deepEqual(ok.body.scopes.map(s => s.id), SCOPE_IDS);
});

integration('a code is bound to its verifier, to its client, and to one use', async () => {
  const reg = await request(app).post('/oauth/register').send({ client_name: 'Claude', redirect_uris: [REDIRECT] });
  const verifier = crypto.randomBytes(48).toString('base64url');
  const query = {
    response_type: 'code', client_id: reg.body.client_id, redirect_uri: REDIRECT,
    code_challenge: crypto.createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256',
  };
  const codeFor = async () => new URL((await owner.post('/api/oauth/consent').send({ ...query, approve: true })).body.redirect).searchParams.get('code');

  const wrong = await request(app).post('/oauth/token').send({
    grant_type: 'authorization_code', code: await codeFor(),
    code_verifier: crypto.randomBytes(48).toString('base64url'), redirect_uri: REDIRECT, client_id: reg.body.client_id,
  });
  assert.equal(wrong.status, 400);
  assert.equal(wrong.body.error, 'invalid_grant');

  const mismatched = await request(app).post('/oauth/token').send({
    grant_type: 'authorization_code', code: await codeFor(), code_verifier: verifier,
    redirect_uri: 'http://127.0.0.1:9000/cb', client_id: reg.body.client_id,
  });
  assert.equal(mismatched.body.error, 'invalid_grant', 'the redirect is part of what the code is bound to');

  const code = await codeFor();
  const first = await request(app).post('/oauth/token').send({ grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: REDIRECT, client_id: reg.body.client_id });
  assert.equal(first.status, 200);
  assert.equal(first.headers['cache-control'], 'no-store');
  assert.ok(first.body.access_token && first.body.refresh_token);

  const replay = await request(app).post('/oauth/token').send({ grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: REDIRECT, client_id: reg.body.client_id });
  assert.equal(replay.body.error, 'invalid_grant', 'a code is spent on first use');
});

integration('declining tells the client rather than leaving it waiting', async () => {
  const reg = await request(app).post('/oauth/register').send({ client_name: 'Claude', redirect_uris: [REDIRECT] });
  const res = await owner.post('/api/oauth/consent').send({
    response_type: 'code', client_id: reg.body.client_id, redirect_uri: REDIRECT,
    code_challenge: crypto.randomBytes(32).toString('base64url'), code_challenge_method: 'S256',
    state: 'keepme', approve: false,
  });
  assert.equal(res.status, 200);
  const url = new URL(res.body.redirect);
  assert.equal(url.searchParams.get('error'), 'access_denied');
  assert.equal(url.searchParams.get('state'), 'keepme');
  assert.ok(!url.searchParams.get('code'));
});

integration('refreshing rotates both halves and retires the old refresh token', async () => {
  const { refresh_token, clientId } = await connect();
  const again = await request(app).post('/oauth/token').send({ grant_type: 'refresh_token', refresh_token, client_id: clientId });
  assert.equal(again.status, 200);
  assert.notEqual(again.body.refresh_token, refresh_token, 'OAuth 2.1 rotation on a public client');

  const reused = await request(app).post('/oauth/token').send({ grant_type: 'refresh_token', refresh_token, client_id: clientId });
  assert.equal(reused.body.error, 'invalid_grant', 'the old one is dead the moment the new one is issued');
});

// ── The tool surface ────────────────────────────────────────────────────────────────────────

integration('the advertised tools are the five additive ones', async () => {
  const { access_token } = await connect();
  const res = await mcp(access_token, 'tools/list');
  assert.equal(res.status, 200);
  const names = res.body.result.tools.map(t => t.name).sort();
  assert.deepEqual(names, ['add_cards', 'create_collection', 'list_collections', 'search_cards', 'set_collection_cover']);
  for (const tool of res.body.result.tools) {
    assert.notEqual(tool.annotations?.destructiveHint, true, `${tool.name} must not be destructive`);
    assert.ok(tool.description.length > 40, `${tool.name} needs a description the model can act on`);
  }
});

integration('a collection an assistant creates is private, whatever it asks for', async () => {
  const { access_token } = await connect();
  const { data } = await callTool(access_token, 'create_collection', {
    title: 'Organic Chemistry', description: 'From the PDF', color: 'green', icon: 'flask', visibility: 'global',
  });
  assert.equal(data.visibility, 'private', 'publishing is a human decision');
  const folder = await Folder.findById(data.id);
  assert.equal(folder.visibility, 'private');
  assert.equal(String(folder.owner), ownerId);
  assert.equal(folder.icon, 'flask');
});

integration('cards are added, and a retried call does not add them twice', async () => {
  const { access_token } = await connect();
  const { data: made } = await callTool(access_token, 'create_collection', { title: 'Mechanisms' });
  const requestId = crypto.randomUUID();
  const cards = [
    { front: 'What is a nucleophile?', back: 'An electron-rich species that donates a pair of electrons.', tags: ['chem'], source: 'Chapter 4, page 112' },
    { front: 'SN2 proceeds with {{c1::inversion}} of configuration.', back: '', hint: 'Which side does it attack from?' },
  ];
  const first = await callTool(access_token, 'add_cards', { collectionId: made.id, cards, requestId });
  assert.equal(first.isError, false, JSON.stringify(first.data));
  assert.equal(first.data.added, 2);

  const retry = await callTool(access_token, 'add_cards', { collectionId: made.id, cards, requestId });
  assert.equal(retry.data.replayed, true, 'the original answer, replayed');
  assert.equal(await Card.countDocuments({ folder: made.id }), 2, 'and no second copy');

  // The unparseable source was swept, the cloze card kept its empty back, tags were normalised.
  const written = await Card.find({ folder: made.id }).sort({ createdAt: 1 });
  assert.equal(written[0].source, '');
  assert.deepEqual(written[0].tags, ['chem']);
  assert.equal(written[1].back.text, '');
});

integration('a card that cannot be stored names itself so the model can fix it', async () => {
  const { access_token } = await connect();
  const { data: made } = await callTool(access_token, 'create_collection', { title: 'Errors' });
  const bad = await callTool(access_token, 'add_cards', {
    collectionId: made.id,
    cards: [{ front: 'Fine', back: 'Good' }, { front: 'No answer here', back: '' }],
    requestId: crypto.randomUUID(),
  });
  assert.equal(bad.isError, true);
  assert.match(bad.data, /card 2/, 'the index of the offending card');
  assert.equal(await Card.countDocuments({ folder: made.id }), 0, 'nothing is written when part of the batch is bad');
});

integration('a batch larger than one call can finish is refused, not truncated', async () => {
  const { access_token } = await connect();
  const { data: made } = await callTool(access_token, 'create_collection', { title: 'Too many' });
  const many = Array.from({ length: AGENT_LIMITS.cardsPerCall + 1 }, (_, i) => ({ front: `Q${i}`, back: `A${i}` }));
  const res = await callTool(access_token, 'add_cards', { collectionId: made.id, cards: many, requestId: crypto.randomUUID() });
  assert.equal(res.isError, true);
  assert.match(res.data, new RegExp(String(AGENT_LIMITS.cardsPerCall)));
  assert.equal(await Card.countDocuments({ folder: made.id }), 0);
});

// ── Images ──────────────────────────────────────────────────────────────────────────────────

/**
 * These stop at the point of the outbound request, and that is the strongest statement the suite
 * can make about it.
 *
 * A test that actually fetched an image would need a server the fetcher is willing to reach —
 * public, over TLS, with a certificate that verifies. Every address a test can stand up is on
 * loopback, which is precisely what is refused. So the assertions here are that the refusals
 * happen, that they happen *before* anything is stored, and that a batch survives them; the
 * address checking itself is covered exhaustively in the unit tests, against the table rather
 * than the network.
 */

integration('fetching an image needs its own permission, separate from writing cards', async () => {
  const { access_token } = await connect(owner, ['collections:read', 'collections:write', 'cards:write']);
  const { data: made } = await callTool(access_token, 'create_collection', { title: 'No pictures' });

  // Text-only cards are unaffected: the extra permission is checked when a URL appears, not up
  // front, so a narrower grant keeps working for everything except the pictures.
  const plain = await callTool(access_token, 'add_cards', {
    collectionId: made.id, cards: [{ front: 'Q', back: 'A' }], requestId: crypto.randomUUID(),
  });
  assert.equal(plain.data.added, 1);

  const withImage = await callTool(access_token, 'add_cards', {
    collectionId: made.id,
    cards: [{ front: 'Q2', back: 'A2', frontImage: 'https://example.org/diagram.png' }],
    requestId: crypto.randomUUID(),
  });
  assert.equal(withImage.isError, true);
  assert.match(withImage.data, /permission/i);
  assert.equal(await Card.countDocuments({ folder: made.id }), 1, 'nothing written, nothing fetched');
});

integration('an address that is not on the public internet is never fetched', async () => {
  const { access_token } = await connect();
  const { data: made } = await callTool(access_token, 'create_collection', { title: 'SSRF' });

  /**
   * The metadata service first, because it is the one with real consequences: on this host, and
   * on every other cloud, it hands out the instance's own credentials to any local HTTP request.
   */
  for (const url of [
    'https://169.254.169.254/latest/meta-data/iam/security-credentials/',
    'https://127.0.0.1/admin',
    'https://10.0.0.1/internal',
    'https://localhost/x.png',
  ]) {
    const res = await callTool(access_token, 'add_cards', {
      collectionId: made.id,
      cards: [{ front: 'Only a picture', back: 'x', frontImage: url }],
      requestId: crypto.randomUUID(),
    });
    // The card had text, so it is written; the image is reported as having failed. The point is
    // that no request left the process and nothing was stored.
    assert.equal(res.isError, false, JSON.stringify(res.data));
    assert.equal(res.data.imagesStored, undefined, url);
    assert.equal(res.data.imagesFailed?.length, 1, url);
    /**
     * Every refusal reads the same, whichever private range it aimed at and whether or not
     * anything is listening there. A message that distinguished "refused" from "no route" from
     * "timed out" would turn this into a port scanner for the network we run on.
     */
    assert.match(res.data.imagesFailed[0].reason, /not on the public internet/, url);
  }
  assert.equal(await Media.countDocuments({ folder: made.id }), 0);
});

integration('one bad image does not lose the batch it came with', async () => {
  const { access_token } = await connect();
  const { data: made } = await callTool(access_token, 'create_collection', { title: 'Mixed' });
  const res = await callTool(access_token, 'add_cards', {
    collectionId: made.id,
    cards: [
      { front: 'Good card', back: 'Kept' },
      { front: 'Also good', back: 'Kept', backImage: 'https://127.0.0.1/nope.png' },
      // Nothing but a picture that cannot be had, so this one is not a card at all.
      { front: '', back: 'x', frontImage: 'https://10.1.1.1/nope.png' },
    ],
    requestId: crypto.randomUUID(),
  });
  assert.equal(res.isError, false, JSON.stringify(res.data));
  assert.equal(res.data.added, 2, 'the readable cards are written');
  assert.equal(res.data.cardsSkipped?.length, 1, 'and the one left empty says so');
  assert.ok(res.data.imagesFailed.length >= 1);
});

integration('a call cannot ask for more pictures than it can finish fetching', async () => {
  const { access_token } = await connect();
  const { data: made } = await callTool(access_token, 'create_collection', { title: 'Greedy' });
  const cards = Array.from({ length: AGENT_LIMITS.imagesPerCall + 1 }, (_, i) => ({
    front: `Q${i}`, back: `A${i}`, frontImage: `https://example.org/${i}.png`,
  }));
  const res = await callTool(access_token, 'add_cards', { collectionId: made.id, cards, requestId: crypto.randomUUID() });
  assert.equal(res.isError, true);
  assert.match(res.data, new RegExp(String(AGENT_LIMITS.imagesPerCall)));
  assert.equal(await Card.countDocuments({ folder: made.id }), 0);

  // The same URL on every card is one image, so the ceiling counts distinct addresses and this
  // is allowed through to the fetch.
  const repeated = Array.from({ length: AGENT_LIMITS.imagesPerCall + 1 }, (_, i) => ({
    front: `R${i}`, back: `A${i}`, frontImage: 'https://example.org/same.png',
  }));
  const reused = await callTool(access_token, 'add_cards', { collectionId: made.id, cards: repeated, requestId: crypto.randomUUID() });
  assert.doesNotMatch(String(reused.data), new RegExp(`at most ${AGENT_LIMITS.imagesPerCall} different`));
});

integration('an operator can stop assistants fetching without stopping anything else', async () => {
  const { access_token } = await connect();
  const { data: made } = await callTool(access_token, 'create_collection', { title: 'Switched off' });
  await Setting.updateOne({ key: 'agent.imagesPerDay' }, { $set: { key: 'agent.imagesPerDay', value: 0 } }, { upsert: true });
  await reload();
  try {
    const res = await callTool(access_token, 'add_cards', {
      collectionId: made.id,
      cards: [{ front: 'Q', back: 'A', frontImage: 'https://example.org/a.png' }],
      requestId: crypto.randomUUID(),
    });
    assert.equal(res.isError, true);
    assert.match(res.data, /switched off/i);

    // Cards without pictures are untouched by it.
    const text = await callTool(access_token, 'add_cards', {
      collectionId: made.id, cards: [{ front: 'Q', back: 'A' }], requestId: crypto.randomUUID(),
    });
    assert.equal(text.data.added, 1);
  } finally {
    await Setting.deleteOne({ key: 'agent.imagesPerDay' });
    await reload();
  }
});

integration('a published collection keeps the cover its owner chose', async () => {
  const { access_token } = await connect();
  const { data: made } = await callTool(access_token, 'create_collection', { title: 'Published' });
  await Folder.updateOne({ _id: made.id }, { $set: { visibility: 'global' } });

  const res = await callTool(access_token, 'set_collection_cover', {
    collectionId: made.id, imageUrl: 'https://example.org/cover.png', requestId: crypto.randomUUID(),
  });
  assert.equal(res.isError, true);
  assert.match(res.data, /published/i);
  // Refused before the fetch, so a published collection cannot even be used to make us request
  // something.
  assert.equal(await AgentBatch.countDocuments({ folder: made.id }), 0);
});

/**
 * The parts of the image path that only exist once there is an image, exercised directly.
 *
 * Going through the tools would need a fetch that cannot happen in a test, so this builds the
 * state a successful fetch would have left and checks what happens next: that a second copy of
 * the same picture costs nothing, and that undoing takes the bucket objects with it.
 */
integration('the same picture stored twice in a collection is stored once', async () => {
  const folder = await Folder.create({ title: 'Dedupe', owner: ownerId });
  const png = await sharp({ create: { width: 12, height: 12, channels: 3, background: '#111827' } }).png().toBuffer();

  const first = await mediaService.store(png, { folder: folder.id, user: ownerId, name: 'a.png' });
  assert.equal(first.reused, false);
  assert.match(first.media.sha256, /^[a-f\d]{64}$/);
  // The attach step must stringify this. `cardSchema` is the HTTP schema and will not take an ObjectId.
  const asId = cardSchema.safeParse({ front: { text: 'Q', image: first.media._id }, back: { text: 'A' } });
  assert.equal(asId.success, false, 'passing the ObjectId is the bug that skipped every pictured card');
  assert.equal(cardSchema.parse({ front: { text: 'Q', image: String(first.media._id) }, back: { text: 'A' } }).front.image, String(first.media._id));

  // Same bytes, different name and a different address: the fingerprint is of what we stored, so
  // neither of those makes it a different picture.
  const again = await mediaService.store(png, { folder: folder.id, user: ownerId, name: 'b.png', sourceUrl: 'https://other.example/b.png' });
  assert.equal(again.reused, true);
  assert.equal(String(again.media._id), String(first.media._id));
  assert.equal(await Media.countDocuments({ folder: folder.id }), 1);

  // A different picture is still a different picture.
  const other = await sharp({ create: { width: 12, height: 12, channels: 3, background: '#f59e0b' } }).png().toBuffer();
  assert.equal((await mediaService.store(other, { folder: folder.id, user: ownerId })).reused, false);
  assert.equal(await Media.countDocuments({ folder: folder.id }), 2);
});

integration('undoing a batch reclaims the images it stored, and only those', async () => {
  const folder = await Folder.create({ title: 'Reclaim', owner: ownerId });
  const make = async shade => (await mediaService.store(
    await sharp({ create: { width: 10, height: 10, channels: 3, background: shade } }).png().toBuffer(),
    { folder: folder.id, user: ownerId },
  )).media;

  const [batchImage, keptImage, coverImage] = [await make('#dc2626'), await make('#16a34a'), await make('#2563eb')];
  const previousCover = await make('#7c3aed');
  await Folder.updateOne({ _id: folder.id }, { $set: { thumbnail: coverImage._id } });

  // A card the assistant wrote, and one the person wrote afterwards that happens to use an image
  // out of the same batch. The second is the reason undo asks who is still using a picture
  // rather than trusting the batch record.
  const by = { createdBy: ownerId, updatedBy: ownerId };
  const [agentCard] = await Card.create([{ folder: folder.id, front: { text: 'From the model', image: batchImage._id }, back: { text: 'x' }, ...by }]);
  await Card.create([{ folder: folder.id, front: { text: 'Mine', image: keptImage._id }, back: { text: 'y' }, ...by }]);

  const batch = await AgentBatch.create({
    user: ownerId, folder: folder.id, folderTitle: folder.title,
    cards: [agentCard._id], cardCount: 1,
    media: [batchImage._id, keptImage._id, coverImage._id], imageCount: 3,
    coverMedia: coverImage._id, previousCover: String(previousCover._id),
    requestId: crypto.randomUUID(), result: { added: 1 },
  });

  const undone = await tools.undoBatch(await User.findById(ownerId), batch.id);
  assert.equal(undone.removed, 1);

  assert.equal(await Media.exists({ _id: batchImage._id }), null, 'nothing points at it any more');
  assert.ok(await Media.exists({ _id: keptImage._id }), "a hand-written card's image survives");
  assert.equal(await Media.exists({ _id: coverImage._id }), null, 'the cover this batch set goes too');
  assert.ok(await Media.exists({ _id: previousCover._id }), 'the cover from before does not');

  const after = await Folder.findById(folder.id);
  assert.equal(String(after.thumbnail), String(previousCover._id), 'the old cover is put back, not left dangling');
});

integration('a collection you cannot write to is not a way to make us fetch things', async () => {
  /**
   * The order of the checks, which is easy to get wrong and invisible when it is.
   *
   * If the permission on the collection were checked where the writing happens, the downloads
   * would already have run by the time the call was refused — and naming somebody else's
   * collection would be a way to point this server at any address and have it fetch, with the
   * refusal arriving too late to matter.
   */
  const mine = await Folder.create({ title: 'Not yours', owner: strangerId });
  const { access_token } = await connect();
  const res = await callTool(access_token, 'add_cards', {
    collectionId: mine.id,
    cards: [{ front: 'Q', back: 'A', frontImage: 'https://example.org/probe.png' }],
    requestId: crypto.randomUUID(),
  });
  assert.equal(res.isError, true);
  // Refused for the collection, not for the picture: the image never got as far as being tried.
  assert.doesNotMatch(String(res.data), /image|fetch/i, JSON.stringify(res.data));
  assert.equal(await Card.countDocuments({ folder: mine.id }), 0);
});

integration('a token is held to the scopes the person approved', async () => {
  const readOnly = await owner.post('/api/agent/grants').send({ name: 'Read only', scopes: ['collections:read'] });
  assert.equal(readOnly.status, 201);
  const token = readOnly.body.token;

  const listed = await callTool(token, 'list_collections', {});
  assert.equal(listed.isError, false, 'reading is allowed');

  for (const [name, args] of [['create_collection', { title: 'Nope' }], ['add_cards', { collectionId: '507f1f77bcf86cd799439011', cards: [{ front: 'a', back: 'b' }], requestId: crypto.randomUUID() }]]) {
    const res = await callTool(token, name, args);
    assert.equal(res.isError, true, name);
    assert.match(res.data, /permission/i, name);
  }
});

integration("an assistant cannot reach another person's collections", async () => {
  const mine = await Folder.create({ title: 'Private notes', owner: strangerId, visibility: 'private' });
  const { access_token } = await connect();

  const write = await callTool(access_token, 'add_cards', { collectionId: mine.id, cards: [{ front: 'a', back: 'b' }], requestId: crypto.randomUUID() });
  assert.equal(write.isError, true);
  assert.equal(await Card.countDocuments({ folder: mine.id }), 0);

  const listed = await callTool(access_token, 'list_collections', {});
  assert.ok(!listed.data.collections.some(c => c.id === mine.id), 'and cannot even see it');

  // A collection published to the world is readable by anyone, but that must not make it writable.
  await Folder.updateOne({ _id: mine._id }, { $set: { visibility: 'global' } });
  const published = await callTool(access_token, 'add_cards', { collectionId: mine.id, cards: [{ front: 'a', back: 'b' }], requestId: crypto.randomUUID() });
  assert.equal(published.isError, true, 'public means readable, not writable');
  assert.equal(await Card.countDocuments({ folder: mine.id }), 0);
});

integration('search escapes what it is given and finds what was written', async () => {
  const { access_token } = await connect();
  const { data: made } = await callTool(access_token, 'create_collection', { title: 'Searchable' });
  await callTool(access_token, 'add_cards', { collectionId: made.id, cards: [{ front: 'What is a catalyst?', back: 'It lowers activation energy.' }], requestId: crypto.randomUUID() });

  const hit = await callTool(access_token, 'search_cards', { query: 'catalyst' });
  assert.equal(hit.data.matches.length, 1);
  assert.match(hit.data.matches[0].front, /catalyst/i);

  // Untrusted text in a regular expression is either escaped or a denial of service.
  const evil = await callTool(access_token, 'search_cards', { query: '(a+)+$' });
  assert.equal(evil.isError, false);
  assert.deepEqual(evil.data.matches, []);
  const dot = await callTool(access_token, 'search_cards', { query: '.*' });
  assert.deepEqual(dot.data.matches, [], 'a wildcard is matched literally, not run');
});

// ── The safety net ──────────────────────────────────────────────────────────────────────────

integration('a batch can be undone, and takes only its own cards with it', async () => {
  const { access_token } = await connect();
  const { data: made } = await callTool(access_token, 'create_collection', { title: 'Undo me' });
  await callTool(access_token, 'add_cards', { collectionId: made.id, cards: [{ front: 'Agent 1', back: 'x' }, { front: 'Agent 2', back: 'y' }], requestId: crypto.randomUUID() });
  // Something the person wrote themselves, which must survive.
  const mine = await owner.post(`/api/folders/${made.id}/cards`).send({ front: { text: 'Mine' }, back: { text: 'z' } });
  assert.equal(mine.status, 201);

  const list = await owner.get('/api/agent/batches');
  assert.equal(list.status, 200);
  const batch = list.body.batches.find(b => b.collectionId === made.id);
  assert.equal(batch.cardCount, 2);
  assert.equal(batch.by, 'Claude', 'the screen says which assistant did it');

  const undone = await owner.post(`/api/agent/batches/${batch.id}/undo`);
  assert.equal(undone.status, 200);
  assert.equal(undone.body.removed, 2);

  const left = await Card.find({ folder: made.id });
  assert.equal(left.length, 1);
  assert.equal(left[0].front.text, 'Mine');

  const twice = await owner.post(`/api/agent/batches/${batch.id}/undo`);
  assert.equal(twice.status, 409, 'undoing twice is a conflict, not a second deletion');
});

integration('undo is the account holder\'s, and an assistant has no way to call it', async () => {
  const { access_token } = await connect();
  const { data: made } = await callTool(access_token, 'create_collection', { title: 'Not yours' });
  await callTool(access_token, 'add_cards', { collectionId: made.id, cards: [{ front: 'a', back: 'b' }], requestId: crypto.randomUUID() });
  const batch = (await owner.get('/api/agent/batches')).body.batches.find(b => b.collectionId === made.id);

  // There is no tool for it, and the REST route behind it is session-only.
  const viaTool = await callTool(access_token, 'undo_batch', { id: batch.id });
  assert.equal(viaTool.isError, true);
  const viaRest = await request(app).post(`/api/agent/batches/${batch.id}/undo`).set('Authorization', `Bearer ${access_token}`);
  assert.equal(viaRest.status, 401);
  // And another account cannot undo, or even see, someone else's batch.
  assert.equal((await stranger.post(`/api/agent/batches/${batch.id}/undo`)).status, 404);
});

integration('revoking a connection stops it immediately, in both directions', async () => {
  const { access_token, refresh_token, clientId } = await connect();
  assert.equal((await mcp(access_token, 'tools/list')).status, 200);

  const grants = await owner.get('/api/agent');
  const grant = grants.body.grants.find(g => g.createdVia === 'oauth');
  assert.equal((await owner.delete(`/api/agent/grants/${grant.id}`)).status, 200);

  assert.equal((await mcp(access_token, 'tools/list')).status, 401, 'the access token is dead');
  const refreshed = await request(app).post('/oauth/token').send({ grant_type: 'refresh_token', refresh_token, client_id: clientId });
  assert.equal(refreshed.body.error, 'invalid_grant', 'and it cannot be resurrected');

  // The row survives as a tombstone, so the batches it wrote still say who wrote them.
  const row = await AgentToken.findById(grant.id);
  assert.ok(row.revokedAt);
  assert.equal(row.accessHash, undefined, 'the secret is gone, not merely flagged');
});

integration('the daily allowance is enforced and returned by undoing', async () => {
  // Today's total is counted across every batch this account's assistants have written, which by
  // now includes the rest of this file. Start the day over.
  await AgentBatch.deleteMany({ user: ownerId });
  await Setting.updateOne({ key: 'agent.cardsPerDay' }, { $set: { value: 3 } }, { upsert: true });
  await reload();
  try {
    const { access_token } = await connect();
    const { data: made } = await callTool(access_token, 'create_collection', { title: 'Quota' });
    const three = await callTool(access_token, 'add_cards', { collectionId: made.id, cards: [1, 2, 3].map(n => ({ front: `Q${n}`, back: `A${n}` })), requestId: crypto.randomUUID() });
    assert.equal(three.data.added, 3);
    assert.equal(three.data.remainingToday, 0);

    const over = await callTool(access_token, 'add_cards', { collectionId: made.id, cards: [{ front: 'One more', back: 'x' }], requestId: crypto.randomUUID() });
    assert.equal(over.isError, true);
    assert.match(over.data, /midnight/i, 'and says when it resets');

    const batch = (await owner.get('/api/agent/batches')).body.batches.find(b => b.collectionId === made.id);
    await owner.post(`/api/agent/batches/${batch.id}/undo`);
    const after = await callTool(access_token, 'add_cards', { collectionId: made.id, cards: [{ front: 'Now fine', back: 'x' }], requestId: crypto.randomUUID() });
    assert.equal(after.isError, false, 'throwing away what it wrote gives the allowance back');
  } finally {
    await Setting.deleteOne({ key: 'agent.cardsPerDay' });
    await reload();
  }
});

integration('the operator switch closes the feature without touching anything written', async () => {
  const { access_token } = await connect();
  const { data: made } = await callTool(access_token, 'create_collection', { title: 'Still here' });
  await Setting.updateOne({ key: 'agent.enabled' }, { $set: { value: false } }, { upsert: true });
  await reload();
  try {
    const res = await mcp(access_token, 'tools/list');
    assert.equal(res.status, 503);
    assert.equal(res.body.error.data.code, 'AGENTS_OFF');
    assert.equal((await request(app).post('/oauth/token').send({ grant_type: 'refresh_token', refresh_token: 'x', client_id: 'y' })).status >= 400, true);
    // The collection and its cards are untouched, and the owner can still see them.
    assert.equal((await owner.get(`/api/folders/${made.id}`)).status, 200);
  } finally {
    await Setting.deleteOne({ key: 'agent.enabled' });
    await reload();
  }
  assert.equal((await mcp(access_token, 'tools/list')).status, 200, 'and it works again the moment it is switched back');
});

integration('a lapsed subscription stops new work but never the clean-up', async () => {
  const { access_token } = await connect();
  const { data: made } = await callTool(access_token, 'create_collection', { title: 'Lapsed' });
  await callTool(access_token, 'add_cards', { collectionId: made.id, cards: [{ front: 'a', back: 'b' }], requestId: crypto.randomUUID() });
  await User.updateOne({ _id: ownerId }, { $set: { account: 'normal' } });
  try {
    assert.equal((await mcp(access_token, 'tools/list')).status, 402, 'the assistant is cut off');
    assert.equal((await owner.post('/api/agent/grants').send({ name: 'New', scopes: ['cards:write'] })).status, 402);
    // But everything needed to see what happened and undo it keeps working, because taking the
    // safety net away from a lapsed customer would be a strange way to treat them.
    const batch = (await owner.get('/api/agent/batches')).body.batches.find(b => b.collectionId === made.id);
    assert.ok(batch, 'the review list is still readable');
    assert.equal((await owner.get('/api/agent')).status, 200);
    assert.equal((await owner.post(`/api/agent/batches/${batch.id}/undo`)).status, 200);
    const grant = (await owner.get('/api/agent')).body.grants[0];
    assert.equal((await owner.delete(`/api/agent/grants/${grant.id}`)).status, 200, 'and it can still be disconnected');
  } finally {
    await User.updateOne({ _id: ownerId }, { $set: { account: 'premium' } });
  }
});

integration('the secret is shown once and is never readable afterwards', async () => {
  await owner.delete('/api/agent/grants');
  const made = await owner.post('/api/agent/grants').send({ name: 'Once', scopes: ['collections:read'] });
  assert.equal(made.status, 201);
  assert.ok(made.body.token.startsWith(`${BRAND.slug}_at_`));
  assert.ok(!JSON.stringify(made.body.grant).includes(made.body.token), 'not echoed back in the record');

  const overview = await owner.get('/api/agent');
  assert.ok(!JSON.stringify(overview.body).includes(made.body.token), 'and not in the listing');
  // Nor is it in the database in a form anyone could use.
  const rows = await AgentToken.find({ user: ownerId }).lean();
  assert.ok(!JSON.stringify(rows).includes(made.body.token));
});
