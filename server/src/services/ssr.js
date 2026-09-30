import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { logger } from '../utils/logger.js';
import { publicConfig } from './settingsService.js';
import { dataFor, isRenderable } from './ssrData.js';

/**
 * Serving public pages as finished HTML.
 *
 * ── What this is for ──────────────────────────────────────────────────────────────────────────
 *
 * The app fetches its content in effects, so the HTML it used to send was an empty div and a
 * script tag. Google executes JavaScript and would eventually see the page; Bing largely does not,
 * social previews do not, and neither do the crawlers behind the AI tools people increasingly ask
 * for recommendations. A published collection's cards were therefore not really indexable text,
 * which is a problem when the cards are the reason the page is worth finding.
 *
 * ── What is deliberately not rendered ─────────────────────────────────────────────────────────
 *
 * Only signed-out requests, and only the routes in ssrData. Everything else falls through to the
 * shell exactly as before, and that is a decision rather than an omission:
 *
 *  - A signed-in page has no SEO to gain. The dashboard and the library are noindex by design, so
 *    rendering them would spend CPU on every navigation to change nothing a crawler sees.
 *  - Per-visitor HTML cannot be cached. Anonymous pages are identical for everybody, which is what
 *    makes the cache below sound; a signed-in one would have to be rendered every time.
 *  - It keeps one user's render away from another's response. The render fills a cache with
 *    whatever it fetched, and the surest way never to hand that to the wrong person is never to
 *    put anybody's session in it.
 *
 * ── Failure ───────────────────────────────────────────────────────────────────────────────────
 *
 * Every failure falls back to the shell. Pre-rendering is an optimisation, and an optimisation that
 * can take the site down is a liability: a missing build, a database timeout, a component that
 * throws only on the server all end with the visitor getting the app they got before this existed.
 */

/** Loaded on first use. Absent in development and in tests, where falling back is the whole point. */
let entry = null, entryTried = false;
async function serverEntry(root) {
  if (entryTried) return entry;
  entryTried = true;
  try {
    entry = await import(path.join(root, 'dist-ssr', 'entry-server.js'));
  } catch (error) {
    logger.info('no server-rendering bundle found, so pages will be sent as the app shell', { error: error.message });
    entry = null;
  }
  return entry;
}

/**
 * Rendered pages, keyed by path.
 *
 * A published collection is the same HTML for every signed-out visitor, so rendering it once a
 * minute is enough and the render stops being in the request at all. Short, because the point of
 * editing a collection is that the change is visible, and a minute is about as long as somebody
 * will believe their own edit is still saving.
 *
 * Bounded, because the keys come from the URL: an unbounded map keyed on request paths is a way to
 * be given as much garbage as somebody cares to send. Oldest out first, which for a Map is simply
 * insertion order.
 */
const TTL_MS = 60_000;
const MAX_ENTRIES = 200;
const cache = new Map();

const cached = key => {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > TTL_MS) { cache.delete(key); return null; }
  return hit.html;
};

function remember(key, html) {
  if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value);
  cache.set(key, { html, at: Date.now() });
}

export const clearCache = () => cache.clear();

/**
 * The rendered markup and boot payload for `pathname`, or null to use the shell.
 *
 * `signedIn` is the caller's reading of the request, not something worked out here: whether a
 * request carries a session is the router's business, and this only needs to know to decline.
 */
export async function renderPage({ root, pathname, signedIn }) {
  if (signedIn || !isRenderable(pathname)) return null;

  const hit = cached(pathname);
  if (hit) return hit;

  const mod = await serverEntry(root);
  if (!mod) return null;

  try {
    const [config, data] = await Promise.all([publicConfig(), dataFor(pathname)]);
    if (!data) return null;
    const out = await mod.render({ url: pathname, config, data, user: null });
    // A page that partly failed is not worth shipping. The shell will draw it correctly in the
    // browser, and half-rendered HTML is worse for a crawler than honest emptiness.
    if (out.errors.length) {
      logger.warn('a page could not be pre-rendered, sending the app shell instead', { pathname, error: out.errors[0]?.message });
      return null;
    }
    const payload = { rendered: true, user: null, config, data: out.data };
    const html = { body: out.html, payload };
    remember(pathname, html);
    return html;
  } catch (error) {
    logger.warn('pre-rendering failed, sending the app shell instead', { pathname, error: error.message });
    return null;
  }
}

/**
 * Puts a render into the shell.
 *
 * The payload is written as JSON inside a script tag, which means one character matters: a `<` in
 * somebody's card text would otherwise be able to close that tag early and continue as markup.
 * Escaping the sequences that can start a tag is what makes this safe; `JSON.stringify` alone is
 * not enough, and the conventional shortcut of only escaping `<` misses `-->`.
 */
export function applyRender(shell, { body, payload }) {
  const json = JSON.stringify(payload)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
  return shell
    .replace('<div id="root"></div>', `<div id="root">${body}</div>`)
    .replace('</body>', `<script>window.__APP_BOOT__=${json}</script></body>`);
}

/** Reads the shell once and keeps it, since it is sent on every page load and never changes. */
export async function loadShell(root) {
  return readFile(path.join(root, 'dist', 'index.html'), 'utf8').catch(() => '');
}
