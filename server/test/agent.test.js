import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { SCOPES, SCOPE_IDS, DEFAULT_SCOPES, TOOL_SCOPES, TOOL_NAMES, AGENT_LIMITS, parseScopes, scopeString, looksLikeToken, TOKEN_PREFIX, MCP_PATH } from '../../shared/agent.js';
import { validRedirect, authorizationServerMetadata, protectedResourceMetadata, challengeHeader } from '../src/services/agent/oauth.js';
import { agentCardSchema, agentCollectionSchema } from '../src/middleware/validate.js';
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
  const card = agentCardSchema.parse({ front: 'What is a mole?', back: '6.022e23 particles', tags: ['Chem', 'chem'], hint: 'Avogadro' });
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
  // No media id it did not upload, because it has no way to upload one.
  const card = agentCardSchema.parse({ front: 'Q', back: 'A', image: '507f1f77bcf86cd799439011' });
  assert.equal(card.front.image, undefined);
  assert.equal(card.back.image, undefined);

  // Publishing is a human decision; the field is not in the schema at all, so it is dropped here
  // as well as being forced in the service.
  const collection = agentCollectionSchema.parse({ title: 'Deck', visibility: 'global', owner: 'someone-else' });
  assert.equal(collection.visibility, undefined);
  assert.equal(collection.owner, undefined);
  assert.equal(collection.title, 'Deck');
});

test('a source that is not a URL is dropped rather than failing the whole batch', () => {
  assert.equal(agentCardSchema.parse({ front: 'Q', back: 'A', source: 'Chapter 4, page 112' }).source, '');
  assert.equal(agentCardSchema.parse({ front: 'Q', back: 'A', source: 'https://example.org/p' }).source, 'https://example.org/p');
  // The app's own rule, inherited: only http(s) ever reaches an href.
  assert.equal(agentCardSchema.parse({ front: 'Q', back: 'A', source: 'javascript:alert(1)' }).source, '');
});

test('the per-call ceiling is small enough to finish inside a client timeout', () => {
  assert.ok(AGENT_LIMITS.cardsPerCall <= 100, 'a call that cannot finish in time gets retried, not completed');
  assert.ok(AGENT_LIMITS.cardsPerCall >= 10, 'small enough to be useless is its own failure');
  assert.ok(AGENT_LIMITS.searchResults <= 50, 'a tool result is spent context');
});

test('the feature is switchable and bounded from the dashboard', () => {
  for (const key of ['agent.enabled', 'agent.cardsPerDay', 'agent.grantsPerUser', 'agent.tokenDays', 'throttle.agentPerMinute']) {
    assert.ok(SETTINGS[key], `${key} has to be an operator setting`);
  }
  assert.equal(SETTINGS['agent.enabled'].type, 'boolean');
  // A quota of zero would lock out every account with no way back other than a deploy.
  assert.ok(SETTINGS['agent.cardsPerDay'].min >= 1);
  assert.ok(SETTINGS['agent.grantsPerUser'].min >= 1);
});
