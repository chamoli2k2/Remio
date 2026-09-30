import DOMPurify from 'dompurify';

/**
 * The one place card text is sanitised, and the one place that knows sanitising needs a DOM.
 *
 * ── Why this indirection exists ────────────────────────────────────────────────────────────────
 *
 * DOMPurify works by parsing HTML into a document and walking it, so with no `window` it has
 * nothing to parse with. What it does then is the dangerous part: `isSupported` goes false and
 * `sanitize` returns its input **unchanged**. Rendering a card on the server would therefore put
 * whatever a user wrote into the page verbatim — stored cross-site scripting, arrived at by
 * calling the sanitiser correctly.
 *
 * So the sanitiser is never used directly. In a browser it is DOMPurify bound to the real document.
 * On the server, the entry point installs one backed by jsdom before it renders anything, and until
 * it does, `sanitize` refuses rather than passing HTML through. Refusing is the only safe default:
 * a missing sanitiser has to be a broken page, never a quiet hole.
 */
const PURIFY = { ADD_ATTR: ['target', 'rel'], FORBID_TAGS: ['style', 'script', 'iframe', 'object', 'embed', 'form', 'input'] };

/**
 * Links are restricted here rather than by tightening `ALLOWED_URI_REGEXP`, which is applied to
 * every attribute value — KaTeX's `d` and `viewBox` among them — and would mangle rendered maths.
 */
function harden(instance) {
  instance.addHook('afterSanitizeAttributes', node => {
    if (node.tagName !== 'A') return;
    if (!/^(?:https?:|mailto:|#)/i.test(node.getAttribute('href') || '')) node.removeAttribute('href');
    node.setAttribute('target', '_blank'); node.setAttribute('rel', 'noopener noreferrer');
  });
  return instance;
}

let instance = DOMPurify.isSupported ? harden(DOMPurify) : null;

/** Called once by the server entry, with DOMPurify bound to a jsdom window. */
export function useSanitizer(create) {
  instance = harden(create(DOMPurify));
}

export function sanitize(html) {
  if (!instance) throw new Error('No HTML sanitiser is available, so this content cannot be rendered safely.');
  return instance.sanitize(html, PURIFY);
}
