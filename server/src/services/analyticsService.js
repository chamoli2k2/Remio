import mongoose from 'mongoose';
import { User, Card, Review, Folder, PremiumOrder, DomainEvent } from '../models/index.js';
import { minorUnitsIn } from '../../../shared/pricing.js';
import { planById } from '../../../shared/account.js';

const DAY = 86400000;
const WEEK = 7 * DAY;
const startOfUtcDay = d => { const s = new Date(d); s.setUTCHours(0, 0, 0, 0); return s; };
// Days are bucketed in UTC everywhere below, so a window starts at a day boundary rather than at
// whatever time of day the request happened to arrive. Otherwise the first and last buckets of
// every chart are partial days and read as a dip that is not there.
const startOfUtcWeek = d => { const s = startOfUtcDay(d); return new Date(s.getTime() - ((s.getUTCDay() + 6) % 7) * DAY); };
const dayKey = d => d.toISOString().slice(0, 10);
/** The key Mongo's `%G-%V` produces, so cohorts named in JavaScript line up with cohorts grouped in the pipeline. */
const isoWeekKey = d => {
  const t = startOfUtcDay(d);
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7)); // the Thursday inside the week decides its ISO year
  const year = t.getUTCFullYear();
  return `${year}-${String(Math.ceil(((t - Date.UTC(year, 0, 1)) / DAY + 1) / 7)).padStart(2, '0')}`;
};

// Every window argument arrives from a query string, so it is clamped rather than trusted: an
// unbounded `days` is a full collection scan anyone can ask for.
const clamp = (n, lo, hi, fallback) => { const v = Math.floor(Number(n)); return Number.isFinite(v) ? Math.min(Math.max(v, lo), hi) : fallback; };
const windowDays = days => clamp(days, 1, 365, 30);
const windowWeeks = weeks => clamp(weeks, 1, 26, 8);
const windowStart = days => new Date(startOfUtcDay(new Date()).getTime() - (days - 1) * DAY);
const utcDay = field => ({ $dateToString: { format: '%Y-%m-%d', date: field, timezone: 'UTC' } });
const isoWeek = field => ({ $dateToString: { format: '%G-%V', date: field, timezone: 'UTC' } });
const share = (n, of) => (of ? Math.round((n / of) * 1000) / 10 : 0);
/** A continuous day series: days nobody touched still get a row, so a chart cannot silently close a gap. */
const fillDays = (since, days, rows, shape) => {
  const found = new Map(rows.map(r => [r._id, r]));
  return Array.from({ length: days }, (_, i) => {
    const date = dayKey(new Date(since.getTime() + i * DAY));
    return { date, ...shape(found.get(date)) };
  });
};

/**
 * Who arrived, and whether arriving turned into using the thing.
 *
 * A signup count on its own flatters every week, so the cohort created inside the window is also
 * measured on the two actions that separate a real account from a form submission: writing a card
 * and reviewing one. Both are counted from the card and review side and matched back to the person,
 * which is one pass over the work that exists rather than one question per account.
 */
export async function growth({ days } = {}) {
  const window = windowDays(days);
  const since = windowStart(window);
  const [daily, accounts, makers, studiers] = await Promise.all([
    User.aggregate([
      { $match: { createdAt: { $gte: since } } },
      { $group: { _id: utcDay('$createdAt'), signups: { $sum: 1 } } },
    ]),
    User.countDocuments(),
    // A card cannot predate its author, so restricting cards to the window and then checking the
    // author's join date is enough to isolate the cohort.
    Card.aggregate([
      { $match: { createdAt: { $gte: since } } },
      { $group: { _id: '$createdBy' } },
      { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'person' } },
      { $unwind: '$person' },
      { $match: { 'person.createdAt': { $gte: since } } },
      { $count: 'people' },
    ]),
    Review.aggregate([
      { $match: { createdAt: { $gte: since } } },
      { $group: { _id: '$user' } },
      { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'person' } },
      { $unwind: '$person' },
      { $match: { 'person.createdAt': { $gte: since } } },
      { $count: 'people' },
    ]),
  ]);
  const series = fillDays(since, window, daily, row => ({ signups: row?.signups || 0 }));
  const newInWindow = series.reduce((n, d) => n + d.signups, 0);
  const created = makers[0]?.people || 0;
  const reviewed = studiers[0]?.people || 0;
  return {
    days: window,
    since: dayKey(since),
    series,
    totals: { accounts, newInWindow },
    activation: {
      createdCard: created,
      createdCardPercent: share(created, newInWindow),
      reviewed,
      reviewedPercent: share(reviewed, newInWindow),
    },
  };
}

