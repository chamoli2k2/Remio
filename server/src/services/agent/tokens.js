import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { AgentToken, AgentBatch, User } from '../../models/index.js';
import { hashToken } from '../../middleware/auth.js';
import { setting } from '../settingsService.js';
import { assert } from '../../utils/errors.js';
import { hasPremium } from '../../../../shared/account.js';
import { TOKEN_PREFIX, TOKEN_BYTES, looksLikeToken, scopeString, SCOPE_IDS } from '../../../../shared/agent.js';

/**
 * Minting, checking and revoking an assistant's permission to act for a user.
 *
 * Everything here is the same shape the session layer already uses — a random 32 bytes shown once
 * and stored as SHA-256 — for the plain reason that a second way of handling credentials is a
 * second way to get them wrong. What is new is that these live for months rather than a week, are
 * held by software rather than a browser, and carry scopes, so the extra machinery is all about
 * making a long-lived credential revocable and narrow rather than about the secret itself.
 */

const secret = () => TOKEN_PREFIX + crypto.randomBytes(TOKEN_BYTES).toString('hex');
const days = n => new Date(Date.now() + n * 86_400_000);

/** How long a newly issued or refreshed connection is good for, read at issue time so a change applies to the next one. */
const lifetime = () => days(setting('agent.tokenDays'));

/**
 * `lastUsedAt` is the one field a read path writes, and it is the difference between a settings
 * page that can say "last used an hour ago" and one that lists credentials nobody dares delete.
 * Updated at most once a minute, because the truth of it to the nearest minute is worth exactly
 * nothing and a write on every tool call is not.
 */
const TOUCH_AFTER_MS = 60_000;

/** The whole set of reasons a grant is not usable, in one place so no caller can check only some of them. */
function usable(grant) {
  if (!grant || grant.revokedAt) return false;
  return !(grant.accessExpiresAt && grant.accessExpiresAt.getTime() <= Date.now());
}

/**
 * Turn a bearer token into the user it speaks for.
 *
 * Returns null rather than throwing for anything that simply does not authenticate, so the caller
 * decides the shape of the refusal — MCP and REST word a 401 differently, and the OAuth spec is
 * particular about the header that has to come with one.
 *
 * The lookup is by hash, so a wrong token costs one index probe and reveals nothing by timing.
 */
export async function authenticate(raw) {
  if (!looksLikeToken(raw)) return null;
  const grant = await AgentToken.findOne({ accessHash: hashToken(raw) });
  if (!usable(grant)) return null;
  // `email` is `select: false` on the schema and nothing here needs it; the rest of the document
  // is what the permission checks and the presenter read.
  const user = await User.findById(grant.user);
  if (!user) return null;

  if (!grant.lastUsedAt || Date.now() - grant.lastUsedAt.getTime() > TOUCH_AFTER_MS) {
    // Deliberately not awaited into the request's critical path, and deliberately swallowed: a
    // failure to record when a token was last seen must never fail the call it was recording.
    AgentToken.updateOne({ _id: grant._id }, { $set: { lastUsedAt: new Date() } }).catch(() => {});
  }
  return { user, grant };
}

/** Whether this grant carries a permission, checked against the catalogue so a stored typo grants nothing. */
export const allows = (grant, scope) => SCOPE_IDS.includes(scope) && (grant?.scopes || []).includes(scope);

export function requireScope(grant, scope) {
  assert(allows(grant, scope), 403,
    `This assistant was not given permission to ${scope === 'cards:write' ? 'add cards' : scope === 'collections:write' ? 'create collections' : 'read your collections'}. Reconnect it from Settings to change that.`,
    'SCOPE_REQUIRED');
}

/**
 * The gate every assistant path runs through, before scopes and before any work.
 *
 * Three separate refusals rather than one, because they need three different answers from the
 * person reading them: an operator has closed the feature, this account cannot use it, or this
 * account has used it up for today.
 */
