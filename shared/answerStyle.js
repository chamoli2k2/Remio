/**
 * How a person likes the answers on their cards written, when an assistant writes them.
 *
 * Preferences, not a template. Every option changes the guidance an assistant is given; none of
 * them adds headings, sections or labels to a card. A person who wants "Example:" written out can
 * say so in their own guidance, and everybody else gets an answer shaped by the idea it explains.
 *
 * Shared so the settings page offers exactly the choices the server accepts, and so the guidance
 * an assistant reads is written in one place.
 */

export const DETAIL = {
  brief: { label: 'Brief', guide: 'Keep answers short: the answer itself and at most one or two sentences of explanation.' },
  standard: { label: 'Standard', guide: 'Give the answer, then explain it in a few plain sentences; let length follow the idea.' },
  detailed: { label: 'Detailed', guide: 'Give the answer, then a fuller explanation that covers the why, the edge cases and how it connects to related ideas, still without padding.' },
};

export const FORMAT = {
  prose: { label: 'Short paragraphs', guide: 'Write in short paragraphs of plain prose.' },
  bullets: { label: 'Bullet points', guide: 'After the opening answer, put the explanation as a short bulleted list.' },
  steps: { label: 'Numbered steps', guide: 'Where the answer is a process, write it as numbered steps; otherwise use short paragraphs.' },
  'example-first': { label: 'Example first', guide: 'Lead with a concrete example, then state the general rule it shows.' },
  custom: { label: 'My own instructions', guide: 'Follow the person’s own formatting guidance below.' },
};

export const EXTRAS = {
  examples: { label: 'Examples', guide: 'a concrete example where the idea is abstract or easy to misapply' },
  analogies: { label: 'Analogies', guide: 'an everyday analogy where it makes the idea click' },
  code: { label: 'Code', guide: 'a short code snippet where the topic is programming' },
  tradeoffs: { label: 'Trade-offs', guide: 'the main trade-offs or when not to use it, where there is a choice to make' },
};

export const AUDIENCE = {
  general: { label: 'General', guide: '' },
  beginner: { label: 'Beginner', guide: 'Write for a beginner: define every term and assume no background.' },
  interview: { label: 'Interview prep', guide: 'Write for interview preparation: answers someone could say out loud, precise terms, and the follow-up an interviewer would expect.' },
  revision: { label: 'Revision', guide: 'Write for revision: the key facts someone needs to recall, with as little explanation as still makes sense.' },
};

export const CUSTOM_GUIDANCE_MAX = 500;

/** What an assistant follows for someone who has chosen nothing. */
export const DEFAULT_ANSWER_STYLE = Object.freeze({ detail: 'standard', format: 'prose', include: ['examples'], audience: 'general', custom: '' });

/**
 * A person's own words, made safe to put in front of a model as a style note: one line, no
 * control characters, nothing that could pass for the end of a quoted block, and short.
 */
export function cleanGuidance(text) {
  return String(text ?? '')
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ')
    .replace(/`{3,}|"{3,}|<\/?[a-z][^>]*>/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, CUSTOM_GUIDANCE_MAX);
}

/** Layers merged in order, later ones winning field by field; anything unset falls through to the default. */
export function resolveAnswerStyle(...layers) {
  const out = { ...DEFAULT_ANSWER_STYLE };
  for (const layer of layers) {
    if (!layer) continue;
    for (const key of Object.keys(DEFAULT_ANSWER_STYLE)) if (layer[key] !== undefined && layer[key] !== null) out[key] = layer[key];
  }
  if (out.format === 'custom' && !out.custom) out.format = DEFAULT_ANSWER_STYLE.format;
  return out;
}

/** The guidance an assistant is given for a style, as plain sentences. The custom text is returned separately. */
export function styleGuide(style) {
  const s = resolveAnswerStyle(style);
  const extras = s.include.filter(id => EXTRAS[id]).map(id => EXTRAS[id].guide);
  return [
    'Open every answer with the direct answer in one plain sentence, so it can be checked at a glance.',
    DETAIL[s.detail].guide,
    FORMAT[s.format].guide,
    extras.length ? `Include ${extras.join('; ')}. Leave out any of these where it would not help the card.` : 'Do not add examples, analogies or code unless the card cannot be understood without one.',
    AUDIENCE[s.audience].guide,
    'Do not add fixed headings or labels such as "Interview answer:", "Example:" or "Key takeaway:" unless the person asked for them.',
    'Stay accurate and on the card’s topic.',
  ].filter(Boolean);
}