const money = (minor, currency) => Math.round((minor / minorUnitsIn(currency)) * 100) / 100;
/** One row per key, each carrying its own per-currency totals for the reason given on `revenue`. */
const breakdown = (rows, name, label = v => v) => {
  const out = new Map();
  for (const row of rows) {
    const key = row._id[name] ?? '';
    if (!out.has(key)) out.set(key, { [name]: key, label: label(key), orders: 0, revenue: [] });
    const entry = out.get(key);
    entry.orders += row.orders;
    entry.revenue.push({ currency: row._id.currency, gross: money(row.minor, row._id.currency) });
  }
  for (const entry of out.values()) entry.revenue.sort((a, b) => a.currency.localeCompare(b.currency));
  return [...out.values()].sort((a, b) => b.orders - a.orders);
};

/**
 * What was actually paid, and how much of it stalled on the way.
 *
 * `amount` is stored in the currency's minor unit and `currency` differs per order, so a single
 * `$sum` over amounts would add paise to cents and produce a number that is not money in any
 * currency. Every total here is therefore grouped by currency first and divided by that currency's
 * minor unit afterwards, and nothing is converted between currencies: there is no exchange rate in
 * the data, and inventing one would bury a guess inside a figure that reads as fact.
 *
 * Pending and declined are counted next to the approved totals because the gap between them is the
 * part an operator can do something about.
 */
export async function revenue({ days } = {}) {
  const window = windowDays(days);
  const since = windowStart(window);
  const approved = { $match: { status: 'approved' } };
  const totals = { orders: { $sum: 1 }, minor: { $sum: '$amount' } };
  const [[facets], accountsInWindow] = await Promise.all([
    PremiumOrder.aggregate([
      { $match: { createdAt: { $gte: since } } },
      { $facet: {
        byCurrency: [approved, { $group: { _id: { currency: '$currency' }, ...totals } }],
        byPlan: [approved, { $group: { _id: { plan: '$plan', currency: '$currency' }, ...totals } }],
        byCountry: [approved, { $group: { _id: { country: '$country', currency: '$currency' }, ...totals } }],
        byMethod: [approved, { $group: { _id: { method: '$method', currency: '$currency' }, ...totals } }],
        byStatus: [{ $group: { _id: '$status', orders: { $sum: 1 } } }],
      } },
    ]),
    User.countDocuments({ createdAt: { $gte: since } }),
  ]);
  const status = Object.fromEntries((facets?.byStatus || []).map(s => [s._id, s.orders]));
  const currencies = breakdown(facets?.byCurrency || [], 'currency')
    .map(row => ({ currency: row.currency, orders: row.orders, gross: row.revenue[0]?.gross || 0 }));
  const approvedOrders = currencies.reduce((n, c) => n + c.orders, 0);
  return {
    days: window,
    since: dayKey(since),
    currencies,
    byPlan: breakdown(facets?.byPlan || [], 'plan', id => planById(id)?.label || id),
    // The billing country the buyer typed at checkout, which they choose freely and which does not
    // set the price. The priced market is the country on the account, and the two disagree often
    // enough that this is a shipping-address chart rather than a market-revenue one. For the
    // latter, read the currency alongside it: that does follow the account.
    byCountry: breakdown(facets?.byCountry || [], 'country'),
    byMethod: breakdown(facets?.byMethod || [], 'method'),
    orders: { approved: approvedOrders, pending: status.pending || 0, declined: status.declined || 0 },
    // A proxy, not a funnel: the numerator and denominator are both scoped to the window, but a
    // buyer who signed up months ago still counts as a sale here. Read it as sales pressure per
    // new account, not as the share of signups who bought.
    conversion: { approvedOrders, newAccounts: accountsInWindow, percent: share(approvedOrders, accountsInWindow) },
  };
}