export function requireAgentsEnabled() {
  assert(setting('agent.enabled'), 503,
    'Assistant connections are switched off for the moment. Nothing you have written is affected.', 'AGENTS_OFF');
}

export function requireAgentEntitlement(user) {
  assert(hasPremium(user), 402,
    'Connecting an assistant is a Premium feature. Upgrade to continue.', 'PREMIUM_REQUIRED');
}

/**
 * How many cards this account's assistants have written since midnight, and how many they may.
 *
 * Counted from the batches rather than from a counter, so it cannot drift, and so undoing a batch
 * gives the allowance back — which is the behaviour a person expects after an assistant produces
 * fifty cards of rubbish and they throw them away.
 *
 * Midnight is UTC. A local-time reset would need the account's timezone, which is not recorded,
 * and guessing it from a country would move the boundary under anyone who travels.
 */
export async function usageToday(userId) {
  const since = new Date(); since.setUTCHours(0, 0, 0, 0);
  const [row] = await AgentBatch.aggregate([
    { $match: { user: new mongoose.Types.ObjectId(String(userId)), createdAt: { $gte: since }, undoneAt: null } },
    { $group: { _id: null, cards: { $sum: '$cardCount' }, images: { $sum: '$imageCount' } } },
  ]);
  const limit = setting('agent.cardsPerDay');
  const imageLimit = setting('agent.imagesPerDay');
  const used = row?.cards || 0;
  const imagesUsed = row?.images || 0;
  return {
    used, limit, left: Math.max(0, limit - used),
    images: { used: imagesUsed, limit: imageLimit, left: Math.max(0, imageLimit - imagesUsed) },
  };
}

export async function requireQuota(userId, wanted) {
  const { used, limit, left } = await usageToday(userId);
  assert(left >= wanted, 429,
    `That would take today's assistant total past ${limit} cards — ${used} have been added already. The allowance resets at midnight UTC, and undoing a batch gives it back straight away.`,
    'AGENT_QUOTA');
}

/**
 * The same for images, checked before anything is fetched rather than after.
 *
 * What it charges is what was *stored*, so a picture the collection already had is free and a
 * URL that turned out not to be an image costs nothing against tomorrow's total. That is the
 * right behaviour for an honest caller and it does leave a gap: a model whose every URL fails
 * pays nothing and could keep trying. The bound on that case is the per-minute rate limit and
 * the small per-call ceiling rather than this, because a failed fetch costs no storage — it is
 * a bandwidth question, not a bucket one, and the two want different instruments.
 */
export async function requireImageQuota(userId, wanted) {
  if (!wanted) return;
  const { images } = await usageToday(userId);
  assert(images.limit > 0, 403,
    'Fetching images is switched off for assistants at the moment.', 'AGENT_IMAGES_OFF');
  assert(images.left >= wanted, 429,
    `That would take today's assistant total past ${images.limit} images — ${images.used} have been fetched already. The allowance resets at midnight UTC, and undoing a batch gives it back straight away.`,
    'AGENT_IMAGE_QUOTA');
}

/** A grant as the settings page shows it. Never includes a secret; there is nothing here to leak. */
export const presentGrant = grant => ({
  id: grant.id,
  name: grant.name,
  scopes: grant.scopes,
  createdVia: grant.createdVia,
  client: grant.client,
  createdAt: grant.createdAt,
  lastUsedAt: grant.lastUsedAt,
  expiresAt: grant.accessExpiresAt,
  expired: !usable(grant),
});

export async function listGrants(user) {
  const grants = await AgentToken.find({ user: user.id, revokedAt: null }).sort({ createdAt: -1 });
  return grants.map(presentGrant);
}

/** Held to a ceiling because each one is a standing key to the account, and a list nobody prunes is a list nobody reads. */
async function assertRoom(user) {
  const count = await AgentToken.countDocuments({ user: user.id, revokedAt: null });
  assert(count < setting('agent.grantsPerUser'), 409,
    'You have connected as many assistants as an account may have at once. Disconnect one you no longer use first.', 'AGENT_LIMIT');
}

