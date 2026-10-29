/**
 * Experience, levels and badges. Shared so the study page can say what a review is worth before
 * the server, which is the only thing that actually awards it, confirms the same number.
 */

/** How a card was answered. `xp` reflects effort: recalling and typing an answer beats recognising it. */
export const MODES = {
  classic: { label: 'Flip and rate', xp: 1 },
  mcq: { label: 'Multiple choice', xp: 1 },
  truefalse: { label: 'True or false', xp: 0.8 },
  type: { label: 'Type the answer', xp: 1.5 },
  voice: { label: 'Say the answer', xp: 1.75 },
  match: { label: 'Match the pairs', xp: 1 },
};
export const MODE_IDS = Object.keys(MODES);

export const XP = {
  rating: { again: 2, hard: 6, good: 10, easy: 12 },
  comboCap: 10,
  firstSight: 5,
  goalBonus: 50,
  // The same card again within a few minutes is practice, not progress, and paying full rate for it
  // would make reviewing one card in a loop the fastest way up the levels.
  repeatWindowMs: 5 * 60000,
  repeatXp: 1,
  // Saying an answer back after giving up on it and reading it: practice worth a little, if what
  // was said actually covers the answer.
  echoXp: 4,
  echoMatch: 0.4,
  dailyCap: 3000,
};

export const isCorrect = rating => rating !== 'again';

/** Modes where the learner produces the answer. Leaving it blank is a skip: scheduled, but worth nothing. */
export const ANSWERED_MODES = ['type', 'voice'];
export const isSkip = (mode, reply) => ANSWERED_MODES.includes(mode) && !String(reply ?? '').trim();

/** XP for one review, before the daily cap. */
export function xpForReview({ rating, mode = 'classic', combo = 0, firstSight = false, repeat = false }) {
  if (repeat) return XP.repeatXp;
  const base = Math.round((XP.rating[rating] || 0) * (MODES[mode]?.xp || 1));
  const streak = isCorrect(rating) ? Math.min(XP.comboCap, Math.max(0, combo - 1)) : 0;
  return base + streak + (firstSight ? XP.firstSight : 0);
}

/** Level L starts at 50·L·(L−1) XP: 100 for level 2, 300 for 3, 600 for 4, 1,000 for 5. */
export const levelFloor = level => 50 * level * (level - 1);
const TITLES = [[1, 'Curious'], [5, 'Seeker'], [10, 'Scholar'], [15, 'Sage'], [20, 'Luminary'], [30, 'Oracle'], [45, 'Living Library']];
export function levelOf(xp = 0) {
  const level = Math.max(1, Math.floor((1 + Math.sqrt(1 + (8 * Math.max(0, xp)) / 100)) / 2));
  const floor = levelFloor(level), next = levelFloor(level + 1);
  return { level, title: TITLES.filter(([at]) => level >= at).pop()[1], xp, floor, next, into: xp - floor, needed: next - floor };
}

/**
 * Badges. Each names a metric on the game profile and the number it has to reach, so the server
 * can award them and the page can draw how close each one is from the same table.
 *
 * Rarity is how much effort it takes, and decides the colour: common, rare, epic, legendary.
 */
export const BADGES = [
  { id: 'first-light', name: 'First Light', blurb: 'Review your very first card.', icon: 'sunrise', rarity: 'common', metric: 'reviews', target: 1 },
  { id: 'chameleon', name: 'Chameleon', blurb: 'Study in all six ways at least once.', icon: 'shapes', rarity: 'rare', metric: 'modesTried', target: 6 },
  { id: 'four-doors', name: 'Four Doors', blurb: 'Pick the right door 100 times in multiple choice.', icon: 'door', rarity: 'rare', metric: 'correct.mcq', target: 100 },
  { id: 'truth-serum', name: 'Truth Serum', blurb: 'Call 50 true-or-false statements correctly.', icon: 'scale', rarity: 'common', metric: 'correct.truefalse', target: 50 },
  { id: 'inkslinger', name: 'Inkslinger', blurb: 'Type 50 answers from memory.', icon: 'keyboard', rarity: 'rare', metric: 'correct.type', target: 50 },
  { id: 'silver-tongue', name: 'Silver Tongue', blurb: 'Say 25 answers out loud and get them right.', icon: 'mic', rarity: 'rare', metric: 'correct.voice', target: 25 },
  { id: 'cupids-algorithm', name: 'Cupid’s Algorithm', blurb: 'Finish 10 match-the-pairs boards.', icon: 'heart', rarity: 'common', metric: 'boards', target: 10 },
  { id: 'clean-sweep', name: 'Clean Sweep', blurb: 'Clear a board of six pairs without a single wrong match.', icon: 'sparkles', rarity: 'epic', metric: 'flawless', target: 1 },
  { id: 'chain-reaction', name: 'Chain Reaction', blurb: 'Get 25 answers right in a row.', icon: 'zap', rarity: 'rare', metric: 'bestCombo', target: 25 },
  { id: 'unshakable', name: 'Unshakable', blurb: 'Get 100 answers right in a row.', icon: 'mountain', rarity: 'legendary', metric: 'bestCombo', target: 100 },
  { id: 'phoenix', name: 'Phoenix', blurb: 'Remember a card you had forgotten three times or more.', icon: 'bird', rarity: 'epic', metric: 'comebacks', target: 1 },
  { id: 'moonlighter', name: 'Moonlighter', blurb: 'Review 20 cards between midnight and 4 am.', icon: 'moon', rarity: 'rare', metric: 'night', target: 20 },
  { id: 'sunrise-shift', name: 'Sunrise Shift', blurb: 'Review 20 cards between 5 and 7 am.', icon: 'sun', rarity: 'rare', metric: 'dawn', target: 20 },
  { id: 'double-shot', name: 'Double Shot', blurb: 'Review twice your daily goal in one day.', icon: 'coffee', rarity: 'common', metric: 'doubleGoal', target: 1 },
  { id: 'seven-suns', name: 'Seven Suns', blurb: 'Study seven days in a row.', icon: 'flame', rarity: 'rare', metric: 'bestDayStreak', target: 7 },
  { id: 'full-moon', name: 'Full Moon', blurb: 'Study every day for a whole lunar cycle, 30 days.', icon: 'moonstar', rarity: 'legendary', metric: 'bestDayStreak', target: 30 },
  { id: 'cartographer', name: 'Cartographer', blurb: 'Study five different collections.', icon: 'map', rarity: 'common', metric: 'folders', target: 5 },
  { id: 'deep-roots', name: 'Deep Roots', blurb: 'Grow 50 cards that stay with you for three weeks or more.', icon: 'tree', rarity: 'epic', metric: 'deepRoots', target: 50 },
  { id: 'thousand-sparks', name: 'Thousand Sparks', blurb: 'Complete 1,000 reviews.', icon: 'star', rarity: 'epic', metric: 'reviews', target: 1000 },
];
export const BADGE_IDS = BADGES.map(b => b.id);

/** Read a badge metric off a game profile. */
export function metricOf(profile, metric) {
  if (!profile) return 0;
  if (metric.startsWith('correct.')) return profile.correct?.[metric.slice(8)] || 0;
  if (metric === 'modesTried') return (profile.modesTried || []).length;
  if (metric === 'folders') return (profile.folders || []).length;
  return profile[metric] || 0;
}
