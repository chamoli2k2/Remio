import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import sharp from 'sharp';
import { SCOPES, SCOPE_IDS, DEFAULT_SCOPES, TOOL_SCOPES, TOOL_NAMES, AGENT_LIMITS, parseScopes, scopeString, looksLikeToken, TOKEN_PREFIX, MCP_PATH } from '../../shared/agent.js';
import { isPublicAddress, fetchImage } from '../src/services/fetchImage.js';
import { ingest } from '../src/services/images.js';
import { validRedirect, authorizationServerMetadata, protectedResourceMetadata, challengeHeader } from '../src/services/agent/oauth.js';
import mongoose from 'mongoose';
import { agentCardSchema, agentCollectionSchema, cardSchema } from '../src/middleware/validate.js';
import { SETTINGS } from '../../shared/settings.js';
import * as tools from '../src/services/agent/tools.js';

/**
 * The parts of the assistant integration that can be checked without a database.
 *
 * Most of these guard a decision rather than a behaviour. The tool surface being additive is not
 * something the code will stop doing by accident; it is something a later change could undo by
 * adding one convenient function, and the point of the first test here is that such a change
 * fails loudly rather than quietly widening what a prompt injection can reach.
 */

test('the tool surface is additive: nothing deletes, edits, or publishes', () => {
  // Named tools, checked by name. Crude on purpose — it is meant to catch the pull request that
  // adds `delete_collection` because it seemed useful, not to prove the handlers behave.
  for (const name of TOOL_NAMES) {
    assert.doesNotMatch(name, /delete|remove|destroy|drop|purge|update|edit|publish|share|revoke/,
      `${name} is not an additive operation; an assistant must not be able to call it`);
  }
  // Undo is the counterweight to the whole feature and must stay out of reach of the thing it undoes.
  assert.ok(typeof tools.undoBatch === 'function', 'undo exists');
  assert.ok(!Object.hasOwn(TOOL_SCOPES, 'undo_batch'), 'undo is never exposed as a tool');
  assert.ok(!Object.hasOwn(TOOL_SCOPES, 'delete_cards'));
});

test('every tool needs a scope, and every scope is one a user is shown', () => {
  for (const [tool, scope] of Object.entries(TOOL_SCOPES)) {
    assert.ok(SCOPE_IDS.includes(scope), `${tool} asks for ${scope}, which is not a real scope`);
  }
  // A scope with no description would render as a blank line on the approval screen, which is
  // how consent screens become theatre.
  for (const [id, spec] of Object.entries(SCOPES)) {
    assert.ok(spec.label && spec.detail, `${id} needs a label and a detail for the approval screen`);
  }
});

test('scope strings survive a round trip and drop anything invented', () => {
  assert.deepEqual(parseScopes('collections:read cards:write'), ['collections:read', 'cards:write']);
  // Order follows the catalogue, not the request, so two grants of the same permissions compare equal.
  assert.equal(scopeString(['cards:write', 'collections:read']), 'collections:read cards:write');
  assert.deepEqual(parseScopes('admin:everything billing:write'), [], 'unknown scopes grant nothing');
  assert.deepEqual(parseScopes(''), DEFAULT_SCOPES, 'asking for nothing means the default set');
  assert.deepEqual(parseScopes('collections:read,cards:write'), ['collections:read', 'cards:write'], 'comma separated too');
});

test('a token is recognisable on sight and cannot be a near miss', () => {
  const real = TOKEN_PREFIX + crypto.randomBytes(32).toString('hex');
  assert.ok(looksLikeToken(real));
  assert.ok(!looksLikeToken(real.slice(0, -1)), 'one character short');
  assert.ok(!looksLikeToken(real + 'a'), 'one character long');
  assert.ok(!looksLikeToken(crypto.randomBytes(32).toString('hex')), 'no prefix');
  assert.ok(!looksLikeToken(real.toUpperCase()), 'case is not negotiable');
  for (const junk of [null, undefined, '', 0, {}, [], 'Bearer ' + real]) assert.ok(!looksLikeToken(junk), String(junk));
});

