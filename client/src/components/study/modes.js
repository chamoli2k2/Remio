import { answerParts, plainOf, gradeAnswer } from '../../../../shared/answers.js';
import { renderCloze, hasCloze } from '../../../../shared/cloze.js';
export { gradeAnswer };

export const SpeechRecognition = typeof window !== 'undefined' ? (window.SpeechRecognition || window.webkitSpeechRecognition || null) : null;

const shuffle = arr => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

const partsCache = new WeakMap();
export const partsOf = card => { if (!partsCache.has(card)) partsCache.set(card, answerParts(card)); return partsCache.get(card); };

/** The distinct short answers in a deck, which is where wrong options come from. */
export const answerPool = cards => [...new Set(cards.map(c => partsOf(c)?.display).filter(Boolean))];

/** Whether a card can be played in a mode. A card that cannot is shown the classic way instead. */
export function playable(card, mode, pool) {
  const parts = partsOf(card);
  if (mode === 'classic') return true;
  if (!parts) return false;
  if (mode === 'mcq' || mode === 'truefalse') return pool.length >= 2;
  if (mode === 'type') return !!parts.target;
  if (mode === 'voice') return !!parts.target && !!SpeechRecognition;
  if (mode === 'match') return !!promptText(card) && pool.length >= 2;
  return false;
}

/** The question as one short line, for a match tile. */
export function promptText(card) {
  const text = card.front.text || '';
  const shown = hasCloze(text) && !String(card.back.text || '').trim() ? renderCloze(text, 'hide', { hiddenOpen: '[', hiddenClose: ']' }) : text;
  const plain = plainOf(shown);
  return plain.length > 110 ? `${plain.slice(0, 110).replace(/\s+\S*$/, '')}…` : plain;
}

/**
 * Up to three wrong options, chosen from the answers closest in length to the right one so the
 * odd one out is not simply the longest. Randomised among the closest few, not always the same three.
 */
export function optionsFor(card, pool) {
  const right = partsOf(card).display;
  const others = pool.filter(a => a !== right).sort((a, b) => Math.abs(a.length - right.length) - Math.abs(b.length - right.length));
  const wrong = shuffle(others.slice(0, 8)).slice(0, 3);
  const options = shuffle([right, ...wrong]);
  return { options, correct: options.indexOf(right) };
}

/** A statement that is true half the time: the card's own answer, or another card's. */
export function statementFor(card, pool) {
  const right = partsOf(card).display;
  const truth = Math.random() < 0.5;
  const others = pool.filter(a => a !== right);
  return { shown: truth || !others.length ? right : others[Math.floor(Math.random() * others.length)], truth: truth || !others.length };
}

/** The next run of cards that can share a match board: consecutive, playable, two to six of them. */
export function boardFrom(queue, start, pool) {
  const run = [];
  for (let i = start; i < queue.length && run.length < 6; i++) {
    if (!playable(queue[i], 'match', pool)) break;
    if (run.some(c => partsOf(c).display === partsOf(queue[i]).display)) break;
    run.push(queue[i]);
  }
  return run.length >= 2 ? run : [];
}

/** Session points: what the scoreboard on the study page counts. XP is separate and server-awarded. */
export function pointsFor({ rating, combo = 0, seconds = null }) {
  const base = { again: 0, hard: 60, good: 100, easy: 120 }[rating] || 0;
  if (!base) return 0;
  const streak = 10 * Math.min(10, Math.max(0, combo - 1));
  const speed = seconds == null ? 0 : Math.round(50 * Math.max(0, 1 - seconds / 12));
  return base + streak + speed;
}

const bestKey = (folderId, mode) => `remio:best:${folderId}:${mode}`;
export function recordBest(folderId, mode, points) {
  try {
    const best = Number(localStorage.getItem(bestKey(folderId, mode)) || 0);
    if (points > best) { localStorage.setItem(bestKey(folderId, mode), String(points)); return { best: points, isNew: best > 0 }; }
    return { best, isNew: false };
  } catch { return { best: points, isNew: false }; }
}

export const VOICE_LANGS = [['en-US', 'English (US)'], ['en-GB', 'English (UK)'], ['en-IN', 'English (India)'], ['hi-IN', 'Hindi'], ['es-ES', 'Spanish'], ['fr-FR', 'French'], ['de-DE', 'German'], ['it-IT', 'Italian'], ['pt-BR', 'Portuguese'], ['ja-JP', 'Japanese']];
export function defaultVoiceLang() {
  try { const saved = localStorage.getItem('remio:voice-lang'); if (saved) return saved; } catch { /* private mode */ }
  const nav = typeof navigator !== 'undefined' ? navigator.language : 'en-US';
  return VOICE_LANGS.find(([id]) => id === nav)?.[0] || VOICE_LANGS.find(([id]) => id.slice(0, 2) === nav?.slice(0, 2))?.[0] || 'en-US';
}
