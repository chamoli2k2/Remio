import { hasDashboard, hasPremium, isSuperadmin } from '../../../shared/account.js';
import { assert } from '../utils/errors.js';

export const requirePremium = (req, _res, next) => {
  try { assert(hasPremium(req.user), 402, 'This is a Premium feature. Upgrade to continue.', 'PREMIUM_REQUIRED'); next(); }
  catch (e) { next(e); }
};

/**
 * Guards anything where reaching the person afterwards matters. Signing up with somebody else's
 * address is free, so before money changes hands the address has to be proven: a receipt, a refund,
 * or a dispute all need to land with the person who actually paid.
 */
export const requireVerifiedEmail = (req, _res, next) => {
  try {
    assert(req.user?.emailVerifiedAt, 403, 'Please confirm your email address first. You can send yourself a link from Settings.', 'EMAIL_UNVERIFIED');
    next();
  } catch (e) { next(e); }
};

export const requireDashboard = (req, _res, next) => {
  try { assert(hasDashboard(req.user), 403, 'This dashboard is for admins.'); next(); }
  catch (e) { next(e); }
};

/**
 * A narrower gate than the dashboard, for the things that change the product rather than run it.
 *
 * An admin approves payments and moves people between roles, which is daily work. Rewriting a price
 * or closing signups is not, and the difference between the two is worth a separate check: an admin
 * account is handed out more freely, and this way one of them cannot make Premium free by accident.
 */
export const requireSuperadmin = (req, _res, next) => {
  try { assert(isSuperadmin(req.user), 403, 'Only a superadmin can change configuration.', 'SUPERADMIN_REQUIRED'); next(); }
  catch (e) { next(e); }
};
