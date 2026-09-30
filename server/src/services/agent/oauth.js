import crypto from 'node:crypto';
import { AgentToken, OAuthClient, OAuthGrant } from '../../models/index.js';
import { hashToken } from '../../middleware/auth.js';
import { publicOrigin } from '../../utils/origin.js';
import { SCOPE_IDS, SCOPES, parseScopes, scopeString, MCP_PATH } from '../../../../shared/agent.js';
import { issueForClient, refreshForClient, requireAgentsEnabled, requireAgentEntitlement } from './tokens.js';

/**
 * OAuth 2.1 for assistants, with dynamic client registration.
 *
 * The reason this exists rather than a pasted API key is not elegance. ChatGPT's connectors refuse
 * a bearer token outright and require the full flow with RFC 7591 registration, and Claude's web
 * connectors expect the same discovery documents. Supporting both hosted assistants means
 * supporting this, so the choice was to build it or to be desktop-only.
 *
 * What falls out of it is worth having anyway: nobody copies a secret into a config file, the
 * approval is a screen that names what is being granted, and revoking is a row in a list rather
 * than a hunt for where the key was pasted.
 *
 * Three rules hold the security of the flow, and all three are load-bearing:
 *
 *  - PKCE with S256 is required, never `plain`, and never absent. Every client here is a public
 *    client that cannot keep a secret, so the proof-of-possession is the only thing tying the code
 *    to whoever asked for it.
 *  - Redirect URIs match exactly, by string equality, against what was registered. No prefix
 *    matching, no subdomain wildcards — those are how authorization codes end up somewhere else.
 *  - Anyone may register a client, so a client record is an untrusted claim. The name is shown to
 *    the user as something an application calls itself, and the consent screen prints the redirect
 *    host, because that is the fact that actually matters and the only one we can vouch for.
 */

const CODE_TTL_MS = 5 * 60_000;

/** OAuth has its own error shape, and clients parse it. A thrown AppError would come out as the wrong JSON. */
export class OAuthError extends Error {
  constructor(error, description, status = 400) {
    super(description || error);
    this.name = 'OAuthError'; this.error = error; this.status = status;
  }
  get body() { return { error: this.error, error_description: this.message }; }
}

export const base = () => publicOrigin();
export const resourceUrl = () => base() + MCP_PATH;

/** RFC 8414. Where the endpoints are and what this server will agree to. */
export const authorizationServerMetadata = () => ({
  issuer: base(),
  authorization_endpoint: `${base()}/oauth/authorize`,
  token_endpoint: `${base()}/oauth/token`,
  registration_endpoint: `${base()}/oauth/register`,
  revocation_endpoint: `${base()}/oauth/revoke`,
  scopes_supported: SCOPE_IDS,
  response_types_supported: ['code'],
  grant_types_supported: ['authorization_code', 'refresh_token'],
  // S256 only. Advertising `plain` would let a client choose it, and a downgrade a client can pick
  // is a downgrade an attacker can pick.
  code_challenge_methods_supported: ['S256'],
  token_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
  service_documentation: `${base()}/settings`,
});

/** RFC 9728. What the MCP endpoint is, and who issues tokens for it. */
export const protectedResourceMetadata = () => ({
  resource: resourceUrl(),
  authorization_servers: [base()],
  scopes_supported: SCOPE_IDS,
  bearer_methods_supported: ['header'],
  resource_documentation: `${base()}/settings`,
});

/**
 * The header that turns a 401 into a discovery step.
 *
 * Without it a client has no way to learn where to authenticate and simply reports that the
 * server rejected it. With it, pasting the URL into an assistant is enough.
 */
export const challengeHeader = () =>
  `Bearer resource_metadata="${base()}/.well-known/oauth-protected-resource", error="invalid_token"`;

/**
 * Somewhere an authorization code may legitimately be sent.
 *
 * HTTPS, or the loopback interface over plain HTTP — the latter because RFC 8252 is how a desktop
 * assistant receives a code, listening on a port it picked at startup. Everything else is refused,
 * including custom schemes: they are claimed on a first-come basis by any application on the
 * machine, so a code sent to one is a code sent to whoever registered the scheme first.
 *
 * A fragment is refused because the authorization response appends its own query, and a URI
 * carrying a fragment would either lose it or mangle the response.
 */
export function validRedirect(uri) {
  if (typeof uri !== 'string' || uri.length > 2000) return false;
  let u; try { u = new URL(uri); } catch { return false; }
  if (u.hash) return false;
  if (u.protocol === 'https:') return true;
  return u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
}

