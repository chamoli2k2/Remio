import { createContext, useContext, useState, useEffect, useMemo, useRef, useCallback, useSyncExternalStore } from 'react';
import { api, isDemo } from '../services/api';
import { messageFor } from '../services/errors';
import { reauthRealtime } from '../services/realtime';
import { browserStore } from '../services/store';
import { DEFAULT_REGIONS, DEFAULT_SELLING, pricebook } from '../../../shared/pricing.js';
const Context = createContext();
/**
 * What the app falls back to before the server has answered, or if it never does.
 *
 * The shipped prices, which is the same thing an empty settings collection means on the server. A
 * price is better shown briefly stale than not at all, and every figure on screen is re-checked by
 * the server before anyone is charged, so the worst case is a moment of last-release pricing.
 */
const SHIPPED_CONFIG = { regions: DEFAULT_REGIONS, selling: DEFAULT_SELLING, planDays: null, flags: {}, notice: '', limits: {} };

/**
 * `store`, `initialUser` and `initialConfig` are how a server render hands its work over.
 *
 * Given a session and a configuration, the provider does not fetch them and does not show the boot
 * screen — it renders the page as the server rendered it, which is what makes the markup match on
 * hydration. Left out, as in the browser's own first load, everything behaves as it always did.
 *
 * `initialUser` is checked against undefined rather than for truthiness, because null is a real
 * answer: it means nobody is signed in, and that is as settled a state as a session.
 */
export function AppProvider({ children, store = browserStore, initialUser, initialConfig }) {
  const provided = initialUser !== undefined;
  const [user, setUser] = useState(initialUser ?? null), [loading, setLoading] = useState(!provided), [error, setError] = useState('');
  const [config, setConfig] = useState(initialConfig || SHIPPED_CONFIG);
  // Reloads whatever is on screen, once per distinct request rather than once per component.
  const refresh = useCallback((...keys) => store.invalidate(...keys), [store]);
  // A signed-out visitor is not an error; only a real failure should surface one.
  // The session and the configuration are fetched together and the boot screen waits for both, so
  // the first thing anyone sees already has the right prices in it rather than flickering from the
  // shipped ones to the live ones. Config failing is survivable; the fallback above covers it.
  useEffect(() => {
    if (provided) {
      /**
       * The configuration is fetched again even though the server sent one.
       *
       * What the server sent is the same for everybody, because the page it came with is cached and
       * shared between visitors. The parts that are not the same for everybody — the country
       * detected from the request, and whether advertising may be shown to it — deliberately are
       * not in there, or the first visitor's country would be baked into a page served to the next
       * one. They arrive here instead, once the page is live and nothing is being hydrated.
       *
       * The session is not re-fetched: a page is only rendered on the server for a request with no
       * session on it, so `null` is already the right answer rather than an unknown one.
       */
      api('/config').then(setConfig).catch(() => {});
      return;
    }
    Promise.all([
      api('/auth/me').then(d => setUser(d.user)).catch(e => { if (e.status !== 401) setError(messageFor(e)); }),
      api('/config').then(setConfig).catch(() => {}),
    ]).finally(() => setLoading(false));
  }, [provided]);
  // The socket authenticates from the session cookie, so it must reconnect when the signed-in user changes.
  const userId = user?.id ?? null; useEffect(() => { if (!loading) reauthRealtime(); }, [userId, loading]);
  // Signing in or out makes every cached answer belong to the wrong person. The ref skips the first
  // run, which is just the session arriving, not a change of account.
  const lastUser = useRef();
  useEffect(() => { if (lastUser.current !== undefined && lastUser.current !== userId) store.invalidate(); lastUser.current = userId; }, [userId, store]);
  // Rebuilt only when the prices or the markets actually change, because it is handed to every
  // component that shows a figure and a fresh object each render would re-render all of them.
  const prices = useMemo(() => pricebook({ regions: config.regions, selling: config.selling, planDays: config.planDays }), [config]);
  const value = useMemo(() => ({ user, setUser, loading, error, refresh, isDemo, config, prices, store }), [user, loading, error, refresh, config, prices, store]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export const useApp = () => useContext(Context);

/** The cache this tree is reading from: the browser's, or a server render's own. */
export const useStore = () => useContext(Context).store;

const EMPTY = { data: null, error: null };

/**
 * How old cached data may be before it is quietly refreshed behind what is on screen.
 *
 * Navigating back to a page you saw a minute ago should show it immediately, not a spinner over
 * data that was almost certainly still right. So the cached copy is rendered at once and a refresh
 * runs underneath; if anything changed, it corrects itself a moment later. Pass `staleAfter: 0` for
 * a view where that would be wrong.
 */
const STALE_AFTER = 30_000;

/**
 * Reads `key` from the shared cache, fetching it if nobody has yet. `loader` is optional and only
 * needed when the data is not a plain GET of the key itself, such as two requests combined into one
 * view. Pass `enabled: false` to hold off, which keeps the key stable while a prerequisite loads.
 */
export function useQuery(key, loader, { enabled = true, staleAfter = STALE_AFTER } = {}) {
  const store = useStore();
  const active = enabled && !!key;
  // The loader closes over props that change every render, so the cache calls through a ref and
  // always runs the current one instead of whichever version was around at subscribe time.
  const latest = useRef(loader); latest.current = loader;
  const entry = useSyncExternalStore(
    useCallback(fn => (active ? store.subscribe(key, fn) : () => {}), [key, active, store]),
    () => (active ? store.peek(key) : null) || EMPTY,
    // The server has no subscriptions to set up; it reads whatever the render already fetched.
    () => (active ? store.peek(key) : null) || EMPTY,
  );
  useEffect(() => {
    if (!active) return;
    // Plain GETs need no loader at the call site, so supply one rather than making the store know
    // about the API client.
    const run = () => (latest.current ? latest.current() : api(key));
    store.register(key, run);
    if (!store.peek(key)) store.load(key, run);
    else store.revalidate(key, staleAfter);
  }, [key, active, store, staleAfter]);
  const refetch = useCallback(() => store.load(key), [key, store]);
  return { data: entry.data, error: entry.error ? messageFor(entry.error) : '', loading: active && !store.peek(key), refetch, setData: data => store.put(key, data) };
}

/**
 * Handlers that start fetching `key` when somebody looks like they are about to need it.
 *
 * Spread onto a link or a tile: hovering it, or reaching it with the keyboard, is a good enough
 * guess that the data is worth having ready, and a wrong guess costs one request that the cache
 * keeps anyway. The click then renders from cache instead of opening with a spinner.
 */
export function usePrefetch(key, loader) {
  const store = useStore();
  const latest = useRef(loader); latest.current = loader;
  const start = useCallback(() => {
    if (key) store.prefetch(key, () => (latest.current ? latest.current() : api(key)));
  }, [key, store]);
  return { onPointerEnter: start, onFocus: start };
}
