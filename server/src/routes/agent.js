import { Router } from 'express';
import express from 'express';
import cors from 'cors';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { buildServer } from '../mcp/server.js';
import { authenticate, requireAgentsEnabled, requireAgentEntitlement } from '../services/agent/tokens.js';
import * as oauth from '../services/agent/oauth.js';
import { throttle } from '../middleware/throttle.js';
import { setting } from '../services/settingsService.js';
import { asyncHandler, toAppError, GENERIC } from '../utils/errors.js';
import { MCP_PATH } from '../../../shared/agent.js';
import { logger } from '../utils/logger.js';

/**
 * Everything an AI assistant talks to, mounted outside /api.
 *
 * Outside because none of it is the browser API: these are the paths the MCP specification and
 * the OAuth RFCs put at fixed, unprefixed locations, and a client that cannot find
 * `/.well-known/oauth-protected-resource` where the spec says it lives simply will not connect.
 *
 * The important consequence of that separation is which protections apply. The /api routes are
 * defended against cross-site requests because they are authenticated by a cookie, which a
 * browser attaches whether or not the page asking for it is ours. Nothing here reads a cookie —
 * only a bearer token, which no browser sends on its own — so there is no ambient authority to
 * abuse, and the cross-origin rules can be open without opening anything.
 */

const router = Router();

/**
 * Open to any origin, for exactly the reason above: no cookies, therefore no CSRF, therefore
 * nothing gained by restricting it and a browser-based client like the MCP Inspector blocked if we
 * do. `WWW-Authenticate` has to be readable by the caller or the discovery step cannot happen.
 */
const open = cors({
  origin: '*',
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'mcp-session-id', 'mcp-protocol-version'],
  exposedHeaders: ['WWW-Authenticate', 'mcp-session-id'],
});

const json = express.json({ limit: '1mb' });

/** Discovery. Cached briefly: clients fetch these on every reconnection and the contents change on deploy. */
const document = body => (_req, res) => res.set('Cache-Control', 'public, max-age=300').json(body());

// Clients probe both the bare path and the one suffixed with the resource path, in that order or
// the reverse depending on the client. Serving both is two lines and saves a support thread.
for (const path of ['/.well-known/oauth-protected-resource', `/.well-known/oauth-protected-resource${MCP_PATH}`]) {
  router.options(path, open); router.get(path, open, document(oauth.protectedResourceMetadata));
}
for (const path of ['/.well-known/oauth-authorization-server', `/.well-known/oauth-authorization-server${MCP_PATH}`]) {
  router.options(path, open); router.get(path, open, document(oauth.authorizationServerMetadata));
}

/** OAuth faults have their own JSON shape, and clients branch on the `error` field rather than the status. */
const oauthFail = (res, error) => {
  if (error instanceof oauth.OAuthError) return res.status(error.status).json(error.body);
  const app = toAppError(error);
  if (app.status >= 500) logger.error({ err: app }, 'oauth endpoint failed');
  return res.status(app.status).json({ error: 'server_error', error_description: app.expose ? app.message : GENERIC });
};

/**
 * Registration is open to anyone, which the specification requires and which is what lets a user
 * paste one URL and be finished. Throttled hard because "anyone may create a row" is otherwise a
 * standing invitation, and reusing the sign-in limiter's budget is right: both are unauthenticated
 * endpoints that mint something.
 */
router.options('/oauth/register', open);
router.post('/oauth/register', open, json,
  throttle({ windowMs: 15 * 60_000, limit: () => setting('throttle.authPer15Min') }),
  asyncHandler(async (req, res) => {
    try { res.status(201).json(await oauth.register(req.body || {})); }
    catch (e) { oauthFail(res, e); }
  }));

router.options('/oauth/token', open);
router.post('/oauth/token', open, express.urlencoded({ extended: false, limit: '64kb' }), json,
  throttle({ windowMs: 60_000, limit: () => setting('throttle.authPer15Min') }),
  asyncHandler(async (req, res) => {
    try {
      // A token must never be cached by anything, including a proxy that saw the same request body.
      res.set('Cache-Control', 'no-store').set('Pragma', 'no-cache');
      res.json(await oauth.exchange(req.body || {}, req.headers.authorization));
    } catch (e) { oauthFail(res, e); }
  }));

router.options('/oauth/revoke', open);
router.post('/oauth/revoke', open, express.urlencoded({ extended: false, limit: '64kb' }), json,
  asyncHandler(async (req, res) => { await oauth.revoke(req.body || {}, req.headers.authorization); res.status(200).json({}); }));

/**
 * A refusal that tells the client where to go and get a token.
 *
 * The `WWW-Authenticate` header is the whole discovery mechanism: without it an assistant reports
 * that the server said no, and with it the assistant walks the metadata, registers itself and
 * opens the approval screen. The body is JSON-RPC shaped because a client that got this far is
 * speaking JSON-RPC and will try to parse whatever comes back.
 */
const unauthorized = (res, message) => res.status(401)
  .set('WWW-Authenticate', oauth.challengeHeader())
  .json({ jsonrpc: '2.0', id: null, error: { code: -32001, message } });

/** Bearer only. A cookie is deliberately not accepted here — see the note at the top of the file. */
const bearerAuth = asyncHandler(async (req, res, next) => {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) return unauthorized(res, 'Connect this assistant to your account first.');
  const auth = await authenticate(header.slice(7).trim());
  if (!auth) return unauthorized(res, 'That connection is no longer valid. Reconnect it from your account settings.');
  req.agent = auth;
  next();
});

/**
 * The two gates, applied after authentication so the answer can name the account's situation.
 *
 * Re-checked on every call rather than only when the connection was made, because both can change
 * underneath a connection that already exists: Premium lapses, and an operator can close the
 * feature. A token is permission to act, not a receipt for having been allowed to once.
 */
const agentGates = (req, res, next) => {
  try { requireAgentsEnabled(); requireAgentEntitlement(req.agent.user); next(); }
  catch (e) {
    const app = toAppError(e);
    res.status(app.status).json({ jsonrpc: '2.0', id: null, error: { code: -32002, message: app.message, data: { code: app.code } } });
  }
};

/** Per connection rather than per IP: a school behind one address should not throttle itself. */
const agentThrottle = throttle({
  windowMs: 60_000,
  limit: () => setting('throttle.agentPerMinute'),
  keyGenerator: req => String(req.agent?.grant?._id || 'anonymous'),
});

/**
 * One server and one transport per request, torn down when the response closes.
 *
 * Stateless — no session id, no history held between calls — because the alternative is a map of
 * live sessions keyed by a header, which on a single small instance is memory that only grows and
 * which would have to be reasoned about every time two users connect at once. The cost is that
 * server-initiated notifications are unavailable, and this server has none to send.
 */
const handleMcp = asyncHandler(async (req, res) => {
  const server = buildServer(req.agent);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on('close', () => { transport.close().catch(() => {}); server.close().catch(() => {}); });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

router.options(MCP_PATH, open);
router.post(MCP_PATH, open, json, bearerAuth, agentGates, agentThrottle, handleMcp);
// GET opens the notification stream and DELETE ends a session. Neither exists in stateless mode,
// and the transport answers both correctly, so they are routed rather than left to the catch-all —
// which would otherwise hand an assistant the HTML of the app.
router.get(MCP_PATH, open, bearerAuth, agentGates, handleMcp);
router.delete(MCP_PATH, open, bearerAuth, agentGates, handleMcp);

export default router;
