import { createHash } from 'node:crypto';

/**
 * Starts the two requests every page waits on, before the app's JavaScript has even downloaded.
 *
 * The app cannot show anything but a spinner until it knows who is signed in and what the prices
 * are. Left to the app, those requests begin only after the HTML, then the script, then its
 * parsing: three steps in a row. Started here they run alongside the script download, so the
 * answers are usually waiting by the time the app asks. `api.js` picks the pending response up,
 * once, and falls back to a normal request if it is not there.
 *
 * Skipped when the server already rendered the page (the root has markup in it): such a page
 * needs no session, and the app re-reads only the configuration.
 *
 * Inline, and named by hash in the Content-Security-Policy exactly as the theme script is.
 * Node-only, because of the crypto import. Never import this from client code.
 */
export const earlyScript = `(function(){var r=document.getElementById('root');if(!r||r.hasChildNodes()||!window.fetch)return;var e=window.__early={};['/auth/me','/config'].forEach(function(p){try{e[p]=fetch('/api'+p,{credentials:'include'}).catch(function(){return null})}catch(_){}})})();`;

export const earlyScriptHash = `'sha256-${createHash('sha256').update(earlyScript).digest('base64')}'`;
