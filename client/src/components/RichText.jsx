import { useEffect, useMemo, useState } from 'react';
import { marked } from 'marked';
import { sanitize } from '../services/purify';
import { renderCloze, hasCloze } from '../../../shared/cloze.js';
marked.setOptions({ gfm: true, breaks: true });
// KaTeX is ~300 KB, so it is loaded on demand the first time a card actually contains math.
let katexPromise; const loadKatex = () => (katexPromise ||= Promise.all([import('katex'), import('katex/dist/katex.min.css')]).then(([k]) => k.default));
const MATH_RE = /\$\$([\s\S]+?)\$\$|(?<![\\$\w])\$(?!\s)((?:\\.|[^$\n])+?)(?<!\s)\$(?!\w)/g;
const hasMath = text => { MATH_RE.lastIndex = 0; return MATH_RE.test(text); };
const SENTINELS = { '\uE000': '<mark class="cloze">', '\uE001': '</mark>', '\uE002': '<mark class="cloze cloze-hidden">', '\uE003': '</mark>' };
/** Markdown + LaTeX + cloze renderer. Output is sanitised in services/purify; only http(s)/mailto links survive. */
export function renderRich(text, { cloze = 'show', katex = null } = {}) {
  let src = renderCloze(text, cloze);
  const math = [];
  if (katex) src = src.replace(MATH_RE, (_m, block, inline) => { const i = math.push(katex.renderToString(block ?? inline, { displayMode: !!block, throwOnError: false, output: 'html' })) - 1; return `\uE010${i}\uE011`; });
  let html = marked.parse(src);
  html = html.replace(/[\uE000-\uE003]/g, ch => SENTINELS[ch]).replace(/\uE010(\d+)\uE011/g, (_m, i) => math[Number(i)]);
  return sanitize(html);
}
/** Plain-text summary for previews and search: cloze answers kept, Markdown syntax and math delimiters dropped. */
export const plainText = text => renderCloze(text, 'show', { open: '', close: '' }).replace(/\$\$?/g, '').replace(/[*_`>#]+/g, '').trim();
/** Which side to show. A cloze card with an empty back reveals its front with the deletions filled in as its "answer". */
export function sideOf(card, flipped) {
  const clozeCard = hasCloze(card.front.text) && !card.back.text.trim() && !card.back.image;
  if (clozeCard) return { ...card.front, cloze: flipped ? 'show' : 'hide' };
  return { ...(flipped ? card.back : card.front), cloze: 'show' };
}
export default function RichText({ text = '', cloze = 'show', className = '', as: Tag = 'div' }) {
  const needsMath = useMemo(() => hasMath(text), [text]); const [katex, setKatex] = useState(null);
  useEffect(() => { if (needsMath && !katex) loadKatex().then(setKatex); }, [needsMath, katex]);
  const html = useMemo(() => renderRich(text, { cloze, katex: needsMath ? katex : null }), [text, cloze, katex, needsMath]);
  return <Tag className={`rich-text ${hasCloze(text) ? 'has-cloze' : ''} ${className}`} dangerouslySetInnerHTML={{ __html: html }}/>;
}
