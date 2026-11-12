import { MAX_IMPORT_CARDS, MAX_IMPORT_TEXT } from '../constants/index.js';
import { unzipSync, strFromU8 } from 'fflate';
import { createRequire } from 'node:module';
import { hasCloze } from '../../../shared/cloze.js';
// Parsers for bringing cards in from other tools. Every parser is a pure function that returns normalised
// { front, back, tags, hint, source } objects; validation against the card schema happens in the service.
export const MAX_CARDS = MAX_IMPORT_CARDS, MAX_TEXT = MAX_IMPORT_TEXT;
const clean = s => String(s ?? '').replace(/\r\n?/g, '\n').trim().slice(0, MAX_TEXT);
const normaliseTags = tags => [...new Set((Array.isArray(tags) ? tags : String(tags || '').split(/[\s,;]+/)).map(t => String(t).trim().toLowerCase().replace(/^#/, '').slice(0, 30)).filter(Boolean))].slice(0, 10);
export const makeCard = ({ front, back, tags = [], hint = '', source = '' }) => ({ front: { text: clean(front), image: null }, back: { text: clean(back), image: null }, tags: normaliseTags(tags), hint: clean(hint).slice(0, 1000), source: /^https?:\/\/\S+$/.test(String(source || '').trim()) ? String(source).trim() : '' });
// Anki cloze notes arrive with the whole sentence in the first field and an empty (or "extra") second field.
const usable = c => c.front.text && (c.back.text || hasCloze(c.front.text));
/** Anki fields are HTML. Keep line breaks and cloze markers, drop tags, media references and entities. */
export function stripHtml(html) {
  return String(html ?? '').replace(/\[sound:[^\]]*\]/g, '').replace(/<br\s*\/?>|<\/(?:p|div|li|h\d|tr)>/gi, '\n').replace(/<li[^>]*>/gi, '• ').replace(/<img[^>]*>/gi, '').replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&').replace(/\n{3,}/g, '\n\n').trim();
}
/** RFC 4180-ish CSV/TSV parser: quoted fields, escaped quotes, newlines inside quotes, auto-detected delimiter. */
export function parseDelimited(text, delimiter) {
  const src = String(text).replace(/^\uFEFF/, ''); const sep = delimiter || (src.split('\n', 5).join('\n').includes('\t') ? '\t' : ',');
  const rows = []; let row = [], field = '', quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) { if (ch === '"') { if (src[i + 1] === '"') { field += '"'; i++; } else quoted = false; } else field += ch; continue; }
    if (ch === '"') quoted = true; else if (ch === sep) { row.push(field); field = ''; } else if (ch === '\n' || ch === '\r') { if (ch === '\r' && src[i + 1] === '\n') i++; row.push(field); rows.push(row); row = []; field = ''; } else field += ch;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim()));
}
const HEADER_ALIASES = { front: ['front', 'question', 'term', 'prompt', 'q', 'word'], back: ['back', 'answer', 'definition', 'response', 'a', 'meaning'], tags: ['tags', 'tag', 'labels'], hint: ['hint', 'clue'], source: ['source', 'url', 'link', 'reference'] };
function columnMap(header) {
  const cells = header.map(h => h.trim().toLowerCase()); const map = {};
  for (const [field, names] of Object.entries(HEADER_ALIASES)) { const i = cells.findIndex(c => names.includes(c)); if (i !== -1) map[field] = i; }
  return map.front != null && map.back != null ? map : null;
}
/** CSV/TSV with an optional header row (front, back, tags, hint, source in any order) or positional columns. */
export function parseCsv(text) {
  const rows = parseDelimited(text); if (!rows.length) return [];
  const map = columnMap(rows[0]); const body = map ? rows.slice(1) : rows; const m = map || { front: 0, back: 1, tags: 2, hint: 3, source: 4 };
  return body.map(r => makeCard({ front: r[m.front], back: r[m.back], tags: m.tags != null ? r[m.tags] : '', hint: m.hint != null ? r[m.hint] : '', source: m.source != null ? r[m.source] : '' })).filter(usable);
}
/** Anki "Notes in Plain Text" export: #-prefixed metadata lines, then tab-separated fields (HTML), tags in the last column when #tags column is declared. */
export function parseAnkiText(text) {
  const lines = String(text).replace(/^\uFEFF/, '').split(/\r?\n/); const meta = {}; let i = 0;
  while (i < lines.length && lines[i].startsWith('#')) { const [k, v] = lines[i].slice(1).split(':'); meta[k.trim().toLowerCase()] = (v || '').trim(); i++; }
  const sep = { tab: '\t', comma: ',', semicolon: ';', pipe: '|', colon: ':', space: ' ' }[meta.separator?.toLowerCase()] || '\t';
  const rows = parseDelimited(lines.slice(i).join('\n'), sep); const tagsCol = meta['tags column'] ? Number(meta['tags column']) - 1 : -1; const skip = new Set([meta.guid === 'true' || meta['guid column'] ? Number(meta['guid column'] || 1) - 1 : -1, meta['notetype column'] ? Number(meta['notetype column']) - 1 : -1, meta['deck column'] ? Number(meta['deck column']) - 1 : -1, tagsCol]);
  return rows.map(r => { const fields = r.filter((_, idx) => !skip.has(idx)); return makeCard({ front: stripHtml(fields[0]), back: stripHtml(fields[1]), tags: tagsCol >= 0 ? r[tagsCol] : '' }); }).filter(usable);
}
/**
 * Markdown in any of four shapes: "Q: … / A: …" blocks, "## heading" followed by the answer body, "term :: definition"
 * lines (optionally as list items), or two-column tables. Tags come from a "tags: a, b" line or #hashtags at the end of a block.
 */
