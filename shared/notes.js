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
  imagesPerNote: 30,
  drawingsPerNote: 20,
  // Across the whole notebook, so uploads that never make it into a page cannot pile up forever.
  imagesPerNotebook: 500,
  drawingsPerNotebook: 500,
  searchQuery: 100,
  searchResults: 30,
  snippet: 160,
};

const EMBED_LINE = /^!\[([^\]\n]{0,200})\]\((media|drawing):([0-9a-fA-F-]{24,36})\)[ \t]*$/gm;

/** Every embed in a page, in order: `{ kind: 'media' | 'drawing', id, caption }`. */
export function embedsIn(body = '') {
  const out = [];
  for (const m of String(body).matchAll(EMBED_LINE)) out.push({ kind: m[2], id: m[3], caption: m[1] });
  return out;
}

/** The page cut into runs of Markdown and the embeds between them, for rendering. */
export function segmentsOf(body = '') {
  const text = String(body), parts = [];
  let last = 0;
  for (const m of text.matchAll(EMBED_LINE)) {
    if (m.index > last) parts.push({ kind: 'text', text: text.slice(last, m.index) });
    parts.push({ kind: m[2], id: m[3], caption: m[1] });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ kind: 'text', text: text.slice(last) });
  return parts.filter(p => p.kind !== 'text' || p.text.trim());
}

export const embedLine = (kind, id, caption = '') => `![${String(caption).replace(/[\]\n]/g, ' ').slice(0, 200)}](${kind}:${id})`;

/** A one-line preview for the page list: no Markdown syntax, no embeds. */
export function snippetOf(body = '') {
  return String(body).replace(EMBED_LINE, ' ').replace(/[*_`~$]+/g, '').replace(/[#>[\]()|-]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, NOTE_LIMITS.snippet);
}
