import { CLOZE_RE, hasCloze } from './cloze.js';

/**
 * What a card's answer is when it has to fit somewhere smaller than the card: a multiple-choice
 * option, a match tile, a word to type or say.
 *
 * Answers are allowed to be long, and the good ones open with the answer itself in bold followed
 * by an explanation. So the bold term is the answer and the rest is commentary, and putting the
 * whole explanation on a button would both be unreadable and give the game away.
 */

const SHORT = 60, OPTION = 140, TARGET = 60;

/** Markdown as the words a person reads: emphasis, links, code ticks and list markers removed. */
export function plainOf(md) {
  return String(md || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*(.+?)\*\*/g, '$1').replace(/(^|\W)__(.+?)__(?=\W|$)/g, '$1$2')
    .replace(/\*(?=\S)(.+?)\*/g, '$1').replace(/(^|\W)_(?=\S)(.+?)_(?=\W|$)/g, '$1$2')
    .replace(/~~(.+?)~~/g, '$1')
    .replace(/^\s{0,3}(#{1,6}\s+|>\s?|[-*+]\s+|\d+[.)]\s+)/gm, '')
    .replace(/\s+/g, ' ').trim();
}

const clip = (text, max) => text.length <= max ? text : `${text.slice(0, max).replace(/\s+\S*$/, '')}…`;

/**
 * `display` is Markdown to show in place of the answer; `target` is the plain text a typed or
 * spoken reply is checked against, or null when the answer cannot reasonably be reproduced —
 * a paragraph, an equation, a block of code, a picture.
 */
export function answerParts(card) {
  const front = card?.front?.text || '', back = String(card?.back?.text || '').trim();
  if (!back && hasCloze(front)) {
    const hidden = [...front.matchAll(new RegExp(CLOZE_RE.source, 'g'))].map(m => m[2].trim()).filter(Boolean);
    if (!hidden.length) return null;
    const text = hidden.join(', ');
    return { display: text, target: targetOf(text), whole: true };
  }
  if (!back) return null;
  const whole = plainOf(back), firstPara = back.split(/\n\s*\n/)[0];
  const bold = firstPara.match(/\*\*([^*\n]{1,80}?)\*\*/)?.[1] || firstPara.match(/(?:^|\W)__([^_\n]{1,80}?)__/)?.[1];
  if (whole && whole.length <= SHORT && !/\n/.test(back)) return { display: back, target: targetOf(bold || back), whole: true };
  if (bold) return { display: bold.trim(), target: targetOf(bold), whole: false };
  // "The Constitution. Every other law has to give way to it…" — a short opening sentence is the answer.
  const sentence = plainOf(firstPara).split(/(?<=[.!?]["'”’)]?)\s/)[0] || whole;
  if (!sentence) return null;
  return { display: clip(sentence, OPTION), target: sentence.length <= 40 ? targetOf(sentence) : null, whole: false };
}

function targetOf(md) {
  if (/\$|```/.test(md)) return null;
  const text = plainOf(md);
  return text && text.length <= TARGET ? text : null;
}

const NUMBERS = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100 };

/** Case, accents, punctuation, articles and spelled-out numbers do not decide whether an answer is right. */
export function normalizeAnswer(text) {
  return String(text || '').toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '')
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(' ').filter(Boolean).map(w => (w in NUMBERS ? String(NUMBERS[w]) : w))
    // "twenty seven" is 27, not "20 7".
    .reduce((out, w) => { const last = out.at(-1); if (/^[2-9]0$/.test(last) && /^[1-9]$/.test(w)) out[out.length - 1] = String(Number(last) + Number(w)); else out.push(w); return out; }, [])
    .filter((w, i, all) => !(['the', 'a', 'an'].includes(w) && all.length > 1))
    .join(' ');
}

export function editDistance(a, b) {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = row;
  }
  return prev[b.length];
}

const allowance = n => (n <= 3 ? 0 : n <= 6 ? 1 : n <= 12 ? 2 : Math.floor(n / 6));

/**
 * 'exact', 'close' (a typo or a mis-heard letter) or 'wrong'.
 *
 * "colour / color" accepts either. A bracketed aside is optional. And a reply that contains the
 * answer as whole words counts, because people say "it's Paris" out loud.
 */
export function gradeAnswer(reply, target) {
  const said = normalizeAnswer(reply);
  if (!said || !target) return 'wrong';
  const accepted = new Set();
  for (const alt of String(target).split(/\s+\/\s+/)) {
    accepted.add(normalizeAnswer(alt));
    accepted.add(normalizeAnswer(alt.replace(/\([^)]*\)/g, ' ')));
  }
  accepted.delete('');
  let best = 'wrong';
  for (const want of accepted) {
    if (said === want || ` ${said} `.includes(` ${want} `) && said.length <= want.length + 24) return 'exact';
    if (editDistance(said, want) <= allowance(want.length)) best = 'close';
  }
  return best;
}
