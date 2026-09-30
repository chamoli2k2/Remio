import React from 'react';
import { createRoot, hydrateRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { Toaster } from 'sonner';
import { demoReady } from './services/api';
import { AppProvider } from './hooks/useApp';
import { browserStore } from './services/store';
import { useTheme } from './hooks/useTheme';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import '@fontsource-variable/dm-sans';
import '@fontsource-variable/manrope';
import './styles.css';
function ThemedToaster() { const { theme } = useTheme(); return <Toaster position="bottom-right" richColors theme={theme}/>; }
// A real build resolves this immediately; a demo build waits for its fixtures, which `imageUrl`
// reads synchronously during the very first render.
await demoReady;
// The app got this far, so whatever chunk failed last time is loading now. Clearing the mark lets
// a future deploy recover the same way instead of being told it has already had its one reload.
try { sessionStorage.removeItem('remio:chunk-reload'); } catch { /* no storage, nothing to clear */ }

/**
 * What the server rendered, if it rendered anything.
 *
 * Public pages are sent as finished HTML with the data behind them attached, so the app adopts that
 * data as its cache and hydrates — claiming the existing markup instead of replacing it. Everything
 * else, including every signed-in page, is served as an empty shell and mounted the usual way.
 *
 * The session is read from the same payload rather than fetched, which is what keeps the boot
 * screen off a page the server has already drawn.
 */
const boot = window.__APP_BOOT__;
delete window.__APP_BOOT__;
if (boot?.data) browserStore.hydrate(boot.data);

const root = document.getElementById('root');
const tree = <React.StrictMode><ErrorBoundary><BrowserRouter>
  <AppProvider {...(boot ? { initialUser: boot.user ?? null, initialConfig: boot.config } : {})}>
    <App/><ThemedToaster/>
  </AppProvider>
</BrowserRouter></ErrorBoundary></React.StrictMode>;

/**
 * Kept on the window rather than shown to anybody.
 *
 * A mismatch is a developer's problem: the page recovers on its own, so a toast would be reporting
 * a fault nobody can act on to the one person who cannot. Recording it here means it can be read
 * from the console on a page that feels wrong, and counted from an end-to-end test.
 */
const hydrationIssues = [];
function reportHydrationIssue(error, info) {
  hydrationIssues.push({ message: error?.message || String(error), componentStack: info?.componentStack || '' });
  window.__hydrationIssues = hydrationIssues;
}

/**
 * Hydration problems are reported rather than swallowed.
 *
 * When the markup the server sent does not match what the browser would have drawn, React quietly
 * throws that subtree away and re-renders it. The page still looks right, which is exactly why this
 * is worth knowing about: the symptom is a slower first paint and occasionally a flash of the wrong
 * thing, with nothing in the logs. Anything caught here means a component reached a different
 * conclusion on the server than in the browser — usually something reading the clock, a random
 * value, or storage during its first render.
 */
if (boot?.rendered) {
  hydrateRoot(root, tree, {
    onRecoverableError: (error, info) => {
      reportHydrationIssue(error, info);
      if (import.meta.env.DEV) console.warn('recovered from a server-rendering mismatch', error, info);
    },
  });
} else {
  createRoot(root).render(tree);
}

// What makes the app installable and able to open with no connection. Only from a build: the worker
// is generated from the emitted filenames, and in development there are none. Registered after load
// so fetching it never competes with the app's own first paint, and failure is ignored because an
// app that cannot cache itself still works.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}