/**
 * How much studying is happening, and how many different people it comes from.
 *
 * Reviews and people are reported side by side because one determined learner can carry a day's
 * review count on their own. Daily, weekly and monthly active counts are distinct people with at
 * least one review in the trailing 1, 7 and `days` days; "monthly" follows the requested window, so
 * it is only a month when a month was asked for.
 */
export async function engagement({ days } = {}) {
  const window = windowDays(days);
  const since = windowStart(window);
  const today = startOfUtcDay(new Date());
  const activeSince = cutoff => [{ $match: { createdAt: { $gte: cutoff } } }, { $group: { _id: '$user' } }, { $count: 'people' }];
  const [[facets], topFolders] = await Promise.all([
    Review.aggregate([
      { $match: { createdAt: { $gte: since } } },
      { $facet: {
        daily: [{ $group: { _id: utcDay('$createdAt'), reviews: { $sum: 1 }, people: { $addToSet: '$user' } } },
          { $project: { reviews: 1, people: { $size: '$people' } } }],
        daily1: activeSince(today),
        daily7: activeSince(new Date(today.getTime() - 6 * DAY)),
        window: activeSince(since),
      } },
    ]),
    // The Folder schema keeps `copyCount` and `likeCount` counters, so the ranking reads them
    // directly instead of counting `copiedFrom` rows.
    Folder.find({ visibility: 'global', archived: false, copyCount: { $gt: 0 } })
      .select('title copyCount likeCount owner').sort({ copyCount: -1, likeCount: -1 }).limit(8)
      .populate('owner', 'name username'),
  ]);
  const series = fillDays(since, window, facets?.daily || [], row => ({ reviews: row?.reviews || 0, people: row?.people || 0 }));
  return {
    days: window,
    since: dayKey(since),
    series,
    totals: {
      reviews: series.reduce((n, d) => n + d.reviews, 0),
      daily: facets?.daily1?.[0]?.people || 0,
      weekly: facets?.daily7?.[0]?.people || 0,
      monthly: facets?.window?.[0]?.people || 0,
    },
    topFolders: topFolders.map(f => ({
      id: f.id, title: f.title, copies: f.copyCount, likes: f.likeCount,
      owner: f.owner?.username || '', ownerName: f.owner?.name || '',
    })),
  };
}

const RETENTION_WEEKS = 4;
/**
 * Whether people who sign up in a given week are still reviewing in the weeks that follow.
 *
 * Cohorts are ISO weeks of signup; the columns are weeks since that person joined, not calendar
 * weeks, so everyone in a row is measured from their own start. A cohort counts for week N if the
 * person reviewed anything at all in that week, which is the loosest definition of still being here
 * and the only one the review log can answer.
 *
 * The newest rows are necessarily incomplete — a cohort three days old has not had a week 1 yet —
 * so the trailing zeroes in the last rows mean "not yet", not "left". Sizes are returned raw and
 * percentages are left to the caller, so a cohort of four does not get shown as 25% steps.
 */
