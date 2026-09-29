import { countryByCode, HOME_COUNTRY } from '../../../shared/countries.js';
import { logger } from '../utils/logger.js';

/**
 * Which country a request is coming from.
 *
 * Used for two things, and worth being clear that they are different: filling in the country field
 * at signup so somebody does not have to scroll a list of 245, and deciding whether to show
 * advertising in a market we have chosen to show it in. Neither is a security decision — a header
 * can be forged and a VPN moves anyone anywhere — so nothing here gates access or pricing. The
 * country on the *account* still decides what somebody is charged, and only a person can set that.
 *
 * The IP address itself is read and discarded. It is personal data, so it is never logged, never
 * stored, and never sent anywhere except the lookup that turns it into two letters.
 */
const CF_HEADER = 'cf-ipcountry';

/**
 * Cloudflare puts the country on every request it proxies, which makes this free and instant when
 * the domain is behind Cloudflare. Render's own edge does not forward it, so the lookup below is
 * the fallback until the domain's DNS moves.
 */
const fromHeaders = req => {
  const raw = req.get(CF_HEADER) || '';
  const code = raw.trim().toUpperCase();
  // Cloudflare sends XX when it does not know and T1 for Tor exits.
  if (!/^[A-Z]{2}$/.test(code) || code === 'XX' || code === 'T1') return null;
  return code;
};

/**
 * One lookup service, used only if a token is configured, and never on the request path twice for
 * the same address. Without a token this returns nothing and the caller falls back to the default,
 * which is the whole behaviour on a server that has not set this up.
 */
const token = () => process.env.IPINFO_TOKEN || '';

/**
 * Addresses seen recently, so a person loading five pages costs one lookup.
 *
 * Keyed on the address and capped, because an unbounded map keyed on user input is a slow memory
 * leak. The cap evicts oldest-first, which for this is the same as least-recently-seen.
 */
const CACHE_MAX = 5000;
const CACHE_TTL = 6 * 60 * 60 * 1000;
const cache = new Map();

const remember = (ip, code) => {
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(ip, { code, at: Date.now() });
};

async function lookup(ip) {
  const hit = cache.get(ip);
  if (hit && Date.now() - hit.at < CACHE_TTL) return hit.code;
  if (!token() || !ip) return null;
  try {
    const response = await fetch(`https://ipinfo.io/${encodeURIComponent(ip)}/country?token=${token()}`, {
      signal: AbortSignal.timeout(2500),
    });
    if (!response.ok) { remember(ip, null); return null; }
    const code = (await response.text()).trim().toUpperCase();
    const valid = /^[A-Z]{2}$/.test(code) ? code : null;
    remember(ip, valid);
    return valid;
  } catch (error) {
    // Failing open on purpose: a country guess is a convenience, and a signup form must not wait
    // on somebody else's uptime. The address is deliberately absent from this log.
    logger.warn('country lookup failed', { error: error.message });
    remember(ip, null);
    return null;
  }
}

/** Private and loopback addresses, which a lookup would only waste a request on. */
const isLocal = ip => !ip || /^(?:127\.|10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.|::1|fc|fd)/i.test(ip);

/**
 * The two-letter code for this request, or null if nothing can be said.
 *
 * Null rather than a guess, so a caller can tell "we think you are in Canada" apart from "we have
 * no idea and are showing you the default".
 */
export async function countryCodeFor(req) {
  const header = fromHeaders(req);
  if (header) return header;
  const ip = req.ip;
  if (isLocal(ip)) return null;
  return lookup(ip);
}

/** The country name our own list uses, which is the shape the signup form and pricing expect. */
export async function countryNameFor(req) {
  const code = await countryCodeFor(req);
  return code ? (countryByCode(code)?.name || null) : null;
}

export const fallbackCountry = HOME_COUNTRY;
export const isLookupConfigured = () => !!token();
/** Exposed so a test can clear state between cases. */
export const _resetCache = () => cache.clear();
