import { setting } from '../services/settingsService.js';
import { assert } from '../utils/errors.js';

/**
 * The guards that read their answer from configuration rather than from code.
 *
 * Each one exists so an operator can close something in a hurry without waiting for a deploy: a
 * signup form being abused, an import that is melting the database, a migration that needs the
 * writes to stop. They refuse with an explanation rather than a bare 403, because the person who
 * hits one is usually a customer who has done nothing wrong.
 */

/** A feature switched off in the dashboard, refused with something a user can act on. */
const gate = (key, message, code) => (_req, _res, next) => {
  try { assert(setting(key), 503, message, code); next(); } catch (e) { next(e); }
};

export const requireSignupOpen = gate('signup.open',
  'New accounts are paused for the moment. Try again shortly, or write to us if you were expecting an invitation.', 'SIGNUP_CLOSED');

export const requireImports = gate('imports.enabled',
  'Importing is switched off for the moment. Your existing cards are untouched.', 'IMPORTS_OFF');

export const requireQuiz = gate('quiz.enabled',
  'Live quizzes are switched off for the moment.', 'QUIZ_OFF');

/**
 * Read-only mode: everything can be read, nothing written.
 *
 * Two carve-outs, both necessary. Signing in and out still work, because locking an operator out of
 * their own dashboard during a migration would be a cruel way to learn this lesson. And the admin
 * routes stay open, because the switch that turns this off lives behind them — without that
 * exception the only way back is a redeploy, which defeats the point of a runtime switch.
 */
const WRITE_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'];
const ALWAYS_ALLOWED = [/^\/admin\b/, /^\/auth\/(login|logout)$/];

export const readOnlyGuard = (req, _res, next) => {
  if (!setting('maintenance.readOnly')) return next();
  if (!WRITE_METHODS.includes(req.method)) return next();
  if (ALWAYS_ALLOWED.some(rx => rx.test(req.path))) return next();
  try {
    assert(false, 503, 'We have paused changes for a few minutes while we work on something. Everything you have is safe and still readable.', 'READ_ONLY');
  } catch (e) { next(e); }
};

/** Whether the public explore listing may be read without signing in. */
export const exploreIsPublic = () => setting('explore.public');