test('a redirect URI is https or the loopback interface, and nothing else', () => {
  assert.ok(validRedirect('https://claude.ai/api/mcp/auth_callback'));
  assert.ok(validRedirect('http://localhost:33418/oauth/callback'), 'RFC 8252: a desktop client listens locally');
  assert.ok(validRedirect('http://127.0.0.1:1455/callback'));
  assert.ok(validRedirect('http://[::1]:1455/callback'));

  assert.ok(!validRedirect('http://example.com/cb'), 'plain http off the loopback would leak the code');
  // Claimed first-come by any application on the machine, so a code sent to one goes to whoever
  // registered the scheme first.
  assert.ok(!validRedirect('evil-scheme://steal'));
  assert.ok(!validRedirect('javascript:alert(1)'));
  assert.ok(!validRedirect('data:text/html,<script>'));
  assert.ok(!validRedirect('https://ok.example/cb#fragment'), 'a fragment would mangle the response');
  assert.ok(!validRedirect('not a url'));
  assert.ok(!validRedirect('https://' + 'a'.repeat(3000)), 'bounded');
  for (const junk of [null, undefined, 42, {}]) assert.ok(!validRedirect(junk));
});

test('the discovery documents agree with each other and advertise no downgrade', () => {
  const as = authorizationServerMetadata(), pr = protectedResourceMetadata();
  assert.equal(pr.authorization_servers[0], as.issuer, 'the resource points at this issuer');
  assert.ok(pr.resource.endsWith(MCP_PATH));
  assert.ok(as.authorization_endpoint.startsWith(as.issuer), 'endpoints live under the issuer');
  // `plain` would let a client, or anyone who can rewrite its request, opt out of PKCE entirely.
  assert.deepEqual(as.code_challenge_methods_supported, ['S256']);
  assert.deepEqual(as.response_types_supported, ['code'], 'no implicit flow');
  assert.ok(!as.grant_types_supported.includes('password'), 'no password grant');
  assert.deepEqual(as.scopes_supported, SCOPE_IDS);
  // Without this header a client cannot discover where to authenticate, and simply reports a 401.
  assert.match(challengeHeader(), /^Bearer resource_metadata="https?:\/\/.+\/\.well-known\/oauth-protected-resource"/);
});

test('an assistant card is translated into the shape the app already validates', () => {
  const { card } = agentCardSchema.parse({ front: 'What is a mole?', back: '6.022e23 particles', tags: ['Chem', 'chem'], hint: 'Avogadro' });
  assert.deepEqual(card.front, { text: 'What is a mole?' });
  assert.deepEqual(card.back, { text: '6.022e23 particles' });
  assert.deepEqual(card.tags, ['chem'], 'lowercased and deduplicated by the shared schema');

  // A cloze front carries its own answer, so an empty back is allowed exactly where the app allows it.
  assert.ok(agentCardSchema.parse({ front: 'SN2 proceeds with {{c1::inversion}}.', back: '' }));
  assert.throws(() => agentCardSchema.parse({ front: 'No answer', back: '' }), /back/i);
  assert.throws(() => agentCardSchema.parse({ front: '', back: 'orphan' }));
  assert.throws(() => agentCardSchema.parse({ front: 'a'.repeat(10_001), back: 'b' }));
});

test('an assistant cannot smuggle in a picture or a visibility change', () => {
  /**
   * An assistant names images by address, never by id. A media id is the only thing separating a
   * card from a picture in a collection this account cannot see, so one arriving from a model —
   * which could only have guessed it — is dropped rather than honoured.
   */
  const { card, images } = agentCardSchema.parse({
    front: 'Q', back: 'A', image: '507f1f77bcf86cd799439011',
    front_image_id: '507f1f77bcf86cd799439011',
  });
  assert.equal(card.front.image, undefined);
  assert.equal(card.back.image, undefined);
  assert.deepEqual(images, { front: '', back: '' });

  // Addresses are accepted, and only over TLS: a plaintext fetch can have its bytes rewritten in
  // transit, and we would store and serve whatever the rewriter chose.
  assert.equal(agentCardSchema.parse({ front: 'Q', back: 'A', frontImage: 'https://example.org/d.png' }).images.front, 'https://example.org/d.png');
  assert.throws(() => agentCardSchema.parse({ front: 'Q', back: 'A', frontImage: 'http://example.org/d.png' }), /https/i);
  assert.throws(() => agentCardSchema.parse({ front: 'Q', back: 'A', frontImage: 'data:image/png;base64,iVBORw0KGgo=' }));
  assert.throws(() => agentCardSchema.parse({ front: 'Q', back: 'A', frontImage: 'file:///etc/passwd' }));

  // A card with nothing but a picture is a card; one with neither is not.
  assert.ok(agentCardSchema.parse({ front: '', back: 'A', frontImage: 'https://example.org/d.png' }));
  assert.throws(() => agentCardSchema.parse({ front: '', back: '', frontImage: 'https://example.org/d.png' }), /back/i);

  // Publishing is a human decision; the field is not in the schema at all, so it is dropped here
  // as well as being forced in the service.
  const collection = agentCollectionSchema.parse({ title: 'Deck', visibility: 'global', owner: 'someone-else' });
  assert.equal(collection.visibility, undefined);
  assert.equal(collection.owner, undefined);
  assert.equal(collection.title, 'Deck');
});

