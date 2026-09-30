import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import routes from './routes/index.js';
import healthRoutes from './routes/health.js';
import agentRoutes from './routes/agent.js';
import { optionalAuth, sessionToken } from './middleware/auth.js';
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
import { renderPage, applyRender } from './services/ssr.js';
export function createApp() {
  const app = express(); app.disable('x-powered-by'); if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);
  app.use(requestContext);
  const origins = trustedOrigins();
  // connect-src includes ws(s) so the same-origin Socket.IO connection is allowed by CSP in every browser.
  // The gateway's checkout runs in its own script and iframe, so it only widens the policy when configured.
  const gateway = razorpayConfigured() ? ['https://checkout.razorpay.com', 'https://api.razorpay.com'] : [];
  const googleAuth = googleConfigured() ? ['https://accounts.google.com', 'https://gsi.google.com'] : [];
  const media = storageConfigured() ? ['https://*.r2.cloudflarestorage.com'] : [];

  /**
   * The ad network, and only while ads are enabled.
   *
   * This is the widest thing in the policy and there is no honest way to narrow it much: an ad
   * creative is arbitrary third-party markup, so images and frames have to be broadly allowed.
   * That is the cost of the feature, which is a good reason for the master switch to be a switch.
   */
  const adNetwork = setting('ads.enabled') && setting('ads.publisherId')
    ? ['https://pagead2.googlesyndication.com', 'https://googleads.g.doubleclick.net', 'https://tpc.googlesyndication.com', 'https://www.google.com', 'https://adservice.google.com']
    : [];
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
    contentSecurityPolicy: { directives: { "img-src": ["'self'", 'blob:', 'data:', ...media, ...(adNetwork.length ? ['https:'] : []), ...(gateway.length ? ['https:'] : [])], "script-src": ["'self'", themeScriptHash, jsonLdHash, ...gateway, ...googleAuth, ...adNetwork], "style-src": ["'self'", "'unsafe-inline'", ...googleAuth], "frame-src": ["'self'", ...gateway, ...googleAuth, ...adNetwork], "connect-src": ["'self'", 'ws:', 'wss:', ...origins, ...gateway, ...googleAuth, ...adNetwork] } },
  }));
  /**
   * The assistant endpoints, ahead of both the cross-origin policy and the JSON parser.
   *
   * Ahead of `cors` because they set their own, and two policies on one response produce two
   * `Access-Control-Allow-Origin` headers, which every browser treats as no policy at all. Theirs
   * can be open where this one cannot, because they authenticate with a bearer token rather than
   * a cookie: there is no credential a browser would attach on its own, so there is nothing for
   * another site to borrow.
   *
   * Ahead of `express.json` because the limit below is sized for a form, and a batch of cards is
   * legitimately larger. The router parses its own body at its own limit.
   */
  app.use(agentRoutes);
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
  /**
   * `index: false` matters more than it looks.
   *
   * Left on, this handler answers a request for `/` with dist/index.html directly — so the home
   * page never reached the handler below, and was the one page served without its own title,
   * description or canonical link, and now without being pre-rendered either. Turning it off makes
   * `/` fall through to the app handler like every other route.
   */
  app.use(express.static(dist, { index: false }));
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
  const root = path.dirname(dist);
  let shell = null;
  app.get('/{*path}', asyncHandler(async (req, res) => {
    if (shell === null) shell = await readFile(shellPath, 'utf8').catch(() => '');
    // No build on disk is a development server, where Vite serves the app instead.
    if (!shell) return res.sendFile(shellPath);
    const page = applyMeta(shell, await metaFor(req.path));

    /**
     * A public page is sent with its content already rendered into it; everything else is sent as
     * the shell and drawn in the browser.
     *
     * The session is read from the cookie rather than looked up, because this only needs to know
     * whether to decline. A cookie that turns out to be invalid costs that request its
     * pre-rendering and nothing else, which is a better trade than a database round trip on the
     * path that serves every page.
     *
     * Only the rendered ones say they are cacheable by anything shared. They are identical for
     * every signed-out visitor by construction — that is the same property the render cache relies
     * on — whereas the shell is the entry point to somebody's account.
     */
    const rendered = await renderPage({ root, pathname: req.path, signedIn: !!sessionToken(req) });
    if (!rendered) return res.type('html').send(page);
    res.type('html').set('Cache-Control', 'public, max-age=0, s-maxage=60, stale-while-revalidate=600');
    res.send(applyRender(page, rendered));
  }));
  app.use(errorHandler);
  return app;
}
