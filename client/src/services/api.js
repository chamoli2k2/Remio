import { ApiError } from './errors';
import { BRAND } from '../../../shared/brand.js';
export const isDemo = import.meta.env.VITE_DEMO_MODE === 'true';

/**
 * The demo fixtures are loaded only when the build is a demo build.
 *
 * `isDemo` is a build-time constant, so a real build evaluates this branch away and the fixture
 * module — a database of imaginary people, folders, orders, and analytics — is never linked into
 * the bundle a paying visitor downloads. It used to be a plain import at the top of this file,
 * which shipped all of it to production to support a mode production never runs in.
 */
const demo = () => import('./demoApi');

/**
 * Resolved once the fixtures are in memory, and awaited before the app mounts in a demo build.
 *
 * `imageUrl` is called during render and has to answer immediately, so the module cannot be
 * fetched lazily underneath it: a card would render with an empty src and never re-render when the
 * import landed. Loading it before the first paint costs a demo build one request and costs a real
 * build nothing, because `isDemo` is a build-time constant and this whole branch disappears.
 */
let demoModule = null;
export const demoReady = isDemo ? demo().then(m => { demoModule = m; }) : Promise.resolve();
const base = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

/**
 * Keeping the access token alive.
 *
 * It lives a few minutes and sits in an HttpOnly cookie this code cannot see, so the server says
 * when it ends, in `auth.accessExpiresAt`, and a timer renews it a minute early. Images and the
 * socket cannot retry a request, so renewing ahead of time is what keeps them working; the retry
 * in `api` below is the fallback for a laptop that slept through the timer.
 *
 * One renewal is in flight at a time. Concurrent requests that all hit an expired token wait for
 * the same one instead of each spending the refresh token, which rotates on every use.
 */
let renewing = null, renewTimer = null, renewAt = 0;
const EARLY_MS = 60_000;
function scheduleRenewal(auth) {
  if (typeof window === 'undefined' || !auth?.accessExpiresAt) return;
  clearTimeout(renewTimer);
  renewAt = new Date(auth.accessExpiresAt).getTime() - EARLY_MS;
  renewTimer = setTimeout(() => { renewSession(); }, Math.max(5_000, renewAt - Date.now()));
}
export const stopRenewal = () => { clearTimeout(renewTimer); renewAt = 0; };
export function renewSession() {
  renewing ??= request('/auth/refresh', { method: 'POST' }).then(() => true, () => { stopRenewal(); return false; }).finally(() => { renewing = null; });
  return renewing;
}

export async function api(path, options = {}) {
  if (isDemo) return demoReady.then(() => demoModule.demoRequest(path, options));
  try { return await request(path, options); }
  catch (e) {
    if (e.code !== 'TOKEN_EXPIRED') throw e;
    // Renewed or not, retry once: a failed renewal clears the cookies, so the retry is answered
    // as a signed-out visitor rather than looping.
    await renewSession();
    return request(path, options);
  }
}
async function request(path, options) {
  const isForm = options.body instanceof FormData;
  let response;
  try {
    response = await fetch(`${base}/api${path}`, { ...options, credentials: 'include', headers: { ...(isForm ? {} : { 'Content-Type': 'application/json' }), ...options.headers }, body: options.body && !isForm ? JSON.stringify(options.body) : options.body });
  } catch (cause) {
    // fetch only rejects when the request never completed: offline, DNS, CORS, or a dead server.
    throw new ApiError(`${BRAND.name} could not reach the server. Check your connection and try again.`, { code: 'NETWORK', details: { cause: cause?.message } });
  }
  const requestId = response.headers.get('x-request-id');
  const type = response.headers.get('content-type') || '';
  if (!type.includes('application/json')) {
    throw new ApiError(`The ${BRAND.name} API is unavailable. Start the Express server and check your database connection.`, { status: response.status, code: 'NOT_JSON', requestId });
  }
  const data = await response.json();
  if (!response.ok) throw new ApiError(data.error || 'Request failed.', { status: response.status, code: data.code || 'ERROR', requestId: data.requestId || requestId, details: data.details });
  if (data?.auth) scheduleRenewal(data.auth);
  return data;
}

// A sleeping laptop or a background tab can miss the timer, so check again when the tab comes back.
if (typeof document !== 'undefined' && !isDemo) document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && renewAt && Date.now() >= renewAt) renewSession(); });
// Synchronous, which is why `demoReady` is awaited before the app mounts.
export const imageUrl = id => !id ? '' : isDemo ? demoModule.demoImage(id) : `${base}/api/media/${id}`;