/**
 * A token the user copies into their own client configuration.
 *
 * The secret is returned here and never again — not stored in plain anywhere, not recoverable, not
 * emailed. If they lose it they make another, which is a smaller inconvenience than a credential
 * that can be read back out of a borrowed session.
 */
export async function createPersonal(user, { name, scopes }) {
  requireAgentsEnabled();
  requireAgentEntitlement(user);
  await assertRoom(user);
  const token = secret();
  const grant = await AgentToken.create({
    user: user.id,
    name: String(name || '').trim().slice(0, 60) || 'Assistant',
    scopes,
    accessHash: hashToken(token),
    accessExpiresAt: lifetime(),
    createdVia: 'personal',
  });
  return { token, grant: presentGrant(grant) };
}

/**
 * Revocation is a tombstone rather than a delete.
 *
 * The secrets are cleared so the row can never authenticate again and so their unique indexes are
 * freed, but the row itself stays: the batches an assistant wrote point at it, and a review screen
 * that says "added by a connection that no longer exists" is no use to anyone trying to work out
 * where forty strange cards came from.
 */
export async function revokeGrant(user, id) {
  assert(mongoose.isValidObjectId(id), 404, 'That connection was not found.');
  const grant = await AgentToken.findOneAndUpdate(
    { _id: id, user: user.id, revokedAt: null },
    { $set: { revokedAt: new Date() }, $unset: { accessHash: '', refreshHash: '' } },
    { new: true },
  );
  assert(grant, 404, 'That connection was not found, or it had already been disconnected.');
  return presentGrant(grant);
}

/**
 * Cut every connection at once, for the settings page button and for account deletion.
 *
 * Takes an id rather than a user, and deliberately does not accept either: `ObjectId` has its own
 * `.id` property holding the raw twelve bytes, so the usual `user.id ?? user` shorthand silently
 * produces a Buffer and matches nothing. One parameter, one meaning.
 */
export const revokeAll = userId => AgentToken.updateMany(
  { user: userId, revokedAt: null },
  { $set: { revokedAt: new Date() }, $unset: { accessHash: '', refreshHash: '' } },
);

/**
 * Issue the pair an OAuth client gets after the user approves it.
 *
 * Both halves are rotated together on refresh, which OAuth 2.1 asks for on public clients: a
 * refresh token that never changes is a permanent credential sitting in a config file, and
 * rotating it means a stolen one stops working as soon as the real client uses its own.
 */
export async function issueForClient({ userId, clientId, clientName, scopes }) {
  const access = secret(), refresh = secret();
  const grant = await AgentToken.create({
    user: userId,
    name: String(clientName || '').trim().slice(0, 60) || 'Connected assistant',
    scopes,
    accessHash: hashToken(access),
    accessExpiresAt: lifetime(),
    refreshHash: hashToken(refresh),
    client: clientId,
    createdVia: 'oauth',
  });
  return { access, refresh, grant, expiresIn: Math.floor((grant.accessExpiresAt - Date.now()) / 1000) };
}

/**
 * Exchange a refresh token for a fresh pair.
 *
 * The rotation is a single conditional update matched on the old hash, so two clients racing with
 * the same refresh token cannot both come away with a working credential: whichever update matches
 * first moves the hash, and the second matches nothing.
 */
export async function refreshForClient(raw, clientId) {
  if (!looksLikeToken(raw)) return null;
  const access = secret(), refresh = secret();
  const grant = await AgentToken.findOneAndUpdate(
    { refreshHash: hashToken(raw), client: clientId, revokedAt: null },
    { $set: { accessHash: hashToken(access), accessExpiresAt: lifetime(), refreshHash: hashToken(refresh) } },
    { new: true },
  );
  if (!grant) return null;
  return { access, refresh, grant, expiresIn: Math.floor((grant.accessExpiresAt - Date.now()) / 1000) };
}

export const grantScopeString = grant => scopeString(grant.scopes || []);
