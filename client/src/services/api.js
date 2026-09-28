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
export async function api(path, options = {}) {
  if (isDemo) return demoReady.then(() => demoModule.demoRequest(path, options));
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
  return data;
}
// Synchronous, which is why `demoReady` is awaited before the app mounts.
export const imageUrl = id => !id ? '' : isDemo ? demoModule.demoImage(id) : `${base}/api/media/${id}`;
