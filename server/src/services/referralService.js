import { Referral, Review, User } from '../models/index.js';
import { DAY_MS, REFERRAL, REFERRAL_CAP, REFERRAL_PLAN_ID, normaliseCode } from '../constants/index.js';
import { codesRequired } from './emailCodeService.js';
import { notify } from './notificationService.js';
import mongoose from 'mongoose';
import { assert, conflict, internal } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

/** Words that would read as official, or as something other than a person's own code. */
const RESERVED = new Set(['ADMIN', 'ADMINISTRATOR', 'SUPPORT', 'STAFF', 'REMIO', 'FREE', 'PREMIUM', 'PROMO', 'TEST', 'OFFICIAL', 'HELP']);
const randomDigits = n => String(Math.floor(Math.random() * 10 ** n)).padStart(n, '0');

/**
 * A code of the person's own, made on first use from their username so it is easy to say aloud.
 * Setting it is a conditional update on "no code yet", so two tabs asking at once end up with one.
 */
export async function ensureCode(userId) {
  const user = await User.findById(userId).select('username referralCode');
  assert(user, 404, 'Account not found.', 'NOT_FOUND');
  if (user.referralCode) return user.referralCode;
  const base = normaliseCode(user.username).slice(0, 10).padEnd(REFERRAL.codeMin, 'X');
  for (let attempt = 0; attempt < 8; attempt++) {
    const candidate = attempt === 0 ? base : `${base.slice(0, 8)}${randomDigits(attempt < 4 ? 2 : 4)}`;
    if (RESERVED.has(candidate)) continue;
    try {
      const claimed = await User.findOneAndUpdate({ _id: userId, referralCode: { $in: [null, ''] } }, { $set: { referralCode: candidate } }, { new: true }).select('referralCode');
      if (claimed) return claimed.referralCode;
      return (await User.findById(userId).select('referralCode')).referralCode;
    } catch (e) {
      if (e?.code !== 11000) throw e;
    }
  }
  throw internal('Could not make a code. Please try again.');
}

/** Choosing your own code, until somebody has used the one you have. */
export async function setCode(user, raw) {
  const code = normaliseCode(raw);
  assert(code.length >= REFERRAL.codeMin && code.length <= REFERRAL.codeMax, 400, `Use ${REFERRAL.codeMin} to ${REFERRAL.codeMax} letters or numbers.`, 'BAD_CODE');
  assert(!RESERVED.has(code), 400, 'That code is reserved. Please pick another.', 'BAD_CODE');
  assert(!await Referral.exists({ referrer: user.id }), 409, 'Your code is locked once somebody has joined with it.', 'CODE_LOCKED');
  try {
    await User.updateOne({ _id: user.id }, { $set: { referralCode: code } });
  } catch (e) {
    if (e?.code === 11000) throw conflict('That code is taken. Try another.', 'CODE_TAKEN');
    throw e;
  }
  return { code };
}

/** What a code shows before anybody commits to it. Says nothing about whether it still pays. */
export async function lookup(raw) {
  const code = normaliseCode(raw);
  if (!code) return { valid: false };
  const owner = await User.findOne({ referralCode: code }).select('name');
  return owner ? { valid: true, name: String(owner.name).split(' ')[0], refereeRewardDays: REFERRAL.refereeRewardDays, activeDaysRequired: REFERRAL.activeDaysRequired } : { valid: false };
}

/**
 * Links an account to whoever invited it. Done at sign-up, or within the first week for an account
 * made another way (Google), and only once. Cycles are refused so two people cannot invite each other.
 */
export async function redeem(user, raw, now = Date.now()) {
  const code = normaliseCode(raw);
  assert(code, 400, 'Enter an invite code.', 'BAD_CODE');
  const me = await User.findById(user.id).select('referredBy createdAt');
  assert(me, 404, 'Account not found.', 'NOT_FOUND');
  assert(!me.referredBy, 409, 'You have already used an invite code.', 'ALREADY_REFERRED');
  assert(now - new Date(me.createdAt).getTime() <= REFERRAL.redeemWindowDays * DAY_MS, 400, `Invite codes can only be added in your first ${REFERRAL.redeemWindowDays} days.`, 'WINDOW_CLOSED');
  const referrer = await User.findOne({ referralCode: code }).select('_id name username referredBy');
  assert(referrer, 404, 'That invite code does not exist.', 'NOT_FOUND');
  assert(String(referrer._id) !== String(me._id), 400, 'You cannot use your own code.', 'SELF_REFERRAL');
  assert(String(referrer.referredBy || '') !== String(me._id), 400, 'That person joined with your code, so it cannot be used the other way round.', 'CYCLE');
  try {
    await Referral.create({ referrer: referrer._id, referee: me._id, code });
  } catch (e) {
    if (e?.code === 11000) throw conflict('You have already used an invite code.', 'ALREADY_REFERRED');
    throw e;
  }
  await User.updateOne({ _id: me._id }, { $set: { referredBy: referrer._id } });
  notify(referrer._id, 'referral.joined', { actor: me._id }).catch(() => {});
  return { referrer: { name: referrer.name, username: referrer.username }, refereeRewardDays: REFERRAL.refereeRewardDays, activeDaysRequired: REFERRAL.activeDaysRequired };
}

/** Distinct calendar days (UTC) on which this person answered at least one card. */
export async function studyDays(userId) {
  const [row] = await Review.aggregate([
    { $match: { user: new mongoose.Types.ObjectId(String(userId)) } },
    { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } } } },
    { $count: 'days' },
  ]);
  return row?.days || 0;
}