test('a stored image attaches as a string, because that is what the card schema accepts', () => {
  /**
   * The trap that refused every card with a picture: `Media.create` hands back `_id` as an
   * ObjectId, and `cardSchema` is the HTTP schema, which only ever sees a 24-character string.
   * Covers worked because they never go through this schema. Passing the ObjectId through
   * produced "expected string, received ObjectId" after a successful fetch.
   */
  const id = new mongoose.Types.ObjectId();
  const asObject = cardSchema.safeParse({ front: { text: 'Q', image: id }, back: { text: 'A' } });
  assert.equal(asObject.success, false);
  assert.match(JSON.stringify(asObject.error.issues), /expected string|ObjectId/i);

  const attached = cardSchema.parse({ front: { text: 'Q', image: String(id) }, back: { text: 'A' } });
  assert.equal(attached.front.image, String(id));
});

test('a source that is not a URL is dropped rather than failing the whole batch', () => {
  assert.equal(agentCardSchema.parse({ front: 'Q', back: 'A', source: 'Chapter 4, page 112' }).card.source, '');
  assert.equal(agentCardSchema.parse({ front: 'Q', back: 'A', source: 'https://example.org/p' }).card.source, 'https://example.org/p');
  // The app's own rule, inherited: only http(s) ever reaches an href.
  assert.equal(agentCardSchema.parse({ front: 'Q', back: 'A', source: 'javascript:alert(1)' }).card.source, '');
});

test('the per-call ceiling is small enough to finish inside a client timeout', () => {
  assert.ok(AGENT_LIMITS.cardsPerCall <= 100, 'a call that cannot finish in time gets retried, not completed');
  assert.ok(AGENT_LIMITS.cardsPerCall >= 10, 'small enough to be useless is its own failure');
  assert.ok(AGENT_LIMITS.searchResults <= 50, 'a tool result is spent context');
});

test('the feature is switchable and bounded from the dashboard', () => {
  for (const key of ['agent.enabled', 'agent.cardsPerDay', 'agent.imagesPerDay', 'agent.grantsPerUser', 'agent.tokenDays', 'throttle.agentPerMinute']) {
    assert.ok(SETTINGS[key], `${key} has to be an operator setting`);
  }
  assert.equal(SETTINGS['agent.enabled'].type, 'boolean');
  // A quota of zero would lock out every account with no way back other than a deploy.
  assert.ok(SETTINGS['agent.cardsPerDay'].min >= 1);
  assert.ok(SETTINGS['agent.grantsPerUser'].min >= 1);
  /**
   * Images are the exception, and deliberately so. Fetching is the only thing an assistant does
   * that spends money and reaches out to a stranger's server, so an operator needs a way to stop
   * exactly that without taking the rest of the feature down with it.
   */
  assert.equal(SETTINGS['agent.imagesPerDay'].min, 0, 'zero has to be reachable, as the off switch for fetching');
  assert.ok(SETTINGS['agent.imagesPerDay'].max <= SETTINGS['agent.cardsPerDay'].max,
    'an image costs a download, storage and a resize; a card costs a few hundred bytes');
});

/**
 * Server-side request forgery, which is the whole risk of letting a model name a URL.
 *
 * These run against the address check rather than the network, because the interesting cases are
 * the ones we must never attempt: a test that proved we cannot reach 169.254.169.254 by trying it
 * would pass on a laptop for the wrong reason and mean nothing about production.
 */
