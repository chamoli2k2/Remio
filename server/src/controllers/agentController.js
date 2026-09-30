import * as grants from '../services/agent/tokens.js';
import * as tools from '../services/agent/tools.js';
import * as oauth from '../services/agent/oauth.js';
import { AppError } from '../utils/errors.js';
import { SCOPES, MCP_PATH } from '../../../shared/agent.js';
import { hasPremium } from '../../../shared/account.js';
import { setting } from '../services/settingsService.js';
import { publicOrigin } from '../utils/origin.js';

/**
 * The browser's half of the assistant feature: managing connections, reviewing what they wrote,
 * and the approval screen an OAuth client sends the person to.
 *
 * All session-authenticated, all under /api, and none of it reachable with an assistant's own
 * token — which is the point. Disconnecting a compromised assistant, and undoing what it did, are
 * the two things that must not be doable by the assistant.
 */

/** An OAuth fault reaching a browser endpoint is just a bad request; the RFC's JSON shape is for clients. */
const asAppError = e => (e instanceof oauth.OAuthError ? new AppError(400, e.message, 'OAUTH_INVALID') : e);

/**
 * Everything the settings panel needs in one call: the connections, today's usage, the endpoint
 * to paste, and whether the feature is open to this account at all.
 *
 * One call rather than four because the panel cannot render any of it usefully in pieces, and a
 * settings page that fills in over three round trips looks broken.
 */
export const overview = async (req, res) => {
  const [list, usage] = await Promise.all([grants.listGrants(req.user), grants.usageToday(req.user.id)]);
  res.json({
    grants: list,
    usage,
    scopes: Object.entries(SCOPES).map(([id, s]) => ({ id, ...s })),
    endpoint: publicOrigin() + MCP_PATH,
    enabled: setting('agent.enabled'),
    entitled: hasPremium(req.user),
    maxGrants: setting('agent.grantsPerUser'),
  });
};

/** The one and only time the secret exists outside the caller's hands. */
export const createGrant = async (req, res) => {
  const { token, grant } = await grants.createPersonal(req.user, req.body);
  res.status(201).json({ token, grant });
};

export const revokeGrant = async (req, res) => res.json(await grants.revokeGrant(req.user, req.params.id));

export const revokeAllGrants = async (req, res) => { await grants.revokeAll(req.user.id); res.json({ ok: true }); };

export const batches = async (req, res) => res.json({ batches: await tools.listBatches(req.user, {}) });

export const undoBatch = async (req, res) => res.json(await tools.undoBatch(req.user, req.params.id));

/**
 * What the approval screen shows.
 *
 * Read-only and deliberately so: looking at a consent request must not create one. The page draws
 * itself from this, and nothing is granted until the person posts back.
 */
export const consentInfo = async (req, res) => {
  try {
    const described = await oauth.describeAuthorize(req.query);
    res.json({ ...described, entitled: hasPremium(req.user), enabled: setting('agent.enabled') });
  } catch (e) { throw asAppError(e); }
};

/**
 * The decision, and where to send the browser next.
 *
 * The redirect is returned rather than performed, because the caller is the app's own page and it
 * navigates itself. It is always a URI the client registered in advance — `describeAuthorize`
 * refuses anything else before either branch is reached — so neither answer here can be turned
 * into an open redirect.
 */
export const consent = async (req, res) => {
  const { approve, ...query } = req.body;
  try {
    res.json(approve ? await oauth.approve(req.user, query) : await oauth.deny(query));
  } catch (e) { throw asAppError(e); }
};