/**
 * Adds Premium time in one atomic update, so two rewards landing together both count. Accounts that
 * already have it for good (staff, or a plan with no end date) are left exactly as they are.
 */
export async function grantPremiumDays(userId, days, now = new Date()) {
  const ms = days * DAY_MS;
  const result = await User.updateOne(
    { _id: userId, $or: [{ account: 'normal' }, { account: 'premium', premiumExpiresAt: { $ne: null } }] },
    [{ $set: {
      premiumPlan: { $cond: [{ $and: [{ $eq: ['$account', 'premium'] }, { $gt: ['$premiumExpiresAt', now] }] }, '$premiumPlan', REFERRAL_PLAN_ID] },
      premiumExpiresAt: { $add: [{ $max: [now, { $ifNull: ['$premiumExpiresAt', now] }] }, ms] },
      account: 'premium',
    } }],
  );
  return result.modifiedCount > 0;
}

/**
 * Called whenever an invited person studies, and when either side opens their invite page. Cheap
 * when there is nothing to do. When the invitee has studied on enough different days, the row is
 * flipped to qualified with a conditional update (so it can only pay once), then both are rewarded.
 */
export async function evaluate(userId) {
  const row = await Referral.findOne({ referee: userId, status: 'joined' });
  if (!row) return null;
  const days = await studyDays(userId);
  if (days !== row.activeDays) await Referral.updateOne({ _id: row._id }, { $set: { activeDays: days } });
  if (days < REFERRAL.activeDaysRequired) return { days, qualified: false };
  const invitee = await User.findById(userId).select('emailVerifiedAt');
  if (!invitee) return null;
  // A real inbox is what stands between this and a pile of throwaway accounts, so insist on one
  // wherever sign-up itself insists on proving it.
  if (codesRequired() && !invitee.emailVerifiedAt) return { days, qualified: false, needsEmail: true };

  const claimed = await Referral.findOneAndUpdate({ _id: row._id, status: 'joined' }, { $set: { status: 'qualified', qualifiedAt: new Date(), activeDays: days } }, { new: true });
  if (!claimed) return { days, qualified: true };

  const refereeDays = REFERRAL.refereeRewardDays;
  await grantPremiumDays(userId, refereeDays);
  const rewards = { refereeRewardDays: refereeDays, referrerRewardDays: 0 };

  // The counter is the milestone clock: it returns a number nobody else can have received.
  const referrer = await User.findOneAndUpdate({ _id: claimed.referrer }, { $inc: { referralQualified: 1 } }, { new: true }).select('referralQualified');
  if (referrer) {
    const count = referrer.referralQualified;
    const milestone = count <= REFERRAL_CAP ? REFERRAL.milestones.find(m => m.qualified === count) : null;
    if (milestone) { await grantPremiumDays(claimed.referrer, milestone.days); rewards.referrerRewardDays = milestone.days; }
    notify(claimed.referrer, 'referral.qualified', { actor: userId, data: { days: rewards.referrerRewardDays, qualified: count, capped: count > REFERRAL_CAP } }).catch(() => {});
  }
  await Referral.updateOne({ _id: claimed._id }, { $set: rewards });
  notify(userId, 'referral.reward', { data: { days: refereeDays } }).catch(() => {});
  logger.info('referral qualified', { referrer: String(claimed.referrer), referee: String(userId), ...rewards });
  return { days, qualified: true, ...rewards };
}

/** Everything the invite page shows, for the person looking at it. */
export async function overview(user, now = Date.now()) {
  await evaluate(user.id).catch(e => logger.warn('referral check failed', { error: e.message }));
  const [code, fresh, rows, mine] = await Promise.all([
    ensureCode(user.id),
    User.findById(user.id).select('referredBy referralQualified createdAt'),
    Referral.find({ referrer: user.id }).sort({ createdAt: -1 }).limit(100).populate('referee', 'name username').lean(),
    Referral.findOne({ referee: user.id }).populate('referrer', 'name username').lean(),
  ]);
  const qualified = fresh?.referralQualified || 0;
  const earned = REFERRAL.milestones.filter(m => qualified >= m.qualified).reduce((sum, m) => sum + m.days, 0);
  const next = REFERRAL.milestones.find(m => qualified < m.qualified) || null;
  const within = now - new Date(fresh?.createdAt || now).getTime() <= REFERRAL.redeemWindowDays * DAY_MS;
  return {
    code,
    program: { ...REFERRAL, cap: REFERRAL_CAP },
    joined: rows.length,
    qualified,
    earnedDays: earned,
    capReached: qualified >= REFERRAL_CAP,
    next: next ? { ...next, remaining: next.qualified - qualified } : null,
    milestones: REFERRAL.milestones.map(m => ({ ...m, reached: qualified >= m.qualified })),
    invitees: rows.filter(r => r.referee).map(r => ({ name: r.referee.name, username: r.referee.username, status: r.status, activeDays: r.activeDays, joinedAt: r.createdAt })),
    invitedBy: mine?.referrer ? { name: mine.referrer.name, username: mine.referrer.username, status: mine.status, activeDays: mine.activeDays, rewardDays: mine.refereeRewardDays || REFERRAL.refereeRewardDays } : null,
    canRedeem: !fresh?.referredBy && within,
  };
}
