import { GameProfile, Progress } from '../models/index.js';
import { XP, BADGES, isCorrect, isSkip, xpForReview, levelOf, metricOf } from '../../../shared/game.js';
import { compareAnswer } from '../../../shared/answers.js';

/**
 * Experience and badges, awarded inside the review's own transaction.
 *
 * That placement is what makes them trustworthy enough to show: a retried review returns the game
 * result stored with it instead of paying out twice, and two devices reviewing at once serialise
 * on the profile row instead of both reading the same combo.
 *
 * What the client says about how a card was answered — the mode, the local hour, a finished match
 * board — is believed, the same way the rating already is. Nobody is ranked against anybody here,
 * so the defences are the ones that stop a loop from being worth running: a repeated card pays one
 * XP, a day pays at most `XP.dailyCap`, a board only counts after its pairs were reviewed, and a
 * typed or spoken answer sent blank is a skip that earns nothing and counts toward nothing. The
 * blank is judged from the reply itself, not from anything the client claims about it. Likewise an
 * answer said back after reading it (`echo`) is compared with the card here, and pays `XP.echoXp`
 * only if it covers the answer.
 */

const DAY = 86400000;
const dayKey = d => d.toISOString().slice(0, 10);
const previousDay = key => dayKey(new Date(Date.parse(`${key}T00:00:00Z`) - DAY));
const MAX_FOLDERS = Math.max(...BADGES.filter(b => b.metric === 'folders').map(b => b.target));
const DEEP_ROOTS_DAYS = 21;

export async function awardReview({ user, card, before, after, rating, mode = 'classic', reply, echo = false, localHour, board, now = new Date() }, session) {
  const profile = await GameProfile.findOneAndUpdate({ user: user.id }, { $setOnInsert: { user: user.id } }, { upsert: true, new: true, session });
  const startLevel = levelOf(profile.xp).level, correct = isCorrect(rating), day = dayKey(now);
  if (isSkip(mode, reply) || (echo && (compareAnswer(reply, card)?.score ?? 0) < XP.echoMatch)) {
    profile.combo = 0;
    await profile.save({ session });
    return { xp: 0, total: profile.xp, level: levelOf(profile.xp), levelUp: false, combo: 0, goalBonus: false, capped: false, badges: [], skipped: true };
  }
  const repeat = !!before?.lastReviewedAt && now - new Date(before.lastReviewedAt) < XP.repeatWindowMs;
  const firstSight = !before?.reps && !before?.lastReviewedAt;

  if (profile.today?.day !== day) profile.today = { day, reviews: 0, xp: 0, goalMet: false };
  if (profile.lastDay !== day) {
    profile.dayStreak = profile.lastDay === previousDay(day) ? profile.dayStreak + 1 : 1;
    profile.lastDay = day;
    profile.bestDayStreak = Math.max(profile.bestDayStreak, profile.dayStreak);
  }

  profile.combo = correct ? profile.combo + 1 : 0;
  profile.bestCombo = Math.max(profile.bestCombo, profile.combo);
  profile.reviews++;
  if (correct) profile.correct[mode] = (profile.correct[mode] || 0) + 1;
  if (!profile.modesTried.includes(mode)) profile.modesTried.push(mode);
  if (correct && !repeat && (before?.lapses || 0) >= 3) profile.comebacks++;
  if (Number.isInteger(localHour)) { if (localHour < 4) profile.night++; else if (localHour >= 5 && localHour < 7) profile.dawn++; }
  if (card.folder && profile.folders.length < MAX_FOLDERS && !profile.folders.some(f => String(f) === String(card.folder))) profile.folders.push(card.folder);
  if (mode === 'match') {
    profile.matchSinceBoard++;
    if (board && profile.matchSinceBoard >= board.pairs) {
      profile.boards++;
      if (board.mistakes === 0 && board.pairs >= 6) profile.flawless++;
      profile.matchSinceBoard = 0;
    }
  }

  const goal = Math.max(1, user.dailyGoal || 20);
  profile.today.reviews++;
  let earned = echo ? (repeat ? XP.repeatXp : XP.echoXp) : xpForReview({ rating, mode, combo: profile.combo, firstSight, repeat });
  const goalBonus = !profile.today.goalMet && profile.today.reviews >= goal;
  if (goalBonus) { profile.today.goalMet = true; earned += XP.goalBonus; }
  if (profile.today.reviews === goal * 2) profile.doubleGoal++;
  const gained = Math.max(0, Math.min(earned, XP.dailyCap - profile.today.xp));
  profile.today.xp += gained;
  profile.xp += gained;

  const has = new Set(profile.badges.map(b => b.id));
  if (!has.has('deep-roots') && (after?.stability || 0) >= DEEP_ROOTS_DAYS) {
    profile.deepRoots = await Progress.countDocuments({ user: user.id, stability: { $gte: DEEP_ROOTS_DAYS } }).session(session);
  }
  const fresh = BADGES.filter(b => !has.has(b.id) && metricOf(profile, b.metric) >= b.target).map(b => b.id);
  for (const id of fresh) profile.badges.push({ id, at: now });

  profile.markModified('today');
  await profile.save({ session });
  const level = levelOf(profile.xp);
  return { xp: gained, total: profile.xp, level, levelUp: level.level > startLevel, combo: profile.combo, goalBonus, capped: gained < earned, badges: fresh };
}

/** The learner's level and every badge with how close it is, for the progress page and the library. */
export async function gameSummary(user) {
  const p = await GameProfile.findOne({ user: user.id }).lean();
  const earned = new Map((p?.badges || []).map(b => [b.id, b.at]));
  return {
    level: levelOf(p?.xp || 0),
    reviews: p?.reviews || 0, combo: p?.combo || 0, bestCombo: p?.bestCombo || 0,
    todayXp: p?.today?.day === dayKey(new Date()) ? p.today.xp : 0,
    correct: p?.correct || {},
    badges: BADGES.map(b => ({ id: b.id, at: earned.get(b.id) || null, value: Math.min(b.target, metricOf(p, b.metric)) })),
  };
}
