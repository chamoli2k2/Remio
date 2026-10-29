import { Folder, Card, Progress, Review } from '../models/index.js';
import { currentRetrievability, DEFAULT_RETENTION } from './fsrs.js';
import { stripCloze } from '../../../shared/cloze.js';
import { gameSummary } from './gameService.js';
const DAY = 86400000;
const startOfUtcDay = d => { const s = new Date(d); s.setUTCHours(0, 0, 0, 0); return s; };
/** Folders the user can study: own, shared with them, or saved public collections. */
export async function accessibleFolderIds(user) {
  const folders = await Folder.find({ archived: false, $or: [{ owner: user.id }, { 'members.user': user.id }, { _id: { $in: user.savedFolders || [] }, visibility: 'global' }] }).select('_id');
  return folders.map(f => f._id);
}
/**
 * Study statistics with FSRS retention analytics: predicted recall right now, observed recall over the last 30 days,
 * a 14-day due forecast, memory-state distribution and the hardest cards. Everything is scoped to the caller.
 */
export async function studyStats(user, now = new Date()) {
  const folderIds = await accessibleFolderIds(user);
  const cards = await Card.find({ folder: { $in: folderIds } }).select('_id front.text folder');
  const cardIds = cards.map(c => c._id);
  const [progress, reviewed, reviewsToday, recent] = await Promise.all([
    Progress.find({ user: user.id, card: { $in: cardIds } }),
    Review.countDocuments({ user: user.id }),
    Review.countDocuments({ user: user.id, createdAt: { $gte: startOfUtcDay(now) } }),
    Review.find({ user: user.id, createdAt: { $gte: new Date(now - 30 * DAY) } }).select('rating result createdAt')
  ]);
  const due = cards.length - progress.filter(p => p.dueAt > now).length;
  // Predicted retention: mean recall probability across every card with memory state.
  const probabilities = progress.map(p => currentRetrievability(p, now)).filter(r => r != null);
  const predictedRetention = probabilities.length ? probabilities.reduce((a, b) => a + b, 0) / probabilities.length : null;
  // Observed retention: share of non-first reviews that were not "again". Matches how FSRS is evaluated.
  const graded = recent.filter(r => (r.result?.reps ?? r.result?.repetitions ?? 0) > 1 || r.result?.lapses > 0 || r.rating !== 'again' && (r.result?.state === 'review'));
  const observedRetention = graded.length ? graded.filter(r => r.rating !== 'again').length / graded.length : null;
  // Due forecast: how many cards come due on each of the next 14 UTC days (day 0 includes overdue).
  const today = startOfUtcDay(now); const forecast = Array.from({ length: 14 }, (_, i) => ({ date: new Date(today.getTime() + i * DAY).toISOString().slice(0, 10), due: 0 }));
  for (const p of progress) { const i = Math.max(0, Math.floor((startOfUtcDay(p.dueAt) - today) / DAY)); if (i < 14) forecast[i].due++; }
  forecast[0].due += cards.length - progress.length; // never-studied cards are available today
  const states = { new: cards.length - progress.length, learning: 0, review: 0, relearning: 0 };
  for (const p of progress) states[p.state === 'new' && p.reps ? 'learning' : (p.state in states ? p.state : 'review')]++;
  const byCard = new Map(cards.map(c => [String(c._id), c]));
  const hardest = progress.filter(p => p.difficulty > 0).sort((a, b) => b.difficulty - a.difficulty || b.lapses - a.lapses).slice(0, 5)
    .map(p => ({ cardId: String(p.card), folderId: String(byCard.get(String(p.card))?.folder), text: (stripCloze(byCard.get(String(p.card))?.front.text) || 'Image card').slice(0, 90), difficulty: Math.round(p.difficulty * 10) / 10, lapses: p.lapses, stability: Math.round(p.stability * 10) / 10 }));
  const avgStability = progress.length ? progress.reduce((a, p) => a + (p.stability || p.interval || 0), 0) / progress.length : 0;
  return {
    totalCards: cards.length, due, reviewed, reviewsToday, mastered: progress.filter(p => (p.stability || p.interval) >= 21).length, goal: user.dailyGoal,
    retention: { desired: user.desiredRetention || DEFAULT_RETENTION, predicted: predictedRetention, observed: observedRetention, sampled: graded.length, averageStability: Math.round(avgStability * 10) / 10 },
    forecast, states, hardest, ...(await studyHabits(user, now)), game: await gameSummary(user)
  };
}
/**
 * Streaks over a set of 'YYYY-MM-DD' UTC study days. The current streak counts back from today, or from yesterday when
 * today has no review yet (so a streak is not "broken" until the day actually ends). Pure, for unit testing.
 */
