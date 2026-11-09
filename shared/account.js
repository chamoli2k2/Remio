import { BRAND } from './brand.js';
export const ACCOUNTS = ['normal', 'premium', 'admin', 'superadmin'];
const DAY = 86400000;

/**
 * Purchasable plans. Every one of them runs for a fixed number of days; anything with no end date
 * is either staff or somebody who bought a plan we no longer sell, which the date maths below
 * still honours.
 *
 * What each one costs is not here, because it depends on where the buyer is: see premiumPrice in
 * shared/pricing.js. A plan is how long you get, not how much you pay.
 */
export const PREMIUM_PLANS = [
  { id: 'monthly', label: 'Monthly', days: 30, blurb: 'Try the full toolkit for a month.' },
  { id: 'quarterly', label: 'Quarterly', days: 90, blurb: 'Three months for the price of two and a half.' },
  { id: 'halfyearly', label: 'Half-yearly', days: 180, blurb: 'Half a year, at a quarter off the monthly rate.' },
  { id: 'yearly', label: 'Yearly', days: 365, blurb: `The best value if ${BRAND.name} is part of your routine.` },
];
export const PLAN_IDS = PREMIUM_PLANS.map(p => p.id);
export const planById = id => PREMIUM_PLANS.find(p => p.id === id) || null;

/** A subscription with no end date never lapses; staff roles are never gated on one. */
export const premiumExpired = (user, now = Date.now()) => !!user?.premiumExpiresAt && new Date(user.premiumExpiresAt).getTime() <= now;
export const hasDashboard = user => ['admin', 'superadmin'].includes(user?.account || 'normal');
export const isSuperadmin = user => (user?.account || 'normal') === 'superadmin';
export function hasPremium(user, now = Date.now()) {
  const account = user?.account || 'normal';
  if (hasDashboard(user)) return true;
  return account === 'premium' && !premiumExpired(user, now);
}
/** Whole days remaining, or null when the subscription has no end date. Negative once lapsed. */
export function premiumDaysLeft(user, now = Date.now()) {
  if (!user?.premiumExpiresAt) return null;
  return Math.ceil((new Date(user.premiumExpiresAt).getTime() - now) / DAY);
}
/** Granting a plan extends an unexpired subscription instead of truncating it. */
export function premiumExpiryAfter(user, plan, now = Date.now()) {
  if (!plan || plan.days == null) return null;
  const current = user?.premiumExpiresAt ? new Date(user.premiumExpiresAt).getTime() : 0;
  return new Date(Math.max(now, current) + plan.days * DAY);
}

/** superadmin > admin > premium > normal. Anything unrecognised ranks as a normal account. */
export const RANK = { normal: 0, premium: 1, admin: 2, superadmin: 3 };
export const rankOf = user => RANK[user?.account || 'normal'] ?? 0;
/**
 * Whether `actor`, as staff, may act on `target`'s account at all (change a role, settle a payment,
 * cut off a connection). Only somebody of strictly higher rank may; a superadmin is the exception
 * for their peers, because somebody has to be able to demote one, but never for themselves here.
 */
export function mayActOn(actor, target) {
  if (!actor || !target) return false;
  if (isSuperadmin(actor)) return true;
  return hasDashboard(actor) && rankOf(actor) > rankOf(target);
}

/** Admin may set normal/premium. Superadmin may set any role. Nobody may change their own role here. */
export function canAssign(actor, target, next) {
  if (!ACCOUNTS.includes(next)) return false;
  if (!actor || !target) return false;
  if (String(actor.id || actor._id) === String(target.id || target._id)) return false;
  if (isSuperadmin(actor)) return true;
  if (actor.account !== 'admin') return false;
  // Only below an admin's own rank, in both directions: who they touch and what they hand out.
  return mayActOn(actor, target) && RANK[next] < RANK.admin;
}

export const PREMIUM_FEATURES = [
  { id: 'projects', label: 'Projects', detail: 'Group folders into projects you can reopen later.' },
  { id: 'quiz', label: 'Host live quizzes', detail: 'Start a multiplayer room from any folder. Anyone can still join with a code.' },
  { id: 'import', label: 'Import cards', detail: 'Bring in Anki, CSV, Markdown, or JSON decks.' },
  { id: 'export', label: 'Export cards', detail: 'Download a folder as JSON or CSV.' },
  { id: 'thumbnail', label: 'Folder covers', detail: 'Upload a thumbnail for a collection.' },
  { id: 'editors', label: 'Invite editors', detail: 'Give someone write access so you can co-edit in real time. Viewers stay free.' },
];