/** RFC 7591. Anyone may call this, which is the point and also why every field is bounded. */
export async function register(body) {
  const uris = Array.isArray(body?.redirect_uris) ? body.redirect_uris : [];
  if (!uris.length) throw new OAuthError('invalid_client_metadata', 'redirect_uris is required.');
  if (uris.length > 10) throw new OAuthError('invalid_client_metadata', 'Register at most ten redirect URIs.');
  const bad = uris.find(u => !validRedirect(u));
  if (bad) throw new OAuthError('invalid_redirect_uri', `${String(bad).slice(0, 120)} is not an https URL or a loopback address.`);

  const method = ['client_secret_post', 'client_secret_basic'].includes(body?.token_endpoint_auth_method)
    ? body.token_endpoint_auth_method : 'none';
  const secret = method === 'none' ? null : `cs_${crypto.randomBytes(32).toString('hex')}`;
  const clientId = crypto.randomBytes(16).toString('hex');

  await OAuthClient.create({
    clientId,
    secretHash: secret ? hashToken(secret) : undefined,
    // Truncated and otherwise untouched. It is displayed to a human on the approval screen and is
    // never compared against anything, so the only real risk it carries is length.
    name: String(body?.client_name || '').trim().slice(0, 80),
    uri: String(body?.client_uri || '').trim().slice(0, 200),
    redirectUris: uris,
  });

  return {
    client_id: clientId,
    ...(secret ? { client_secret: secret } : {}),
    client_id_issued_at: Math.floor(Date.now() / 1000),
    redirect_uris: uris,
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: method,
  };
}

/**
 * Check an authorization request and describe it for the approval screen.
 *
 * The order matters. Anything wrong with the client id or the redirect URI is reported here and
 * never redirected anywhere, because redirecting an error to an address we have not verified is
 * how an open redirect is built. Only once the destination is known to be registered is it safe
 * for the rest of the flow to send anything to it.
 */
export async function describeAuthorize(query) {
  const clientId = String(query.client_id || '');
  const redirectUri = String(query.redirect_uri || '');
  const client = clientId ? await OAuthClient.findOne({ clientId }) : null;
  if (!client) throw new OAuthError('invalid_client', 'That application is not registered with us.');
  if (!client.redirectUris.includes(redirectUri)) {
    throw new OAuthError('invalid_request', 'That application asked us to send the result somewhere it has not registered.');
  }

  // From here on the redirect is trusted, so these are faults the client can be told about.
  if (query.response_type !== 'code') throw new OAuthError('unsupported_response_type', 'Only the authorization code flow is supported.');
  if (query.code_challenge_method !== 'S256') throw new OAuthError('invalid_request', 'PKCE with S256 is required.');
  const challenge = String(query.code_challenge || '');
  if (!/^[A-Za-z0-9\-._~]{43,128}$/.test(challenge)) throw new OAuthError('invalid_request', 'The PKCE challenge is missing or malformed.');

  // RFC 8707. A code minted for this server must not be redeemable at another, so if the client
  // names a resource it has to be ours.
  const resource = String(query.resource || '');
  if (resource && resource.replace(/\/+$/, '') !== resourceUrl()) {
    throw new OAuthError('invalid_target', 'That token was requested for a different service.');
  }

  const scopes = parseScopes(query.scope);
  if (!scopes.length) throw new OAuthError('invalid_scope', 'None of the requested permissions exist here.');

  let host = ''; try { host = new URL(redirectUri).host; } catch { /* validated above */ }
  return {
    client: { id: client.clientId, name: client.name, uri: client.uri, redirectHost: host },
    request: { redirectUri, codeChallenge: challenge, resource, state: String(query.state || '') },
    scopes: scopes.map(id => ({ id, ...SCOPES[id] })),
  };
}

/**
 * The user said yes. Mint a single-use code and say where to send the browser.
 *
 * Both gates are re-checked here rather than only on the approval screen, because the screen is a
 * suggestion and this is the door: a request replayed after Premium lapsed, or after an operator
 * closed the feature, has to fail even though the page that produced it looked fine.
 */
export async function approve(user, query) {
  requireAgentsEnabled();
  requireAgentEntitlement(user);
  const { client, request, scopes } = await describeAuthorize(query);

  const code = crypto.randomBytes(32).toString('hex');
  await OAuthGrant.create({
    codeHash: hashToken(code),
    clientId: client.id,
    user: user.id,
    redirectUri: request.redirectUri,
    codeChallenge: request.codeChallenge,
    scopes: scopes.map(s => s.id),
    resource: request.resource,
    expiresAt: new Date(Date.now() + CODE_TTL_MS),
  });

  const url = new URL(request.redirectUri);
  url.searchParams.set('code', code);
  if (request.state) url.searchParams.set('state', request.state);
  return { redirect: url.toString() };
}

/** Told no, or closed the tab. The client is informed through its own redirect so it can stop waiting. */
export async function deny(query) {
  const { request } = await describeAuthorize(query);
  const url = new URL(request.redirectUri);
  url.searchParams.set('error', 'access_denied');
  url.searchParams.set('error_description', 'The account holder declined.');
  if (request.state) url.searchParams.set('state', request.state);
  return { redirect: url.toString() };
}

