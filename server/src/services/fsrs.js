// FSRS (Free Spaced Repetition Scheduler), the algorithm behind modern Anki, implemented as pure functions.
// Memory is modelled with two variables per card: stability S (days until recall probability drops to 90%)
// and difficulty D (1–10). Retrievability R is the predicted probability of recalling the card right now.
// Reference: https://github.com/open-spaced-repetition/fsrs4anki/wiki/The-Algorithm (FSRS-5 formulas and defaults).
import { DAY_MS } from '../constants/index.js';
export const DEFAULT_WEIGHTS = [0.40255, 1.18385, 3.173, 15.69105, 7.1949, 0.5345, 1.4604, 0.0046, 1.54575, 0.1192, 1.01925, 1.9395, 0.11, 0.29605, 2.2698, 0.2315, 2.9898, 0.51655, 0.6621];
export const DEFAULT_RETENTION = 0.9;
export const GRADES = { again: 1, hard: 2, good: 3, easy: 4 };
const DECAY = -0.5, FACTOR = 19 / 81, DAY = DAY_MS, RELEARN_MINUTES = 10, MAX_INTERVAL = 36500;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
/** Probability of recall after `elapsedDays` for a card with stability `stability`. */
export const retrievability = (elapsedDays, stability) => stability > 0 ? Math.pow(1 + FACTOR * (Math.max(0, elapsedDays) / stability), DECAY) : 0;
/** Interval (days) after which retrievability falls to `retention`. */
export const intervalFor = (stability, retention = DEFAULT_RETENTION) => clamp(Math.round((stability / FACTOR) * (Math.pow(retention, 1 / DECAY) - 1)), 1, MAX_INTERVAL);
const initStability = (w, g) => Math.max(w[g - 1], 0.1);
const initDifficulty = (w, g) => clamp(w[4] - Math.exp(w[5] * (g - 1)) + 1, 1, 10);
function nextDifficulty(w, d, g) {
  const delta = -w[6] * (g - 3); const damped = d + delta * ((10 - d) / 9); // linear damping: changes shrink as D approaches 10
  return clamp(w[7] * initDifficulty(w, 4) + (1 - w[7]) * damped, 1, 10); // mean reversion toward the "easy" starting difficulty
}
const recallStability = (w, d, s, r, g) => s * (1 + Math.exp(w[8]) * (11 - d) * Math.pow(s, -w[9]) * (Math.exp(w[10] * (1 - r)) - 1) * (g === 2 ? w[15] : 1) * (g === 4 ? w[16] : 1));
const forgetStability = (w, d, s, r) => Math.min(w[11] * Math.pow(d, -w[12]) * (Math.pow(s + 1, w[13]) - 1) * Math.exp(w[14] * (1 - r)), s);
const shortTermStability = (w, s, g) => s * Math.exp(w[17] * (g - 3 + w[18]));
/** Converts legacy SM-2 progress (interval/ease) into FSRS memory state so existing users keep their history. */
export function fromLegacy(progress) {
  if (progress.stability > 0) return { stability: progress.stability, difficulty: progress.difficulty, state: progress.state || 'review' };
  if (!(progress.repetitions > 0)) return null;
  const ease = progress.ease ?? 2.5; // ease 1.3 (hardest) … 3.0 (easiest) maps onto difficulty 10 … 1
  return { stability: Math.max(progress.interval || 1, 0.1), difficulty: clamp(1 + ((3 - ease) / 1.7) * 9, 1, 10), state: progress.interval >= 1 ? 'review' : 'learning' };
}
/**
 * Schedules the next review. `previous` is the stored Progress (FSRS fields optional), `rating` is again|hard|good|easy.
 * Returns the fields to merge into Progress: stability, difficulty, state, reps, lapses, elapsedDays, scheduledDays,
 * dueAt, lastReviewedAt, plus interval/repetitions/ease kept for compatibility with older stats and clients.
 */
export function schedule(previous = {}, rating, now = new Date(), { retention = DEFAULT_RETENTION, weights: w = DEFAULT_WEIGHTS } = {}) {
  const g = GRADES[rating]; if (!g) throw new Error(`Unknown rating ${rating}`);
  const memory = fromLegacy(previous); const last = previous.lastReviewedAt ? new Date(previous.lastReviewedAt) : null;
  const elapsedDays = memory && last ? Math.max(0, (now - last) / DAY) : 0;
  let stability, difficulty, state;
  if (!memory) { stability = initStability(w, g); difficulty = initDifficulty(w, g); state = 'learning'; }
  else {
    const r = retrievability(elapsedDays, memory.stability);
    difficulty = nextDifficulty(w, memory.difficulty, g);
    if (elapsedDays < 1) stability = shortTermStability(w, memory.stability, g); // same-day review: short-term memory formula
    else stability = g === 1 ? forgetStability(w, memory.difficulty, memory.stability, r) : recallStability(w, memory.difficulty, memory.stability, r, g);
    state = g === 1 ? 'relearning' : 'review';
  }
  stability = clamp(stability, 0.1, MAX_INTERVAL);
  const scheduledDays = g === 1 ? 0 : intervalFor(stability, retention);
  const dueAt = new Date(now.getTime() + (g === 1 ? RELEARN_MINUTES * 60000 : scheduledDays * DAY));
  const reps = (previous.reps ?? previous.repetitions ?? 0) + 1, lapses = (previous.lapses ?? 0) + (g === 1 && memory ? 1 : 0);
  return { stability, difficulty, state, reps, lapses, elapsedDays, scheduledDays, dueAt, lastReviewedAt: now,
    interval: scheduledDays, repetitions: g === 1 ? 0 : (memory ? (previous.repetitions ?? 0) + 1 : 1), ease: previous.ease ?? 2.5 };
}
/** Human-readable intervals for every rating, shown on the study buttons before the learner chooses. */
export function preview(previous, now = new Date(), options) {
  return Object.fromEntries(Object.keys(GRADES).map(rating => { const next = schedule(previous, rating, now, options); return [rating, next.scheduledDays === 0 ? `${RELEARN_MINUTES}m` : formatDays(next.scheduledDays)]; }));
}
export const formatDays = d => d < 1 ? '<1d' : d < 30 ? `${d}d` : d < 365 ? `${(d / 30).toFixed(d < 60 ? 1 : 0).replace(/\.0$/, '')}mo` : `${(d / 365).toFixed(1).replace(/\.0$/, '')}y`;
/** Current recall probability for a stored Progress document, or null for never-reviewed cards. */
export function currentRetrievability(progress, now = new Date()) {
  const memory = fromLegacy(progress); if (!memory || !progress.lastReviewedAt) return null;
  return retrievability((now - new Date(progress.lastReviewedAt)) / DAY, memory.stability);
}
