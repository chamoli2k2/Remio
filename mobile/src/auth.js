import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, clearTokens, hasSession, loadTokens, onSignedOut, refreshToken, setTokens } from './api';
import { discardQueue, flushSoon, bindUser } from './reviewQueue';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [state, setState] = useState({ status: 'loading', user: null });

  const signedOut = useCallback(() => { bindUser(null); setState({ status: 'signedOut', user: null }); }, []);
  useEffect(() => { onSignedOut(signedOut); }, [signedOut]);

  useEffect(() => {
    let live = true;
    (async () => {
      if (!(await loadTokens())) return live && signedOut();
      try {
        const { user } = await api('/auth/me');
        if (!live) return;
        if (!user) { await clearTokens(); return signedOut(); }
        bindUser(user.id); setState({ status: 'signedIn', user });
      } catch (e) {
        // Offline at launch keeps the person signed in with what they last saw; only a refusal signs out.
        if (!live) return;
        if (e.code === 'NETWORK' && hasSession()) setState({ status: 'signedIn', user: null, offline: true });
        else { await clearTokens(); signedOut(); }
      }
    })();
    return () => { live = false; };
  }, [signedOut]);

  const login = useCallback(async (identifier, password) => {
    const data = await api('/auth/login', { method: 'POST', body: { identifier: identifier.trim(), password }, auth: false });
    if (!data.tokens?.accessToken) throw new Error('The server did not return a session. Please try again.');
    await setTokens(data.tokens, data.auth);
    bindUser(data.user.id);
    setState({ status: 'signedIn', user: data.user });
  }, []);

  const logout = useCallback(async () => {
    await flushSoon(2500);
    try { await api('/auth/logout', { method: 'POST', body: { refreshToken: refreshToken() }, auth: false }); } catch { /* the device forgets it either way */ }
    await clearTokens(); signedOut();
  }, [signedOut]);

  const refreshUser = useCallback(async () => {
    const { user } = await api('/auth/me');
    if (user) setState(s => ({ ...s, user }));
  }, []);

  const value = useMemo(() => ({ ...state, login, logout, refreshUser, discard: discardQueue }), [state, login, logout, refreshUser]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