/** Client authentication, for the clients that have a secret. Public ones prove themselves with PKCE instead. */
async function authenticateClient(body, header) {
  let id = String(body.client_id || ''), secret = String(body.client_secret || '');
  if (header?.startsWith('Basic ')) {
    const [u, p] = Buffer.from(header.slice(6), 'base64').toString('utf8').split(':');
    id = decodeURIComponent(u || ''); secret = decodeURIComponent(p || '');
  }
  const client = id ? await OAuthClient.findOne({ clientId: id }) : null;
  if (!client) throw new OAuthError('invalid_client', 'Unknown client.', 401);
  if (client.secretHash) {
    // Constant time, because a secret compared with `===` leaks its prefix to anyone willing to
    // time the difference. Both sides are fixed-length hashes, so the lengths always match.
    const given = hashToken(secret);
    if (!secret || !crypto.timingSafeEqual(Buffer.from(given), Buffer.from(client.secretHash))) {
      throw new OAuthError('invalid_client', 'Client authentication failed.', 401);
    }
  }
  return client;
}

const pkceMatches = (verifier, challenge) =>
  crypto.createHash('sha256').update(String(verifier)).digest('base64url') === challenge;

/** The token endpoint. Both grant types, and the only place a usable credential is handed out. */
export async function exchange(body, authHeader) {
  requireAgentsEnabled();
  const client = await authenticateClient(body, authHeader);
  const type = String(body.grant_type || '');

  if (type === 'refresh_token') {
    const rotated = await refreshForClient(body.refresh_token, client.clientId);
    if (!rotated) throw new OAuthError('invalid_grant', 'That refresh token is no longer valid. Reconnect from Settings.');
    return {
      access_token: rotated.access, refresh_token: rotated.refresh,
      token_type: 'Bearer', expires_in: rotated.expiresIn, scope: scopeString(rotated.grant.scopes),
    };
  }

  if (type !== 'authorization_code') throw new OAuthError('unsupported_grant_type', 'Use authorization_code or refresh_token.');

  const verifier = String(body.code_verifier || '');
  if (!/^[A-Za-z0-9\-._~]{43,128}$/.test(verifier)) throw new OAuthError('invalid_request', 'A PKCE code_verifier is required.');

  /**
   * Redeemed by marking it used in the same update that finds it.
   *
   * `usedAt: null` in the filter is what makes a code single-use under concurrency: two requests
   * arriving together both match the hash, but only one update matches the null, and the loser
   * gets nothing back. Checked before the verifier, so a replay fails identically whether or not
   * the attacker also has the verifier.
   */
  const grant = await OAuthGrant.findOneAndUpdate(
    { codeHash: hashToken(body.code || ''), usedAt: null },
    { $set: { usedAt: new Date() } },
  );
  if (!grant) throw new OAuthError('invalid_grant', 'That authorization code is not valid, or it has already been used.');
  if (grant.expiresAt.getTime() <= Date.now()) throw new OAuthError('invalid_grant', 'That authorization code has expired.');
  if (grant.clientId !== client.clientId) throw new OAuthError('invalid_grant', 'That code was issued to a different application.');
  // The code was bound to one destination at authorization time; a different one now means the
  // code has been carried somewhere it was not meant to go.
  if (String(body.redirect_uri || '') !== grant.redirectUri) throw new OAuthError('invalid_grant', 'The redirect URI does not match the one the code was issued for.');
  if (!pkceMatches(verifier, grant.codeChallenge)) throw new OAuthError('invalid_grant', 'The PKCE verifier does not match.');

  const issued = await issueForClient({
    userId: grant.user, clientId: client.clientId, clientName: client.name, scopes: grant.scopes,
  });
  return {
    access_token: issued.access, refresh_token: issued.refresh,
    token_type: 'Bearer', expires_in: issued.expiresIn, scope: scopeString(grant.scopes),
  };
}

/**
 * RFC 7009. A client saying it is finished with a token.
 *
 * Always answers 200, whatever happened. The spec asks for that, and it is right: a revocation
 * endpoint that distinguishes "revoked it" from "no such token" is a free oracle for testing
 * stolen credentials.
 */
export async function revoke(body, authHeader) {
  const client = await authenticateClient(body, authHeader).catch(() => null);
  const raw = String(body.token || '');
  if (!client || !raw) return;
  await AgentToken.updateOne(
    { client: client.clientId, revokedAt: null, $or: [{ accessHash: hashToken(raw) }, { refreshHash: hashToken(raw) }] },
    { $set: { revokedAt: new Date() }, $unset: { accessHash: '', refreshHash: '' } },
  );
}