export function parseMarkdown(text) {
  const src = String(text).replace(/\r\n?/g, '\n'); const cards = [];
  const tagsFrom = block => { const m = block.match(/^\s*tags?:\s*(.+)$/im); const hashes = [...block.matchAll(/(?:^|\s)#([\w-]{1,30})\b/g)].map(x => x[1]); return [...(m ? m[1].split(/[,\s]+/) : []), ...hashes]; };
  const strip = block => block.replace(/^\s*tags?:\s*.+$/im, '').replace(/(?:^|\s)#[\w-]{1,30}\b/g, '').trim();
  for (const row of src.matchAll(/^\|(.+)\|\s*$/gm)) { const cells = row[1].split('|').map(c => c.trim()); if (cells.length >= 2 && !/^:?-{2,}:?$/.test(cells[0]) && !['front', 'question', 'term'].includes(cells[0].toLowerCase())) cards.push(makeCard({ front: cells[0], back: cells[1], tags: cells[2] || '' })); }
  for (const m of src.matchAll(/^\s*(?:[-*]\s+)?(.+?)\s+::\s+(.+)$/gm)) cards.push(makeCard({ front: m[1], back: strip(m[2]), tags: tagsFrom(m[2]) }));
  for (const m of src.matchAll(/^\s*Q:\s*([\s\S]*?)\n\s*A:\s*([\s\S]*?)(?=\n\s*Q:|\n\s*#{1,6}\s|\n\s*\n|(?![\s\S]))/gim)) cards.push(makeCard({ front: strip(m[1]), back: strip(m[2]), tags: tagsFrom(m[1] + '\n' + m[2]) }));
  if (!cards.length) for (const m of src.matchAll(/^#{1,6}\s+(.+)\n([\s\S]*?)(?=\n#{1,6}\s|$)/gm)) cards.push(makeCard({ front: m[1], back: strip(m[2]), tags: tagsFrom(m[2]) }));
  return cards.filter(usable);
}
/** Our own JSON export (or any { cards: [{ front, back, tags }] } / [{ front, back }] document). */
export function parseJson(text) {
  const data = JSON.parse(String(text)); const list = Array.isArray(data) ? data : Array.isArray(data.cards) ? data.cards : [];
  return list.map(c => makeCard({ front: c.front?.text ?? c.front, back: c.back?.text ?? c.back, tags: c.tags, hint: c.hint, source: c.source })).filter(usable);
}
let sqlPromise;
const loadSql = () => (sqlPromise ||= import('sql.js').then(m => m.default({ locateFile: f => createRequire(import.meta.url).resolve(`sql.js/dist/${f}`) })));
/** Anki .apkg (zip with a SQLite collection). Fields are split on the 0x1f separator; first field → front, second → back. */
export async function parseApkg(buffer) {
  let files; try { files = unzipSync(new Uint8Array(buffer)); } catch { throw Object.assign(new Error('This file is not a valid .apkg archive.'), { status: 400 }); }
  const db = files['collection.anki21'] || files['collection.anki2'];
  if (!db) { if (files['collection.anki21b']) throw Object.assign(new Error('This deck uses the newest Anki format. Re-export it with "Support older Anki versions" checked, or export as Notes in Plain Text (.txt).'), { status: 400 }); throw Object.assign(new Error('No Anki collection found in this archive.'), { status: 400 }); }
  const SQL = await loadSql(); const sqlite = new SQL.Database(db);
  try {
    const rows = sqlite.exec('SELECT flds, tags FROM notes LIMIT ' + (MAX_CARDS + 1))[0]?.values || [];
    return rows.map(([flds, tags]) => { const f = String(flds).split('\x1f'); return makeCard({ front: stripHtml(f[0]), back: stripHtml(f.slice(1).filter(Boolean).join('\n\n')), tags }); }).filter(usable);
  } finally { sqlite.close(); }
}
export const detectFormat = (name = '', type = '') => { const ext = name.toLowerCase().split('.').pop(); return ext === 'apkg' || ext === 'colpkg' ? 'apkg' : ext === 'json' ? 'json' : ext === 'md' || ext === 'markdown' ? 'markdown' : ext === 'csv' || ext === 'tsv' ? 'csv' : ext === 'txt' ? 'text' : type.includes('json') ? 'json' : type.includes('csv') ? 'csv' : 'text'; };
/** Routes a file to the right parser. Plain .txt is Anki text when it carries #separator metadata, otherwise CSV/TSV. */
export async function parseFile(buffer, name, type) {
  const format = detectFormat(name, type);
  if (format === 'apkg') return { format, cards: await parseApkg(buffer) };
  const text = strFromU8(new Uint8Array(buffer));
  if (format === 'json') return { format, cards: parseJson(text) };
  if (format === 'markdown') return { format, cards: parseMarkdown(text) };
  if (/^#(separator|html|tags column|columns|deck|notetype)/im.test(text.slice(0, 500))) return { format: 'anki-text', cards: parseAnkiText(text) };
  return { format: 'csv', cards: parseCsv(text) };
}
/** CSV export with RFC 4180 quoting. */
export const toCsv = cards => ['front,back,tags,hint,source', ...cards.map(c => [c.front.text, c.back.text, c.tags.join(' '), c.hint, c.source].map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','))].join('\r\n');