export function computeStreaks(studied, now = new Date()) {
  const key = d => d.toISOString().slice(0, 10); const today = startOfUtcDay(now);
  const from = studied.has(key(today)) ? today : new Date(today.getTime() - DAY);
  let current = 0; for (let d = from; studied.has(key(d)); d = new Date(d.getTime() - DAY)) current++;
  let longest = 0, run = 0, prev = null;
  for (const d of [...studied].sort()) { const t = new Date(d + 'T00:00:00Z').getTime(); run = prev != null && t - prev === DAY ? run + 1 : 1; prev = t; longest = Math.max(longest, run); }
  return { current, longest };
}
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const hourLabel = h => `${h % 12 || 12}${h < 12 ? 'am' : 'pm'}`;
/**
 * Habit analytics from the review log: a one-year daily heatmap, current and longest streaks, and insights about when
 * the learner studies and remembers best. Aggregated in MongoDB and bucketed by UTC day, which matches the daily goal.
 */
export async function studyHabits(user, now = new Date(), days = 365) {
  const since = new Date(startOfUtcDay(now).getTime() - (days - 1) * DAY);
  const [daily, hours, weekdays, ratings, everyDay] = await Promise.all([
    Review.aggregate([{ $match: { user: user._id, createdAt: { $gte: since } } }, { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, count: { $sum: 1 }, recalled: { $sum: { $cond: [{ $eq: ['$rating', 'again'] }, 0, 1] } } } }, { $sort: { _id: 1 } }]),
    Review.aggregate([{ $match: { user: user._id } }, { $group: { _id: { $hour: '$createdAt' }, count: { $sum: 1 }, recalled: { $sum: { $cond: [{ $eq: ['$rating', 'again'] }, 0, 1] } } } }]),
    Review.aggregate([{ $match: { user: user._id } }, { $group: { _id: { $dayOfWeek: '$createdAt' }, count: { $sum: 1 } } }]),
    Review.aggregate([{ $match: { user: user._id, createdAt: { $gte: new Date(now - 30 * DAY) } } }, { $group: { _id: '$rating', count: { $sum: 1 } } }]),
    Review.aggregate([{ $match: { user: user._id } }, { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } } } }, { $sort: { _id: -1 } }])
  ]);
  const heatmap = daily.map(d => ({ date: d._id, count: d.count, recalled: d.recalled }));
  const studied = new Set(everyDay.map(d => d._id)); const { current, longest } = computeStreaks(studied, now);
  const totalReviews = hours.reduce((a, h) => a + h.count, 0);
  const bestHour = hours.filter(h => h.count >= 5).sort((a, b) => b.recalled / b.count - a.recalled / a.count || b.count - a.count)[0];
  const busiestHour = [...hours].sort((a, b) => b.count - a.count)[0];
  const busiestDay = [...weekdays].sort((a, b) => b.count - a.count)[0];
  const insights = [];
  if (bestHour) insights.push({ icon: 'sun', text: `You remember best around ${hourLabel(bestHour._id)} UTC: ${Math.round(bestHour.recalled / bestHour.count * 100)}% recall across ${bestHour.count} reviews.` });
  if (busiestHour && (!bestHour || busiestHour._id !== bestHour._id)) insights.push({ icon: 'clock', text: `Most of your studying happens around ${hourLabel(busiestHour._id)} UTC.` });
  if (busiestDay && weekdays.length > 1) insights.push({ icon: 'calendar', text: `${WEEKDAYS[busiestDay._id - 1]} is your busiest study day (${Math.round(busiestDay.count / totalReviews * 100)}% of all reviews).` });
  if (studied.size >= 7) insights.push({ icon: 'trend', text: `You average ${Math.round(totalReviews / studied.size)} reviews on the days you study, across ${studied.size} study days.` });
  if (current >= 3) insights.push({ icon: 'flame', text: `${current}-day streak. Reviewing even one card today keeps it alive.` });
  const ratingMix = Object.fromEntries(['again', 'hard', 'good', 'easy'].map(r => [r, ratings.find(x => x._id === r)?.count || 0]));
  return { heatmap, streak: { current, longest, activeDays: studied.size, since: since.toISOString().slice(0, 10) }, insights, ratingMix };
}