export async function retention({ weeks } = {}) {
  const window = windowWeeks(weeks);
  const now = Date.now();
  const first = new Date(startOfUtcWeek(new Date()).getTime() - (window - 1) * WEEK);
  const [sizes, active] = await Promise.all([
    User.aggregate([
      { $match: { createdAt: { $gte: first } } },
      { $group: { _id: isoWeek('$createdAt'), size: { $sum: 1 } } },
    ]),
    Review.aggregate([
      { $match: { createdAt: { $gte: first } } },
      { $lookup: { from: 'users', localField: 'user', foreignField: '_id', as: 'person' } },
      { $unwind: '$person' },
      { $match: { 'person.createdAt': { $gte: first } } },
      { $group: {
        _id: {
          cohort: isoWeek('$person.createdAt'),
          week: { $floor: { $divide: [{ $subtract: ['$createdAt', '$person.createdAt'] }, WEEK] } },
        },
        people: { $addToSet: '$user' },
      } },
      { $match: { '_id.week': { $gte: 0, $lt: RETENTION_WEEKS } } },
      { $project: { people: { $size: '$people' } } },
    ]),
  ]);
  const sized = new Map(sizes.map(s => [s._id, s.size]));
  const retained = new Map(active.map(a => [`${a._id.cohort}:${a._id.week}`, a.people]));
  const rows = Array.from({ length: window }, (_, i) => {
    const start = new Date(first.getTime() + i * WEEK);
    const key = isoWeekKey(start);
    return {
      cohort: dayKey(start),
      size: sized.get(key) || 0,
      weeks: Array.from({ length: RETENTION_WEEKS }, (_, w) => retained.get(`${key}:${w}`) || 0),
      // How many of those columns have actually had time to happen. Last week's cohort cannot have
      // a week-three number yet, and rendering the zero it would otherwise return reads as everyone
      // leaving rather than as nobody having got there. The caller blanks the rest.
      measured: Math.min(RETENTION_WEEKS, Math.floor((now - start.getTime()) / WEEK) + 1),
    };
  });
  return { weeks: window, since: dayKey(first), rows };
}

const READY_STATES = { 0: 'disconnected', 1: 'connected', 2: 'connecting', 3: 'disconnecting', 99: 'uninitialized' };
/**
 * Operational signals, limited to the ones the stored data can honestly answer.
 *
 * Each of these is a queue that should normally be near empty, so a number that keeps climbing is
 * the thing worth looking at rather than the number itself. Request error rates, endpoint latency
 * and email delivery outcomes are deliberately absent: nothing in the models records them, and a
 * figure assembled from what is here would be a guess wearing a metric's name.
 */
export async function health() {
  const now = Date.now();
  const [stuckApprovals, unclaimedPayments, unverifiedAccounts, events] = await Promise.all([
    PremiumOrder.countDocuments({ status: 'pending', createdAt: { $lt: new Date(now - DAY) } }),
    // A gateway order id with no payment id means checkout opened and never completed. After an hour
    // it is almost certainly abandoned rather than in progress, though the two are indistinguishable
    // here: the gateway knows which, and we only store our side.
    PremiumOrder.countDocuments({
      method: 'razorpay', gatewayOrderId: { $ne: null }, gatewayPaymentId: null,
      createdAt: { $lt: new Date(now - 3600000) },
    }),
    User.countDocuments({ emailVerifiedAt: null, createdAt: { $lt: new Date(now - DAY) } }),
    DomainEvent.estimatedDocumentCount(),
  ]);
  return {
    stuckApprovals,
    unclaimedPayments,
    unverifiedAccounts,
    domainEvents: events,
    database: { readyState: mongoose.connection.readyState, state: READY_STATES[mongoose.connection.readyState] || 'unknown' },
  };
}

/** Everything above in one round trip, since the sections share no data and nothing depends on another's result. */
export async function overview({ days, weeks } = {}) {
  const [growthReport, revenueReport, engagementReport, retentionReport, healthReport] = await Promise.all([
    growth({ days }), revenue({ days }), engagement({ days }), retention({ weeks }), health(),
  ]);
  return {
    days: windowDays(days),
    weeks: windowWeeks(weeks),
    growth: growthReport,
    revenue: revenueReport,
    engagement: engagementReport,
    retention: retentionReport,
    health: healthReport,
  };
}
