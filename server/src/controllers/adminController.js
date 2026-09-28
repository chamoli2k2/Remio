import * as admin from '../services/adminService.js';
import * as account from '../services/accountService.js';
export const users = async (req, res) => res.json({ users: await admin.listUsers(req.query.q) });
export const setAccount = async (req, res) => res.json({ user: await admin.setAccount(req.user, req.params.id, req.body.account) });
// Capped so a hand-typed window cannot ask for an aggregation over all of history.
export const countries = async (req, res) => res.json(await admin.countryUsage(Math.min(Math.max(Number(req.query.days) || 30, 1), 365)));
/** Superadmin only, which the route enforces; every other guard lives in the service. */
export const deleteUser = async (req, res) => res.json(await account.deleteAccountAsAdmin(req.user, req.params.id, req.body));
export const orders = async (req, res) => res.json({ orders: await admin.listOrders(req.query.status) });
export const decide = async (req, res) => res.json({ order: await admin.decideOrder(req.user, req.params.id, req.body.status) });

/**
 * Every panel in one response.
 *
 * One request rather than five because they are read together, always, and five parallel
 * aggregations from one handler is cheaper than five round trips each doing one.
 */
export const analytics = async (req, res) => res.json(await admin.analytics({
  days: Math.min(Math.max(Number(req.query.days) || 30, 1), 365),
  weeks: Math.min(Math.max(Number(req.query.weeks) || 8, 1), 26),
}));
