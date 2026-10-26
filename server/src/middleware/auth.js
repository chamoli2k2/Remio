import { AppError, assert, asyncHandler } from '../utils/errors.js';
import { BRAND } from '../../../shared/brand.js';
import { REFRESH_TTL_MS, resolveAccess, signAccess } from '../services/auth/jwt.js';

export { hashToken } from '../utils/hash.js';

/**
 * Two ways to carry the same tokens.
 *
 * A browser gets them as HttpOnly cookies, so a script injected into the page can never read them,
 * and the Origin check in app.js covers the ambient authority that cookies bring. A native app sends
 * `X-Auth-Mode: token`, receives the tokens in the response body, and presents the access token as
 * `Authorization: Bearer`. Nothing is sent automatically there, so there is nothing to forge.
 */
export const wantsTokens = req => req.get('x-auth-mode') === 'token';
const bearerOf = req => { const h = req.headers.authorization || ''; return h.startsWith('Bearer ') ? h.slice(7).trim() : ''; };
export const accessTokenOf = req => bearerOf(req) || req.cookies?.[BRAND.cookies.access] || '';
export const refreshTokenOf = req => (typeof req.body?.refreshToken === 'string' && req.body.refreshToken) || req.cookies?.[BRAND.cookies.refresh] || '';

// The access cookie outlives the token inside it, so an expired one still reaches the server and
// is answered with TOKEN_EXPIRED instead of looking like nobody was ever signed in.
const base = () => ({ httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: REFRESH_TTL_MS });
const accessCookie = () => ({ ...base(), path: '/' });
const refreshCookie = () => ({ ...base(), path: '/api/auth' });
export function clearAuthCookies(res) {
  const { maxAge: _a, ...access } = accessCookie(); const { maxAge: _r, ...refresh } = refreshCookie();
  res.clearCookie(BRAND.cookies.access, access);
  res.clearCookie(BRAND.cookies.refresh, refresh);
}

/** Hands freshly issued tokens to the client in whichever form it asked for, and returns the body part. */
export function deliverTokens(req, res, { access, refreshToken }) {
  const auth = { accessExpiresAt: access.expiresAt.toISOString() };
  if (wantsTokens(req)) return { auth, tokens: { accessToken: access.token, ...(refreshToken ? { refreshToken } : {}), tokenType: 'Bearer' } };
  res.cookie(BRAND.cookies.access, access.token, accessCookie());
  if (refreshToken) res.cookie(BRAND.cookies.refresh, refreshToken, refreshCookie());
  return { auth };
}

// Requests that must work with a dead access token: renewing it, replacing it, and images, which an
// <img> tag cannot retry and which fall back to whatever an anonymous visitor may see.
const TOLERANT = /^\/(?:media\/|auth\/(?:refresh|logout|login|signup|google)$)/;
const expired = () => new AppError(401, 'Your sign-in needs renewing. Please try again.', 'TOKEN_EXPIRED');

export const authenticate = asyncHandler(async (req, res, next) => {
  const token = accessTokenOf(req);
  if (!token) return next();
  const found = await resolveAccess(token);
  if (found.revoked) { if (!bearerOf(req)) clearAuthCookies(res); return next(); }
  if (found.stale && !bearerOf(req)) {
    // A role or Premium change happened since this cookie was signed. Replace it now, so the gates
    // below read the current claims and the browser carries them from here on.
    const access = await signAccess(found.user);
    res.cookie(BRAND.cookies.access, access.token, accessCookie());
    req.user = found.user; req.auth = access.claims; return next();
  }
  if (found.user && !found.stale) { req.user = found.user; req.auth = found.claims; return next(); }
  if (TOLERANT.test(req.path)) return next();
  next(expired());
});
export const requireAuth = (req, _res, next) => { try { assert(req.auth, 401, 'Sign in to continue.'); next(); } catch (e) { next(e); } };
