import crypto from 'node:crypto';
import { AppError, badRequest } from '../../utils/errors.js';

/**
 * Verifying the ID token Google hands the browser.
 *
 * Google's "Sign in with Google" gives the page a signed JWT asserting who the person is. The
 * whole security of this rests on checking that signature here rather than trusting what the
 * browser posts, so the checks below are deliberately exhaustive: the signature against Google's
 * published keys, the issuer, the audience being *our* client id, and the expiry.
 *
 * Written against Google's endpoints directly rather than through their SDK, for the same reason
 * the payment gateway is: three fetches and a signature check, versus a dependency in the tree.
 *
 * Note what is *not* needed — a client secret. The token is already signed by Google and we only
 * ever read it, so there is no secret to keep on the server and none to leak.
 */
const ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];
const JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';

export const clientId = () => process.env.GOOGLE_CLIENT_ID || '';
export const isConfigured = () => !!clientId();

/**
 * Google's signing keys, cached until they say to stop.
 *
 * They rotate these, so the set cannot be fetched once at boot and kept. `Cache-Control: max-age`
 * on the response is how long they consider it good for, and a key id we have never seen is the
 * signal to refetch early rather than reject a token that is probably fine.
 */
let cache = { keys: [], expiresAt: 0 };

async function jwks(force = false) {
  if (!force && cache.expiresAt > Date.now() && cache.keys.length) return cache.keys;
  let response;
  try {
    response = await fetch(JWKS_URL, { signal: AbortSignal.timeout(8000) });
  } catch (cause) {
    throw new AppError(503, 'Could not reach Google to check that sign-in. Please try again.', 'GOOGLE_UNREACHABLE', { cause });
  }
  if (!response.ok) throw new AppError(503, 'Google could not confirm that sign-in. Please try again.', 'GOOGLE_UNREACHABLE');
  const body = await response.json().catch(() => ({}));
  const keys = Array.isArray(body.keys) ? body.keys : [];
  if (!keys.length) throw new AppError(503, 'Google could not confirm that sign-in. Please try again.', 'GOOGLE_UNREACHABLE');
  const maxAge = Number(/max-age=(\d+)/.exec(response.headers.get('cache-control') || '')?.[1]) || 3600;
  cache = { keys, expiresAt: Date.now() + maxAge * 1000 };
  return keys;
}

const decodeSegment = segment => JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));

/**
 * Returns the claims of a valid token, and throws for anything else.
 *
 * Every failure is the same message to the caller. A person mid-sign-in cannot act on "the
 * audience did not match", and spelling out which check failed only helps somebody probing it.
 */
export async function verify(credential) {
  if (!isConfigured()) throw new AppError(503, 'Signing in with Google is not set up on this server.', 'GOOGLE_NOT_CONFIGURED');
  if (typeof credential !== 'string' || credential.split('.').length !== 3) throw badRequest('That Google sign-in could not be read.', 'BAD_GOOGLE_TOKEN');

  const [headerPart, payloadPart, signaturePart] = credential.split('.');
  let header, claims;
  try {
    header = decodeSegment(headerPart);
    claims = decodeSegment(payloadPart);
  } catch { throw badRequest('That Google sign-in could not be read.', 'BAD_GOOGLE_TOKEN'); }

  // RS256 only. Accepting whatever the token names would accept `none`, which is the oldest hole
  // in JWT there is.
  if (header.alg !== 'RS256') throw badRequest('That Google sign-in could not be read.', 'BAD_GOOGLE_TOKEN');

  let keys = await jwks();
  let key = keys.find(k => k.kid === header.kid);
  // An unknown key id usually means they have rotated since we cached, not that the token is bad.
  if (!key) key = (await jwks(true)).find(k => k.kid === header.kid);
  if (!key) throw badRequest('That Google sign-in could not be verified.', 'BAD_GOOGLE_TOKEN');

  const ok = crypto.createVerify('RSA-SHA256')
    .update(`${headerPart}.${payloadPart}`)
    .verify(crypto.createPublicKey({ key, format: 'jwk' }), Buffer.from(signaturePart, 'base64url'));
  if (!ok) throw badRequest('That Google sign-in could not be verified.', 'BAD_GOOGLE_TOKEN');

  // The audience check is the one that stops a token minted for somebody else's app being replayed
  // at ours. Without it, any valid Google token from anywhere would sign someone in here.
  if (claims.aud !== clientId()) throw badRequest('That Google sign-in was not meant for us.', 'BAD_GOOGLE_TOKEN');
  if (!ISSUERS.includes(claims.iss)) throw badRequest('That Google sign-in could not be verified.', 'BAD_GOOGLE_TOKEN');
  // 60 seconds of slack, because a clock that is a few seconds out should not lock somebody out.
  const now = Math.floor(Date.now() / 1000);
  if (!claims.exp || claims.exp + 60 < now) throw badRequest('That Google sign-in has expired. Please try again.', 'GOOGLE_TOKEN_EXPIRED');
  if (claims.nbf && claims.nbf - 60 > now) throw badRequest('That Google sign-in could not be verified.', 'BAD_GOOGLE_TOKEN');
  if (!claims.sub || !claims.email) throw badRequest('Google did not tell us enough to sign you in.', 'BAD_GOOGLE_TOKEN');

  return {
    googleId: String(claims.sub),
    email: String(claims.email).toLowerCase(),
    // Google sends this as a real boolean or the string "true" depending on the endpoint.
    emailVerified: claims.email_verified === true || claims.email_verified === 'true',
    name: typeof claims.name === 'string' ? claims.name.trim().slice(0, 60) : '',
  };
}

/** Exposed so a test can drop a stub key set in and put it back afterwards. */
export const _setKeyCache = next => { cache = next || { keys: [], expiresAt: 0 }; };
