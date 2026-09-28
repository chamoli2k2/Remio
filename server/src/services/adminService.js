import { User, PremiumOrder, Review } from '../models/index.js';
import { canAssign, ACCOUNTS, planById, premiumDaysLeft, hasPremium } from '../../../shared/account.js';
import { fulfilOrder } from './premiumService.js';
import { countryByName, HOME_COUNTRY } from '../../../shared/countries.js';
import { sellsInCountry } from '../../../shared/pricing.js';
import { assert } from '../utils/errors.js';

const publicAdmin = u => ({
  id: u.id, username: u.username, name: u.name, email: u.email,
  account: u.account || 'normal', createdAt: u.createdAt,
  plan: u.premiumPlan || '', planLabel: planById(u.premiumPlan)?.label || '',
  expiresAt: u.premiumExpiresAt || null, daysLeft: premiumDaysLeft(u), premiumActive: hasPremium(u),
});

export async function listUsers(q) {
  const filter = {};
  if (q) {
    const rx = new RegExp(String(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ username: rx }, { name: rx }, { email: rx }];
  }
  const users = await User.find(filter).select('+email name username account premiumPlan premiumExpiresAt createdAt').sort({ createdAt: -1 }).limit(100);
  return users.map(publicAdmin);
}

/**
 * Where the app is actually being used, one row per country.
 *
 * Registrations alone are a poor answer — someone who signed up and left counts the same as someone
 * studying nightly — so accounts are reported next to how many of them reviewed a card inside the
 * window, and the review count itself. Anyone can register from anywhere, so this is the evidence
 * for which market to open Premium in next: look for a country with people studying in it and
 * `sellable` false.
 *
 * Countries are grouped by the same fallback the pricing uses, so accounts predating the field are
 * counted as India rather than dropped into a nameless bucket.
 */
export async function countryUsage(days = 30) {
  const since = new Date(Date.now() - days * 86400000);
  const home = { $ifNull: ['$country', HOME_COUNTRY] };
  const [accounts, active] = await Promise.all([
    User.aggregate([{ $group: {
      _id: home,
      accounts: { $sum: 1 },
      // Bought, not granted: a paid window that has not run out yet. Staff roles carry the features
      // without anyone having paid for them, and counting those would flatter every total.
      premium: { $sum: { $cond: [{ $gt: ['$premiumExpiresAt', new Date()] }, 1, 0] } },
      joined: { $max: '$createdAt' },
    } }]),
    // Studying is the signal, so this starts from reviews and finds the people behind them, rather
    // than starting from accounts and asking each whether it has been used.
    Review.aggregate([
      { $match: { createdAt: { $gte: since } } },
      { $group: { _id: '$user', reviews: { $sum: 1 } } },
      { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'person' } },
      { $unwind: '$person' },
      { $group: { _id: { $ifNull: ['$person.country', HOME_COUNTRY] }, studying: { $sum: 1 }, reviews: { $sum: '$reviews' } } },
    ]),
  ]);
  const studied = new Map(active.map(a => [a._id, a]));
  const rows = accounts.map(a => ({
    country: a._id,
    code: countryByName(a._id)?.code || '',
    accounts: a.accounts,
    premium: a.premium,
    studying: studied.get(a._id)?.studying || 0,
    reviews: studied.get(a._id)?.reviews || 0,
    sellable: sellsInCountry(a._id),
    joined: a.joined || null,
  })).sort((x, y) => y.studying - x.studying || y.accounts - x.accounts || x.country.localeCompare(y.country));
  const sum = (key, of = rows) => of.reduce((n, r) => n + r[key], 0);
  const waiting = rows.filter(r => !r.sellable && r.studying > 0);
  return {
    days,
    rows,
    totals: {
      countries: rows.length,
      accounts: sum('accounts'),
      studying: sum('studying'),
      premium: sum('premium'),
      // The size of the market that is being used but cannot be charged, which is the number worth
      // watching: it is the argument for opening the next country.
      unsellableStudying: sum('studying', waiting),
      unsellableCountries: waiting.length,
    },
  };
}

export async function setAccount(actor, userId, account) {
  assert(ACCOUNTS.includes(account), 400, 'Unknown account type.');
  const target = await User.findById(userId).select('+email');
  assert(target, 404, 'User not found.');
  assert(canAssign(actor, target, account), 403, 'You cannot change that account.');
  if (target.account === 'superadmin' && account !== 'superadmin') {
    const left = await User.countDocuments({ account: 'superadmin', _id: { $ne: target.id } });
    assert(left >= 1, 400, 'Keep at least one Superadmin.');
  }
  // A role granted by hand carries no end date; moving someone off Premium clears the subscription.
  target.account = account;
  if (account !== 'premium') { target.premiumPlan = ''; target.premiumExpiresAt = null; }
  await target.save();
  return publicAdmin(target);
}

export async function listOrders(status) {
  const filter = status ? { status } : {};
  const rows = await PremiumOrder.find(filter).sort({ createdAt: -1 }).limit(80).populate('user', 'name username account');
  // Only a manual order has a screenshot to review; a gateway order carries its payment id instead.
  return rows.map(o => ({ ...o.toJSON(), hasProof: o.method === 'manual', proofUrl: o.method === 'manual' ? `/api/premium/orders/${o.id}/proof` : null }));
}

/** Approving by hand and a verified gateway payment converge on the same fulfilment. */
export async function decideOrder(actor, orderId, status) {
  assert(['approved', 'declined'].includes(status), 400, 'Use approved or declined.');
  const { order, alreadySettled } = await fulfilOrder(orderId, status, { actor });
  assert(!alreadySettled, 404, 'No pending order.');
  return order;
}
