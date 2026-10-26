import crypto from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { RefreshToken, User } from '../../models/index.js';
import { hashToken } from '../../utils/hash.js';
import { logger } from '../../utils/logger.js';
import { BRAND } from '../../../../shared/brand.js';

/**
 * Sign-in as a pair of tokens.
 *
 * The access token is a JWT signed with HS256 that lives for fifteen minutes. It names the user and
 * carries what the route gates decide on: the account role, when Premium ends, whether the address
 * is confirmed, and `ver`, the user's token version. The refresh token is an opaque random string,
 * stored hashed, that lives for thirty days and is exchanged for a new pair every time it is used.
 *
 * Two things keep a signed token from outliving the facts it states. Every request still loads the
 * user, and a token whose `ver` is behind the user's is treated as signed out: bumping the version
 * is how a password change or reset ends every other device at once. And a token whose role,
 * Premium end, or verification differs from the database is never used to decide anything: a
 * browser's cookie is re-signed on the spot, and a native app is told TOKEN_EXPIRED so it refreshes.
 * Neither depends on finding every place in the code that changes a role.
 *
 * Refresh tokens rotate, and a row remembers the last few it handed out. Presenting one of those
 * again means two parties hold the same device's credential, so that device is signed out, except
 * within a few seconds of the rotation, where it is far more likely two tabs refreshed at once.
 */
export const ACCESS_TTL_S = 15 * 60;
export const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const REUSE_GRACE_MS = 30_000;
const KEEP_PREVIOUS = 5;
const ISSUER = BRAND.slug;
const AUDIENCE = `${BRAND.slug}-api`;

let cached = { from: null, key: null };
function signingKey() {
  const configured = process.env.JWT_SECRET || '';
  if (cached.key && cached.from === configured) return cached.key;
  if (configured && configured.length < 32) throw new Error('JWT_SECRET must be at least 32 characters.');
  if (!configured && process.env.NODE_ENV === 'production') throw new Error('JWT_SECRET is not set. Generate one with `openssl rand -hex 32`.');
  // Outside production a per-process key is enough: a restart only expires access tokens, and the
  // client renews them from the refresh token, which does not depend on this key.
  cached = { from: configured, key: configured ? new TextEncoder().encode(configured) : crypto.randomBytes(32) };
  return cached.key;
}
/** Fails at boot rather than at the first sign-in. */
export const assertJwtConfigured = () => { signingKey(); };

const claimsFor = user => ({
  ver: user.tokenVersion || 0,
  acct: user.account || 'normal',
  pexp: user.premiumExpiresAt ? Math.floor(new Date(user.premiumExpiresAt).getTime() / 1000) : 0,
  ev: user.emailVerifiedAt ? 1 : 0,
});
const sameClaims = (a, b) => a.ver === b.ver && a.acct === b.acct && a.pexp === b.pexp && a.ev === b.ev;

/** The shape `shared/account.js` reads roles from, rebuilt from a verified token's claims. */
export const principalOf = claims => ({ account: claims.acct, premiumExpiresAt: claims.pexp ? new Date(claims.pexp * 1000) : null });

/** A signed access token for `user` (loaded with `+tokenVersion`), and the claims it carries. */
export async function signAccess(user) {
  const expiresAt = new Date(Date.now() + ACCESS_TTL_S * 1000);
  const claims = { ...claimsFor(user), sub: String(user.id), exp: Math.floor(expiresAt.getTime() / 1000) };
  const token = await new SignJWT(claimsFor(user))
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(claims.sub).setIssuer(ISSUER).setAudience(AUDIENCE)
    .setIssuedAt().setExpirationTime(claims.exp)
    .sign(signingKey());
  return { token, expiresAt, claims };
}

/**
 * What a presented access token means.
 *
 * `{ user, claims }` when it is good. `stale: true` alongside them when it is genuine and current
 * but its role, Premium end, or verification has since changed, so it must be replaced before its
 * claims decide anything. `{ expired: true }` when the client should refresh and retry, which
 * covers a bad signature too, since a rotated key looks exactly like that. `{ revoked: true }` when
 * the account is gone or has moved on to a newer token version.
 */
export async function resolveAccess(token) {
  let claims;
  try { ({ payload: claims } = await jwtVerify(token, signingKey(), { algorithms: ['HS256'], issuer: ISSUER, audience: AUDIENCE })); }
  catch { return { expired: true }; }
  const user = await User.findById(claims.sub).select('+tokenVersion').catch(() => null);
  if (!user || (user.tokenVersion || 0) !== claims.ver) return { revoked: true };
  return { user, claims, stale: !sameClaims(claims, claimsFor(user)) };
}

/** A new access token, and a new device row unless the caller is only renewing access. */
export async function issueTokens(userId, { withRefresh = true } = {}) {
  const user = await User.findById(userId).select('+tokenVersion');
  if (!user) return null;
  const access = await signAccess(user);
  let refreshToken = null;
  if (withRefresh) {
    refreshToken = crypto.randomBytes(32).toString('hex');
    await RefreshToken.create({ tokenHash: hashToken(refreshToken), user: user.id, expiresAt: new Date(Date.now() + REFRESH_TTL_MS) });
  }
  return { user, access, refreshToken };
}

/**
 * Trades a refresh token for a new pair, or returns null if it buys nothing.
 *
 * The swap is one conditional update, so two requests racing with the same token cannot both
 * rotate it: the loser finds its token among the previous hashes and, inside the grace window,
 * gets a new access token without a new refresh token.
 */
export async function rotateRefresh(raw) {
  const now = new Date();
  const hash = hashToken(raw);
  const next = crypto.randomBytes(32).toString('hex');
  const row = await RefreshToken.findOneAndUpdate(
    { tokenHash: hash, expiresAt: { $gt: now } },
    { $set: { tokenHash: hashToken(next), rotatedAt: now, expiresAt: new Date(now.getTime() + REFRESH_TTL_MS) }, $push: { previousHashes: { $each: [hash], $position: 0, $slice: KEEP_PREVIOUS } } },
    { new: true },
  );
  if (row) return issueTokens(row.user, { withRefresh: false }).then(t => t && { ...t, refreshToken: next });

  const owner = await RefreshToken.findOne({ previousHashes: hash });
  if (!owner) return null;
  if (owner.previousHashes[0] === hash && now - owner.rotatedAt < REUSE_GRACE_MS) return issueTokens(owner.user, { withRefresh: false });
  await RefreshToken.deleteOne({ _id: owner._id });
  logger.warn('a rotated refresh token was replayed, so that device was signed out', { user: String(owner.user) });
  return null;
}

/** Signs out the one device that holds this refresh token. */
export async function revokeRefresh(raw) {
  if (!raw) return;
  const hash = hashToken(raw);
  await RefreshToken.deleteOne({ $or: [{ tokenHash: hash }, { previousHashes: hash }] });
}

/**
 * Signs out every device, optionally keeping the one holding `keep`, and returns how many went.
 * The version bump is what ends their access tokens too, rather than leaving them fifteen minutes.
 */
export async function revokeAllTokens(userId, { keep } = {}) {
  const keepHash = keep ? hashToken(keep) : null;
  const { deletedCount } = await RefreshToken.deleteMany({ user: userId, ...(keepHash ? { tokenHash: { $ne: keepHash } } : {}) });
  await User.updateOne({ _id: userId }, { $inc: { tokenVersion: 1 } });
  return deletedCount;
}
