import { createContext, useContext, useState, useEffect, useMemo, useRef, useCallback, useSyncExternalStore } from 'react';
import { api, isDemo } from '../services/api';
import { messageFor } from '../services/errors';
import { reauthRealtime } from '../services/realtime';
import { load, peek, put, register, subscribe, invalidate } from '../services/store';
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

export function AppProvider({ children }) {
  const [user, setUser] = useState(null), [loading, setLoading] = useState(true), [error, setError] = useState('');
  const [config, setConfig] = useState(SHIPPED_CONFIG);
  // Reloads whatever is on screen, once per distinct request rather than once per component.
  const refresh = useCallback((...keys) => invalidate(...keys), []);
  // A signed-out visitor is not an error; only a real failure should surface one.
  // The session and the configuration are fetched together and the boot screen waits for both, so
  // the first thing anyone sees already has the right prices in it rather than flickering from the
  // shipped ones to the live ones. Config failing is survivable; the fallback above covers it.
  useEffect(() => {
    Promise.all([
      api('/auth/me').then(d => setUser(d.user)).catch(e => { if (e.status !== 401) setError(messageFor(e)); }),
      api('/config').then(setConfig).catch(() => {}),
    ]).finally(() => setLoading(false));
  }, []);
  // The socket authenticates from the session cookie, so it must reconnect when the signed-in user changes.
  const userId = user?.id ?? null; useEffect(() => { if (!loading) reauthRealtime(); }, [userId, loading]);
  // Signing in or out makes every cached answer belong to the wrong person. The ref skips the first
  // run, which is just the session arriving, not a change of account.
  const lastUser = useRef();
  useEffect(() => { if (lastUser.current !== undefined && lastUser.current !== userId) invalidate(); lastUser.current = userId; }, [userId]);
  // Rebuilt only when the prices or the markets actually change, because it is handed to every
  // component that shows a figure and a fresh object each render would re-render all of them.
  const prices = useMemo(() => pricebook({ regions: config.regions, selling: config.selling, planDays: config.planDays }), [config]);
  return <Context.Provider value={{ user, setUser, loading, error, refresh, isDemo, config, prices }}>{children}</Context.Provider>;
}
export const useApp = () => useContext(Context);

const EMPTY = { data: null, error: null };
/**
 * Reads `key` from the shared cache, fetching it if nobody has yet. `loader` is optional and only
 * needed when the data is not a plain GET of the key itself, such as two requests combined into one
 * view. Pass `enabled: false` to hold off, which keeps the key stable while a prerequisite loads.
 */
export function useQuery(key, loader, { enabled = true } = {}) {
  const active = enabled && !!key;
  // The loader closes over props that change every render, so the cache calls through a ref and
  // always runs the current one instead of whichever version was around at subscribe time.
  const latest = useRef(loader); latest.current = loader;
  const entry = useSyncExternalStore(
    useCallback(fn => (active ? subscribe(key, fn) : () => {}), [key, active]),
    () => (active ? peek(key) : null) || EMPTY,
  );
  useEffect(() => {
    if (!active) return;
    // Plain GETs need no loader at the call site, so supply one rather than making the store know
    // about the API client.
    const run = () => (latest.current ? latest.current() : api(key));
    register(key, run);
    if (!peek(key)) load(key, run);
  }, [key, active]);
  const refetch = useCallback(() => load(key), [key]);
  return { data: entry.data, error: entry.error ? messageFor(entry.error) : '', loading: active && !peek(key), refetch, setData: data => put(key, data) };
}
