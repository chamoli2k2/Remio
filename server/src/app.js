import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import routes from './routes/index.js';
import healthRoutes from './routes/health.js';
import { optionalAuth } from './middleware/auth.js';
import { requestContext, notFoundHandler, errorHandler } from './middleware/errorHandler.js';
import { webhook as premiumWebhook } from './controllers/premiumController.js';
import { isConfigured as razorpayConfigured } from './services/payments/razorpay.js';
import { asyncHandler } from './utils/errors.js';
export { trustedOrigins } from './utils/origin.js';
import { trustedOrigins } from './utils/origin.js';
import { readOnlyGuard } from './middleware/config.js';
import { throttle } from './middleware/throttle.js';
import { setting } from './services/settingsService.js';
import { themeScriptHash } from '../../shared/themeScript.js';
import { jsonLdHash } from '../../shared/seo.js';
import { isConfigured as googleConfigured } from './services/auth/googleToken.js';
import { isConfigured as storageConfigured } from './services/storage.js';
import { metaFor, applyMeta, sitemap } from './services/pageMeta.js';
export function createApp() {
  const app = express(); app.disable('x-powered-by'); if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);
  app.use(requestContext);
  const origins = trustedOrigins();
  // connect-src includes ws(s) so the same-origin Socket.IO connection is allowed by CSP in every browser.
  // The gateway's checkout runs in its own script and iframe, so it only widens the policy when configured.
  const gateway = razorpayConfigured() ? ['https://checkout.razorpay.com', 'https://api.razorpay.com'] : [];
  const googleAuth = googleConfigured() ? ['https://accounts.google.com', 'https://gsi.google.com'] : [];
  const media = storageConfigured() ? ['https://*.r2.cloudflarestorage.com'] : [];
  // The theme script is inlined into the HTML to save a blocking round trip, so the policy names
  // its hash rather than opening up inline scripts generally. HSTS is a year with subdomains, which
  // is what lets the domain be preloaded; harmless locally because browsers ignore it off HTTPS.
  app.use(helmet({
    /**
     * Popups keep their handle on the page that opened them.
     *
     * helmet defaults this to `same-origin`, which cuts `window.opener` for any cross-origin
     * popup. Google's sign-in opens one, and when the person has chosen their account it posts the
     * result back through exactly that handle — so the strict policy left a blank tab and
     * "Cannot read properties of null (reading 'postMessage')".
     *
     * `same-origin-allow-popups` keeps this document isolated from anything that opens *it*, and
     * only relaxes the half that breaks sign-in.
     */
    crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
    strictTransportSecurity: { maxAge: 31536000, includeSubDomains: true, preload: true },
    contentSecurityPolicy: { directives: { "img-src": ["'self'", 'blob:', 'data:', ...media, ...(gateway.length ? ['https:'] : [])], "script-src": ["'self'", themeScriptHash, jsonLdHash, ...gateway, ...googleAuth], "style-src": ["'self'", "'unsafe-inline'", ...googleAuth], "frame-src": ["'self'", ...gateway, ...googleAuth], "connect-src": ["'self'", 'ws:', 'wss:', ...origins, ...gateway, ...googleAuth] } },
  }));
  app.use(cors({ origin: origins, credentials: true }));
  // `limit` is a function because the value behind it changes while the process is running.
  app.use('/api', throttle({ windowMs: 60000, limit: () => setting('throttle.apiPerMinute') }));
  // CSRF guard for writes. Same-origin requests (Origin host === Host header) are always allowed, so the standard
  // single-service deployment needs no CLIENT_ORIGIN; the allow-list is for separately hosted frontends.
  const sameOrigin = req => { try { return req.headers.origin && new URL(req.headers.origin).host === req.headers.host; } catch { return false; } };
  const trustedOrigin = req => !req.headers.origin || origins.includes(req.headers.origin) || sameOrigin(req);
  app.use('/api', (req, res, next) => { res.set('Cache-Control', 'no-store'); if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && (!trustedOrigin(req) || req.headers['sec-fetch-site'] === 'cross-site')) return res.status(403).json({ error: 'Request origin is not allowed.' }); next(); });
  app.use('/api', healthRoutes);
  // The gateway signs the exact bytes it sent, so this one route has to see them before any parser does.
  app.post('/api/premium/webhook/razorpay', express.raw({ type: '*/*', limit: '64kb' }), asyncHandler(premiumWebhook));
  app.use(express.json({ limit: '256kb' })); app.use(cookieParser()); app.use('/api', optionalAuth, readOnlyGuard, routes);
  app.use('/api', notFoundHandler);
  const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..', 'dist');
  // Ahead of the static handler, because this one knows what has been published and a file written
  // at build time cannot.
  app.get('/sitemap.xml', asyncHandler(async (_req, res) => {
    res.type('application/xml').set('Cache-Control', 'public, max-age=3600').send(await sitemap());
  }));
  app.use(express.static(dist));
  /**
   * A build asset that is not there is a 404, not the app.
   *
   * Everything under /assets carries a content hash, so a request for one that does not exist can
   * only mean the caller is working from a different build — a tab left open across a deploy, most
   * often. Letting that fall through to the catch-all answered a request for JavaScript with HTML,
   * which the browser reports as "Expected a JavaScript module but the server responded with a MIME
   * type of text/html": a confusing way to say 404, and one that hides the actual cause.
   */
  app.use('/assets', (_req, res) => res.status(404).type('text/plain').send('Not found'));

  /**
   * A request that looks like a file, and is not one, is a 404.
   *
   * Crawlers probe for conventions we do not ship — `/favicon.ico` above all, which browsers and
   * Google ask for at the root whatever the HTML says. Falling through to the app meant answering
   * "where is your icon" with a page of HTML and a 200, and Google cannot read HTML as an image,
   * so it drew the grey globe instead of our logo. A 404 sends it to the `<link rel="icon">` tags.
   *
   * Only the last segment is tested for a dot, because no route in this app has one: usernames are
   * letters, numbers and underscores, and ids are hexadecimal.
   */
  app.get('/{*path}', (req, res, next) => {
    const last = req.path.split('/').pop() || '';
    if (!last.includes('.')) return next();
    res.status(404).type('text/plain').send('Not found');
  });

  /**
   * The app shell, with this route's own title and description written into it.
   *
   * Read once and held, because it is sent on every page load and re-reading it per request would
   * be a disk hit to produce a string that never changes. Only the handful of meta tags differ,
   * and those are substituted per request.
   */
  const shellPath = path.join(dist, 'index.html');
  let shell = null;
  app.get('/{*path}', asyncHandler(async (req, res) => {
    if (shell === null) shell = await readFile(shellPath, 'utf8').catch(() => '');
    // No build on disk is a development server, where Vite serves the app instead.
    if (!shell) return res.sendFile(shellPath);
    res.type('html').send(applyMeta(shell, await metaFor(req.path)));
  }));
  app.use(errorHandler);
  return app;
}
