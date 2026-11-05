/**
 * Notebooks and their pages, shared by the server's validation and the editor.
 *
 * A page is Markdown, the same dialect cards use. Pictures and drawings sit in it as embed lines of
 * their own — `![caption](media:<id>)` and `![caption](drawing:<id>)` — so the whole page stays one
 * string that can be searched, exported or read by anything that understands Markdown, while the
 * bytes live in object storage under the notebook. An embed is only recognised on a line by itself,
 * which keeps the rule simple enough that the server and the browser cannot disagree about it.
 */

export const NOTE_LIMITS = {
  title: 120,
  body: 100_000,
  tags: 10,
  notesPerNotebook: 1000,
  notebooksPerUser: 200,
  collectionsPerUser: 50,
  membersPer: 50,
  imagesPerNote: 30,
  drawingsPerNote: 20,
  // Across the whole notebook, so uploads that never make it into a page cannot pile up forever.
  imagesPerNotebook: 500,
  drawingsPerNotebook: 500,
  searchQuery: 100,
  searchResults: 30,
  snippet: 160,
  // One download, and so one response: a notebook past this exports its first pages and says so.
  exportPages: 300,
};

/**
 * A picture or drawing can say how wide it is shown, as a share of the page: `media:<id>?w=50` is
 * half the width. A share rather than pixels, because the same page is read on a phone and on a
 * wide screen and a pixel width is wrong on one of them. Absent means "as it comes", which is
 * every page written before this existed, so none of them change.
 */
export const EMBED_WIDTH = { min: 10, max: 100, step: 5 };
export const clampWidth = value => {
  const n = Math.round(Number(value) / EMBED_WIDTH.step) * EMBED_WIDTH.step;
  return Number.isFinite(n) ? Math.min(EMBED_WIDTH.max, Math.max(EMBED_WIDTH.min, n)) : EMBED_WIDTH.max;
};

const EMBED_LINE = /^!\[([^\]\n]{0,200})\]\((media|drawing):([0-9a-fA-F-]{24,36})(?:\?w=(\d{1,3}))?\)[ \t]*$/gm;
/** A width written in a line, or null for "as it comes". 100 is the same as not saying. */
const widthOf = raw => (raw ? (clampWidth(raw) < EMBED_WIDTH.max ? clampWidth(raw) : null) : null);

/** Every embed in a page, in order: `{ kind: 'media' | 'drawing', id, caption, width }`. */
export function embedsIn(body = '') {
  const out = [];
  for (const m of String(body).matchAll(EMBED_LINE)) out.push({ kind: m[2], id: m[3], caption: m[1], width: widthOf(m[4]) });
  return out;
}

/** The page cut into runs of Markdown and the embeds between them, for rendering. */
export function segmentsOf(body = '') {
  const text = String(body), parts = [];
  let last = 0;
  for (const m of text.matchAll(EMBED_LINE)) {
    if (m.index > last) parts.push({ kind: 'text', text: text.slice(last, m.index) });
    parts.push({ kind: m[2], id: m[3], caption: m[1], width: widthOf(m[4]) });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ kind: 'text', text: text.slice(last) });
  return parts.filter(p => p.kind !== 'text' || p.text.trim());
}

export const embedLine = (kind, id, caption = '', width = null) => {
  const w = width ? widthOf(width) : null;
  return `![${String(caption).replace(/[\]\n]/g, ' ').slice(0, 200)}](${kind}:${id}${w ? `?w=${w}` : ''})`;
};

/**
 * The page with its `index`th picture or drawing set to a new width, and nothing else touched.
 * Counted among embeds only, in the order `segmentsOf` yields them, so the preview can say which
 * one it means without knowing where its line sits in the text.
 */
export function setEmbedWidth(body = '', index, width) {
  let seen = -1;
  return String(body).replace(EMBED_LINE, (line, caption, kind, id) => (++seen === index ? embedLine(kind, id, caption, width) : line));
}

/** Removes every embed line that points at one of these ids, for when the picture itself is gone. */
export function withoutEmbeds(body = '', ids = []) {
  const gone = new Set(ids.map(String));
  return String(body).replace(EMBED_LINE, (line, caption, kind, id) => (gone.has(id) ? '' : line)).replace(/\n{3,}/g, '\n\n');
}

/** A one-line preview for the page list: no Markdown syntax, no embeds. */
export function snippetOf(body = '') {
  return String(body).replace(EMBED_LINE, ' ').replace(/[*_`~$]+/g, '').replace(/[#>[\]()|-]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, NOTE_LIMITS.snippet);
}