test('only addresses on the public internet are fetchable', () => {
  // The one that matters most: every major cloud, this one included, serves instance credentials
  // here to anything that can make a local HTTP request, with no authentication at all.
  assert.equal(isPublicAddress('169.254.169.254'), false, 'the cloud metadata service');

  for (const blocked of [
    '127.0.0.1', '127.1.2.3',       // loopback, in both its obvious and its less obvious spellings
    '0.0.0.0',                       // "this host"
    '10.1.2.3', '172.16.0.1', '172.31.255.254', '192.168.1.1',   // private networks
    '100.64.0.1',                    // carrier NAT, which is a real network on some hosts
    '169.254.1.1',                   // link-local
    '224.0.0.1', '239.1.1.1',        // multicast
    '255.255.255.255',               // broadcast
    '198.18.0.1',                    // benchmarking range
  ]) assert.equal(isPublicAddress(blocked), false, `${blocked} must not be reachable`);

  for (const allowed of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '172.32.0.1', '11.0.0.1']) {
    assert.equal(isPublicAddress(allowed), true, `${allowed} is an ordinary public address`);
  }

  // Neighbours of a blocked range, to catch a mask that is off by one bit. 172.16/12 ends at
  // 172.31.255.255, and a /16 or a /8 written by mistake would swallow 172.32 or 171.x.
  assert.equal(isPublicAddress('172.15.255.255'), true);
  assert.equal(isPublicAddress('172.32.0.0'), true);
  assert.equal(isPublicAddress('100.128.0.1'), true, '100.64/10 ends before here');
  assert.equal(isPublicAddress('9.255.255.255'), true);

  // Anything that is not a dotted quad is not an address we will open a socket to. IPv6 is
  // refused wholesale rather than filtered — see the note in fetchImage.js.
  for (const notAnAddress of ['::1', '::ffff:127.0.0.1', 'fd00::1', 'localhost', '', null, '127.0.0.1 ', '0x7f000001', '2130706433']) {
    assert.equal(isPublicAddress(notAnAddress), false, `${notAnAddress} is not a v4 address`);
  }
});

test('a URL is refused before it is resolved if its shape is wrong', async () => {
  const refuses = async (url, why) => {
    await assert.rejects(() => fetchImage(url), e => e.status === 400, why);
  };
  await refuses('http://example.org/a.png', 'plaintext can be rewritten in transit');
  await refuses('file:///etc/passwd', 'not a network protocol at all');
  await refuses('gopher://example.org/', 'protocol smuggling');
  await refuses('https://user:pass@example.org/a.png', 'credentials in a URL were not meant for us');
  await refuses('https://[::1]/a.png', 'a v6 literal sidesteps the v4 check');
  await refuses('not a url', 'nonsense');
  await refuses('', 'nothing');
  // A name that resolves to loopback is the textbook bypass, and is why the check is on the
  // resolved address and not on the hostname.
  await refuses('https://localhost/a.png', 'a name that resolves somewhere private');
});

/**
 * The format allowlist, which is the other half of "somebody can upload anything".
 *
 * Re-encoding makes the stored file safe, so the risk that remains is in the decoder that runs
 * first — and SVG is not a picture but an XML document, parsed by a library with its own
 * facilities for pulling in external files and expanding into far more memory than it occupies.
 */
test('only real raster images get past the ingest', async () => {
  const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#4c1d95' } }).png().toBuffer();
  const stored = await ingest(png);
  assert.equal(stored.width, 8);
  assert.ok(stored.data.subarray(8, 12).toString() === 'WEBP', 'stored as our own WebP, never the bytes we were given');
  assert.match(stored.sha256, /^[a-f\d]{64}$/);

  // Deterministic, because that is what makes it usable for recognising a duplicate.
  assert.equal((await ingest(png)).sha256, stored.sha256);

  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><script>alert(1)</script></svg>');
  await assert.rejects(() => ingest(svg), e => e.status === 400 && /JPG, PNG, or WebP/.test(e.message),
    'libvips will happily rasterise this; the risk is the parse, not the output');

  await assert.rejects(() => ingest(Buffer.from('GIF89a')), e => e.status === 400);
  await assert.rejects(() => ingest(Buffer.from('<!doctype html><html></html>')), e => e.status === 400);
  await assert.rejects(() => ingest(Buffer.alloc(0)), e => e.status === 400);

  /**
   * A polyglot: a valid PNG with a script appended. It decodes, so nothing refuses it — and it
   * does not need to be refused, because the trailing bytes are not pixels and never reach the
   * encoder. What comes out is a picture and nothing else.
   */
  const polyglot = Buffer.concat([png, Buffer.from('<script>alert(1)</script>')]);
  const cleaned = await ingest(polyglot);
  assert.ok(!cleaned.data.includes(Buffer.from('<script>')), 're-encoding drops everything that is not an image');
});
