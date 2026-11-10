import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, clearTokens, hasSession, loadTokens, onSignedOut, refreshToken, setTokens } from './api';
import { discardQueue, flushSoon, bindUser } from './reviewQueue';
import { clear as clearReminders } from './reminders';
import { clearWidget } from './widget';
import { forgetGoogle } from './google';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { bindUser as bindOffline, discardAll, flushSoon as flushChanges, wipeCache } from './offline';

const ME = 'remio.me';
const remember = user => AsyncStorage.setItem(ME, JSON.stringify({ id: user.id, name: user.name, username: user.username })).catch(() => {});
const recall = async () => { try { return JSON.parse(await AsyncStorage.getItem(ME)); } catch { return null; } };

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [state, setState] = useState({ status: 'loading', user: null });

  const signedOut = useCallback(() => { bindUser(null); bindOffline(null); setState({ status: 'signedOut', user: null }); }, []);
  useEffect(() => { onSignedOut(signedOut); }, [signedOut]);

  useEffect(() => {
    let live = true;
    (async () => {
      if (!(await loadTokens())) return live && signedOut();
      try {
        const { user } = await api('/auth/me');
        if (!live) return;
        if (!user) { await clearTokens(); return signedOut(); }
        bindUser(user.id); bindOffline(user.id); remember(user); setState({ status: 'signedIn', user });
      } catch (e) {
        // Offline at launch keeps the person signed in with what they last saw; only a refusal signs out.
        if (!live) return;
        // Anything short of a refusal (no signal, a deploy, a rate limit, a wifi login page) is not one.
        const refused = e.status === 401 || e.status === 403 || e.code === 'UNAUTHENTICATED';
        if (!refused && hasSession()) {
          // No signal at launch: carry on as the person who was signed in, with what is saved on the phone.
          const me = await recall();
          if (me && live) { bindUser(me.id); bindOffline(me.id); }
          setState({ status: 'signedIn', user: me, offline: true });
        }
        else { await clearTokens(); signedOut(); }
      }
    })();
    return () => { live = false; };
  }, [signedOut]);

  const begin = useCallback(async data => {
    if (!data.tokens?.accessToken) throw new Error('The server did not return a session. Please try again.');
    await setTokens(data.tokens, data.auth);
    bindUser(data.user.id); bindOffline(data.user.id); remember(data.user);
    setState({ status: 'signedIn', user: data.user });
  }, []);

  const login = useCallback(async (identifier, password) => {
    await begin(await api('/auth/login', { method: 'POST', body: { identifier: identifier.trim(), password }, auth: false }));
  }, [begin]);

  /** Sign in with a Google ID token. A new person must have accepted the terms; the server says so with GOOGLE_NEEDS_SIGNUP. */
  const loginWithGoogle = useCallback(async (credential, acceptedTerms = false) => {
    const data = await api('/auth/google', { method: 'POST', body: { credential, ...(acceptedTerms ? { acceptedTerms: true } : {}) }, auth: false });
    await begin(data);
    return { created: !!data.created };
  }, [begin]);

  const logout = useCallback(async () => {
    await Promise.all([flushSoon(2500), flushChanges(2500)]);
    try { await api('/auth/logout', { method: 'POST', body: { refreshToken: refreshToken() }, auth: false }); } catch { /* the device forgets it either way */ }
    await clearReminders(); clearWidget(); forgetGoogle(); await wipeCache(); AsyncStorage.removeItem(ME).catch(() => {});
    await clearTokens(); signedOut();
  }, [signedOut]);

  const refreshUser = useCallback(async () => {
    const { user } = await api('/auth/me');
    if (user) setState(s => ({ ...s, user }));
  }, []);

  const value = useMemo(() => ({ ...state, login, loginWithGoogle, logout, refreshUser, discard: async () => { await discardQueue(); await discardAll(); } }), [state, login, loginWithGoogle, logout, refreshUser]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
