import { createHash } from 'node:crypto';
import { storageKeys } from './brand.js';

/**
 * The theme, chosen before the first pixel is drawn.
 *
 * This has to run ahead of rendering or a dark-mode visitor gets a white flash, which means it
 * blocks the page whatever shape it takes. It used to be a separate file, so blocking also meant a
 * round trip: the browser parsed the HTML, asked for 600 bytes, and waited. Inlined, it costs the
 * bytes and nothing else.
 *
 * Inline scripts need the Content-Security-Policy's permission, and rather than weakening the
 * policy with 'unsafe-inline' the exact hash is exported below and handed to helmet. Because both
 * the HTML and the policy are generated from this one string, they cannot drift apart: change the
 * script and the hash changes with it.
 *
 * Node-only, because of the crypto import. Never import this from client code.
 */
export const themeScript = `(function(){var k=${JSON.stringify(storageKeys('theme'))};try{var s=null;for(var i=0;i<k.length&&s===null;i++)s=localStorage.getItem(k[i]);document.documentElement.dataset.theme=(s==='dark'||(s!=='light'&&matchMedia('(prefers-color-scheme: dark)').matches))?'dark':'light'}catch(e){document.documentElement.dataset.theme='light'}})();`;

/** Quoted and ready to drop into a script-src list. */
export const themeScriptHash = `'sha256-${createHash('sha256').update(themeScript).digest('base64')}'`;
