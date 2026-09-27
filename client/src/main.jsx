import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { Toaster } from 'sonner';
import { AppProvider } from './hooks/useApp';
import { useTheme } from './hooks/useTheme';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import '@fontsource-variable/dm-sans';
import '@fontsource-variable/manrope';
import './styles.css';
function ThemedToaster() { const { theme } = useTheme(); return <Toaster position="bottom-right" richColors theme={theme}/>; }
createRoot(document.getElementById('root')).render(<React.StrictMode><ErrorBoundary><BrowserRouter><AppProvider><App/><ThemedToaster/></AppProvider></BrowserRouter></ErrorBoundary></React.StrictMode>);
// What makes the app installable and able to open with no connection. Only from a build: the worker
// is generated from the emitted filenames, and in development there are none. Registered after load
// so fetching it never competes with the app's own first paint, and failure is ignored because an
// app that cannot cache itself still works.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}
