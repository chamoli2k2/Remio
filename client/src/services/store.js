/**
 * One cache for everything the server owns, keyed by request path.
 *
 * Two components asking for `/folders` at the same moment share a single request and a single copy
 * of the answer, so the sidebar and the page it wraps no longer fetch the library twice. The same
 * guard covers React's development double-render and a refresh that lands while a load is running.
 *
 * This is deliberately not Redux. Nothing here is client state that needs reducers, time travel, or
 * middleware. It is a read-through cache over the API with subscriptions, which is the part those
 * libraries would actually be providing.
 *
 * It imports nothing, so it runs under plain Node in `server/test/store.test.js`. Errors are stored
 * as thrown, and the hook turns them into a sentence.
 *
 * ── Why this is a factory ──────────────────────────────────────────────────────────────────────
 *
 * In a browser there is one cache, and the module-level instance at the bottom of this file is it.
 * On the server, rendering a page needs a cache too, and it absolutely must not be that one: a
 * single shared cache across concurrent renders would serve one visitor's library to the next
 * request that asked for the same path. Each render gets its own instance instead, discarded with
 * the response.
 */
export function createStore() {
  const entries = new Map();   // key -> { data, error, at }
  const inflight = new Map();  // key -> Promise, so concurrent askers share one request
  const loaders = new Map();   // key -> () => Promise, kept so anything can be refetched by key alone
  const listeners = new Map(); // key -> Set<() => void>
  const stale = new Set();     // keys invalidated mid-flight, refetched once the current run lands

  const subscribers = key => listeners.get(key)?.size || 0;
  const announce = key => listeners.get(key)?.forEach(fn => fn());

  const peek = key => entries.get(key) || null;

  /** Records how a key is fetched without fetching it, so a later invalidate knows what to re-run. */
  const register = (key, loader) => { if (loader) loaders.set(key, loader); };

  /** Runs the loader for `key`, or joins the run already in progress. Never rejects: a failure is
   *  recorded on the entry so every subscriber renders the same error. */
  function load(key, loader) {
    if (loader) loaders.set(key, loader);
    if (!loaders.has(key)) throw new Error(`No loader registered for ${key}`);
    const running = inflight.get(key);
    if (running) return running;

    // Called rather than deferred, so the request is genuinely in flight before this returns and the
    // next caller in the same tick joins it instead of starting a second one.
    let started;
    try { started = Promise.resolve(loaders.get(key)()); } catch (error) { started = Promise.reject(error); }

    const run = started
      .then(data => entries.set(key, { data, error: null, at: Date.now() }))
      // The previous data is kept alongside the error. A view that already had something to show
      // keeps showing it rather than emptying out because one refresh failed.
      .catch(error => entries.set(key, { data: entries.get(key)?.data ?? null, error, at: Date.now() }))
      .finally(() => {
        inflight.delete(key);
        announce(key);
        if (stale.delete(key) && subscribers(key)) load(key);
      });

    inflight.set(key, run);
    return run;
  }

  /**
   * Fetches `key` into the cache without anybody waiting on it.
   *
   * For work started on a guess — the collection under the cursor, the page a link points at. It
   * declines if the answer is already cached, because the guess being right twice is not a reason
   * to ask again.
   */
  function prefetch(key, loader) {
    if (!key || entries.has(key) || inflight.has(key)) return;
    load(key, loader);
  }

  /** How old an entry is, in milliseconds. Infinity for one that was never fetched. */
  const ageOf = key => { const e = entries.get(key); return e ? Date.now() - e.at : Infinity; };

  /**
   * Refetches `key` in the background if what is cached is older than `maxAge`.
   *
   * The cached copy stays on screen the whole time. This is the difference between arriving at a
   * page you have seen before and being shown a spinner over data that was very likely still
   * correct, versus being shown the old data and having it quietly corrected a moment later.
   */
  function revalidate(key, maxAge) {
    if (!maxAge || !entries.has(key) || inflight.has(key)) return;
    if (ageOf(key) > maxAge) load(key);
  }

  /** Marks keys out of date. Anything on screen reloads once; anything off screen is simply dropped so
   *  it reloads the next time it is needed. Pass prefixes to scope it, or nothing to mean everything. */
  function invalidate(...prefixes) {
    const matches = key => !prefixes.length || prefixes.some(p => key === p || key.startsWith(p));
    for (const key of new Set([...entries.keys(), ...loaders.keys(), ...listeners.keys()])) {
      if (!matches(key)) continue;
      if (inflight.has(key)) stale.add(key);
      else if (subscribers(key)) load(key);
      else entries.delete(key);
    }
  }

  /** Writes a value straight into the cache, for when a mutation already returned the new state. */
  function put(key, data) {
    entries.set(key, { data, error: null, at: Date.now() });
    announce(key);
  }

  function subscribe(key, fn) {
    if (!listeners.has(key)) listeners.set(key, new Set());
    listeners.get(key).add(fn);
    return () => {
      const set = listeners.get(key);
      set?.delete(fn);
      if (set && !set.size) listeners.delete(key);
    };
  }

  /**
   * Everything fetched during this store's life, as plain data.
   *
   * A server render fills a cache on its way to producing HTML. Handing that over to the browser
   * with the page means the app starts with the answers already in it and fetches nothing to draw
   * what is on screen. Entries that failed are left out — the browser should try those itself
   * rather than inherit somebody else's error.
   */
  function dehydrate() {
    const out = {};
    for (const [key, entry] of entries) if (!entry.error && entry.data !== null) out[key] = entry.data;
    return out;
  }

  /** The other half: adopt what a server render already fetched. */
  function hydrate(data) {
    const at = Date.now();
    for (const [key, value] of Object.entries(data || {})) entries.set(key, { data: value, error: null, at });
  }

  /** Test seam. */
  function reset() {
    [entries, inflight, loaders, listeners].forEach(m => m.clear());
    stale.clear();
  }

  return { peek, register, load, prefetch, revalidate, invalidate, put, subscribe, ageOf, dehydrate, hydrate, reset };
}

/**
 * The browser's cache.
 *
 * Exported as loose functions as well as a store, because most of the app imports them directly and
 * a component in a browser has exactly one cache to talk to. Anything that has to work for a server
 * render takes the store from context instead.
 */
export const browserStore = createStore();
export const { peek, register, load, prefetch, revalidate, invalidate, put, subscribe, ageOf, dehydrate, hydrate, reset } = browserStore;
