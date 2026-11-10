import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { BRAND } from '../../shared/brand.js';
import { isSafePath } from './path';

/**
 * Talking to the server from a phone.
 *
 * A browser keeps its session in HttpOnly cookies. A native app has no such thing, so it asks for
 * the tokens in the response body (`X-Auth-Mode: token`), keeps them in the system keychain
 * (iOS Keychain / Android Keystore through SecureStore) and sends the access token as a Bearer
 * header. Nothing is attached automatically, so a request can only be made by this code.
 *
 * The access token lives a few minutes. When the server says it has expired (or it is about to),
 * the refresh token is exchanged for a new pair. Only one exchange is in flight at a time: the
 * refresh token rotates on every use, so two parallel requests each spending it would log the
 * person out.
 */

const LIVE = 'https://remio.in';
const fromEnv = process.env.EXPO_PUBLIC_API_URL || LIVE;
// An installed build always talks to the live server: a stray local address in a `.env` file at build
// time (or a plain http one) must not end up inside an app people install.
const configured = __DEV__ || /^https:\/\//i.test(fromEnv) ? fromEnv : LIVE;
// The Android emulator's `localhost` is the emulator itself; the host machine is 10.0.2.2.
export const API_URL = (Platform.OS === 'android' ? configured.replace(/\/\/(localhost|127\.0\.0\.1)/, '//10.0.2.2') : configured).replace(/\/$/, '');

const KEYS = { access: `${BRAND.slug}.access`, refresh: `${BRAND.slug}.refresh`, expires: `${BRAND.slug}.expires` };
const EARLY_MS = 60_000;

export class ApiError extends Error {
  constructor(message, { status = 0, code = 'ERROR', details } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status; this.code = code; this.details = details;
  }
}

let tokens = { access: '', refresh: '', expiresAt: 0 };
let signedOutHandler = null;
let renewing = null;

/** Called once at start-up, before anything is requested. */
export async function loadTokens() {
  try {
    const [access, refresh, expires] = await Promise.all(Object.values(KEYS).map(k => SecureStore.getItemAsync(k)));
    tokens = { access: access || '', refresh: refresh || '', expiresAt: Number(expires) || 0 };
  } catch { tokens = { access: '', refresh: '', expiresAt: 0 }; }
  return !!tokens.refresh;
}

export async function setTokens({ accessToken, refreshToken }, auth) {
  tokens = {
    access: accessToken, refresh: refreshToken || tokens.refresh,
    expiresAt: auth?.accessExpiresAt ? new Date(auth.accessExpiresAt).getTime() : Date.now() + 4 * 60_000,
  };
  await Promise.all([
    SecureStore.setItemAsync(KEYS.access, tokens.access),
    SecureStore.setItemAsync(KEYS.refresh, tokens.refresh),
    SecureStore.setItemAsync(KEYS.expires, String(tokens.expiresAt)),
  ]).catch(() => {});
}

export async function clearTokens() {
  tokens = { access: '', refresh: '', expiresAt: 0 };
  await Promise.all(Object.values(KEYS).map(k => SecureStore.deleteItemAsync(k))).catch(() => {});
}

export const hasSession = () => !!tokens.refresh;
export const onSignedOut = fn => { signedOutHandler = fn; };
export const refreshToken = () => tokens.refresh;

export const getAccessToken = () => tokens.access;

/** An image on this server, with the header private pictures need. */
export const imageSource = id => (id ? { uri: `${API_URL}/api/media/${id}`, headers: tokens.access ? { Authorization: `Bearer ${tokens.access}` } : undefined } : null);

async function send(path, { method = 'GET', body, form, auth = true, timeout = 20_000, headers: extra } = {}) {
  // Never build a request out of an address a link could have bent (see path.js).
  if (!isSafePath(path)) throw new ApiError('That address is not valid.', { code: 'BAD_PATH' });
  const headers = { 'X-Auth-Mode': 'token', Accept: 'application/json', ...extra };
  if (!form && body !== undefined) headers['Content-Type'] = 'application/json';
  if (auth && tokens.access) headers.Authorization = `Bearer ${tokens.access}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  let response;
  try {
    response = await fetch(`${API_URL}/api${path}`, { method, headers, body: form ?? (body !== undefined ? JSON.stringify(body) : undefined), signal: controller.signal });
  } catch (cause) {
    clearTimeout(timer);
    // fetch only rejects when the request never completed: offline, DNS, a dead server or the timeout.
    throw new ApiError(`${BRAND.name} could not reach the server. Check your connection and try again.`, { code: 'NETWORK', details: { cause: cause?.message } });
  }
  // The timeout covers the body too: a reply that stalls halfway would otherwise hold every queue behind it.
  let data = null;
  try { data = await response.json(); } catch { /* not JSON, or cut off by the timeout */ } finally { clearTimeout(timer); }
  if (!data) throw new ApiError(`${BRAND.name} is unavailable right now. Please try again in a moment.`, { status: response.status, code: 'NOT_JSON' });
  if (!response.ok) throw new ApiError(data.error || 'Something went wrong.', { status: response.status, code: data.code || 'ERROR', details: data.details });
  return data;
}

/** Swap the refresh token for a new pair. Resolves false (and signs out) if the server refuses it. */
export function renewSession() {
  renewing ??= (async () => {
    if (!tokens.refresh) return false;
    try {
      const data = await send('/auth/refresh', { method: 'POST', body: { refreshToken: tokens.refresh }, auth: false });
      if (!data.tokens?.accessToken) throw new ApiError('Signed out.', { status: 401, code: 'UNAUTHENTICATED' });
      await setTokens(data.tokens, data.auth);
      return true;
    } catch (e) {
      // A dropped connection, a busy server or a wifi login page says nothing about the session; only a refusal ends it.
      if (!(e.status === 400 || e.status === 401 || e.status === 403 || e.code === 'UNAUTHENTICATED')) return false;
      await clearTokens();
      signedOutHandler?.();
      return false;
    }
  })().finally(() => { renewing = null; });
  return renewing;
}

export async function api(path, options = {}) {
  if (tokens.refresh && tokens.expiresAt && Date.now() > tokens.expiresAt - EARLY_MS && options.auth !== false) await renewSession();
  try {
    const data = await send(path, options);
    if (data?.tokens?.accessToken) await setTokens(data.tokens, data.auth);
    return data;
  } catch (e) {
    if (e.code !== 'TOKEN_EXPIRED' || options.auth === false) throw e;
    if (!(await renewSession())) throw new ApiError('Your session has ended. Please sign in again.', { status: 401, code: 'UNAUTHENTICATED' });
    return send(path, options);
  }
}
