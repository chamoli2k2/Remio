import { BRAND } from '../../../shared/brand.js';

/**
 * Where this deployment answers to the outside world.
 *
 * A host pasted from a browser bar usually carries a trailing slash, and that one character breaks
 * two unrelated things at once: browsers never send a trailing slash on `Origin`, so the allow-list
 * silently matches nothing, and every link we email or hand to a payment gateway comes out with a
 * doubled slash in the path. Stripping it in one place is the only way it stays stripped.
 */
export const trustedOrigins = () =>
  (process.env.CLIENT_ORIGIN || 'http://localhost:4173').split(',').map(v => v.trim().replace(/\/+$/, '')).filter(Boolean);

/**
 * The canonical origin, for anything that has to be an absolute URL somebody else will fetch: a
 * link in an email, or a logo a payment gateway loads from its own page.
 *
 * Falls back to the brand domain rather than to localhost, because these URLs outlive the request
 * that made them. A confirmation link pointing at a developer's laptop is worse than one pointing
 * at a host that is merely not deployed yet.
 */
export const publicOrigin = () =>
  (process.env.CLIENT_ORIGIN || '').split(',')[0].trim().replace(/\/+$/, '') || `https://${BRAND.domain}`;
