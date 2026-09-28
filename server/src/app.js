import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import path from 'node:path';
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
export function createApp() {
  const app = express(); app.disable('x-powered-by'); if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);
  app.use(requestContext);
  const origins = trustedOrigins();
  // connect-src includes ws(s) so the same-origin Socket.IO connection is allowed by CSP in every browser.
  // The gateway's checkout runs in its own script and iframe, so it only widens the policy when configured.
  const gateway = razorpayConfigured() ? ['https://checkout.razorpay.com', 'https://api.razorpay.com'] : [];
  // The theme script is inlined into the HTML to save a blocking round trip, so the policy names
  // its hash rather than opening up inline scripts generally. HSTS is a year with subdomains, which
  // is what lets the domain be preloaded; harmless locally because browsers ignore it off HTTPS.
  app.use(helmet({
    strictTransportSecurity: { maxAge: 31536000, includeSubDomains: true, preload: true },
    contentSecurityPolicy: { directives: { "img-src": ["'self'", 'blob:', 'data:', ...(gateway.length ? ['https:'] : [])], "script-src": ["'self'", themeScriptHash, jsonLdHash, ...gateway], "style-src": ["'self'", "'unsafe-inline'"], "frame-src": ["'self'", ...gateway], "connect-src": ["'self'", 'ws:', 'wss:', ...origins, ...gateway] } },
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
  app.use(express.static(dist)); app.get('/{*path}', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  app.use(errorHandler);
  return app;
}
