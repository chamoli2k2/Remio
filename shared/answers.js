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

const STOP = new Set('a an the and or but of to in on at for by with from as is are was were be been being it its this that these those which who whom what when where why how not no do does did has have had can could will would should may might must also than then so such into over under about between because there their they them he she his her we you your our me my very just only more most some any each other example instance like lot lots thing things way often usually called known get gets got make makes made take takes many much well one happen happens need needs through'.split(' '));
// "makes", "making" and "cells" are reduced to a stem, so a paraphrase is not marked down for grammar.
const stem = w => (w.length > 4 ? w.replace(/(ing|ed)$/, '').replace(/(?<!s)s$/, '') : w);
/** The words that carry meaning, once each, keyed by stem but keeping the word as written for display. */
function keywordsOf(text) {
  const seen = new Map();
  for (const w of normalizeAnswer(text).split(' ')) if (w && (w.length > 2 || /\d/.test(w)) && !STOP.has(w) && !seen.has(stem(w))) seen.set(stem(w), w);
  return [...seen].map(([s, word]) => ({ s, word }));
}
const sameWord = (a, b) => a === b
  || (Math.min(a.length, b.length) >= 3 && (a.startsWith(b) || b.startsWith(a)) && Math.abs(a.length - b.length) <= 2)
  || (a.length >= 5 && Math.abs(a.length - b.length) <= 1 && editDistance(a, b) <= 1);

/**
 * How much of a card's written answer a free reply covers, for answers too long to match exactly.
 *
 * The opening of the answer — its bold term or first sentence — is what the card is asking for, so
 * it carries most of the score. The explanation after it counts too, but covering half of its key
 * words is already full marks there: nobody recites a paragraph word for word.
 */
export function compareAnswer(reply, card) {
  const parts = answerParts(card);
  if (!parts) return null;
  // Words the question already says are not something the answer has to repeat.
  const asked = new Set(keywordsOf(plainOf(card?.front?.text || '')).map(k => k.s));
  const key = keywordsOf(plainOf(parts.display)).filter(k => !asked.has(k.s));
  const full = String(card?.back?.text || '').trim() ? plainOf(card.back.text) : plainOf(parts.display);
  const rest = keywordsOf(full).filter(k => !asked.has(k.s) && !key.some(x => x.s === k.s));
  const said = keywordsOf(reply).map(k => k.s);
  const words = list => list.map(k => k.word);
  if (parts.target) {
    const verdict = gradeAnswer(reply, parts.target);
    if (verdict !== 'wrong') return { score: verdict === 'exact' ? 1 : 0.9, verdict: verdict === 'exact' ? 'right' : 'close', hit: words(key), missed: [] };
  }
  const covered = k => said.some(s => sameWord(s, k.s));
  const hitKey = key.filter(covered), hitRest = rest.filter(covered);
  const keyShare = key.length ? hitKey.length / key.length : 0;
  const restShare = rest.length ? Math.min(1, (2 * hitRest.length) / rest.length) : keyShare;
  const score = key.length ? 0.6 * keyShare + 0.4 * restShare : restShare;
  return {
    score: Math.round(score * 100) / 100,
    verdict: score >= 0.7 ? 'right' : score >= 0.4 ? 'close' : 'wrong',
    hit: words([...hitKey, ...hitRest]).slice(0, 12),
    missed: words([...key.filter(k => !hitKey.includes(k)), ...rest.filter(k => !hitRest.includes(k))]).slice(0, 8),
  };
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
