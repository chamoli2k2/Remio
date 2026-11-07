import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { cachedApi, subscribe } from '../offline';

/**
 * Fetch a path and keep the answer, refetching when the screen comes back into view.
 *
 * Deliberately small: a screen shows what it last had while it reloads, so coming back to a list
 * never flashes empty. `reload` is for pull-to-refresh and returns when the new data has landed.
 */
export function useQuery(path, { enabled = true } = {}) {
  const [state, setState] = useState({ data: null, error: '', loading: !!path && enabled });
  const live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);

  const load = useCallback(async () => {
    if (!path || !enabled) return;
    try {
      const data = await cachedApi(path);
      if (live.current) setState({ data, error: '', loading: false });
    } catch (e) {
      if (live.current) setState(s => ({ data: s.data, error: e.message, loading: false }));
    }
  }, [path, enabled]);

  useFocusEffect(useCallback(() => { load(); }, [load]));
  // Changes made on this phone (or sent in the background) show up without leaving the screen.
  useEffect(() => subscribe(e => { if (e.invalidate && path && e.invalidate.some(k => k === '*' || path.includes(k))) load(); }), [load, path]);
  const reload = useCallback(async () => { await load(); }, [load]);
  return { ...state, reload, setData: data => setState(s => ({ ...s, data })) };
}
