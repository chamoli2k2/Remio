/**
 * The drawing format, shared by the editor, the viewer and the server's validator.
 *
 * A drawing is a self-contained document of pen strokes, not a picture and not a database row.
 * It is stored as one JSON object in object storage, addressed by a key built from the folder
 * and a random id; a card side refers to it by that id alone, as a plain string. Nothing about a
 * drawing therefore depends on which database the cards live in, and moving cards to another
 * store means carrying a string field across, nothing more.
 *
 * Vectors rather than pixels so a drawing can be opened and edited again, stays sharp at any
 * size, and is a few kilobytes rather than a screenshot. Coordinates are on a fixed logical page
 * and rounded to whole units, which is precise enough for handwriting and keeps the JSON small.
 *
 * Every saved drawing is immutable. Editing one saves a new document under a new id, so a card's
 * version history still points at what it used to show, and the stored object can be cached
 * forever by anybody allowed to see it.
 */

export const DRAWING_VERSION = 1;

/**
 * The logical page. 16:10 sits well on a card and on a laptop screen in full-screen mode. A
 * drawing is always one page wide and grows downwards a whole page at a time, so a page of notes
 * that runs out of room carries on below rather than being squeezed in.
 */
export const PAGE = { width: 1600, height: 1000 };
export const MAX_PAGES = 6;
export const MAX_HEIGHT = PAGE.height * MAX_PAGES;

export const PAPERS = ['blank', 'ruled', 'grid'];
export const THEMES = ['light', 'dark'];
/** `pen` and `highlighter` add ink; `eraser` rubs ink out where it passes, like a real one. */
export const TOOLS = ['pen', 'highlighter', 'eraser'];

export const SIZE = { min: 1, max: 60 };

/**
 * Ceilings that keep one drawing a reasonable object: an enthusiastic page of notes is a few
 * hundred strokes and tens of thousands of points, so these are far above honest use and far
 * below anything that would make storage or rendering a problem.
 */
export const LIMITS = { strokes: 4000, pointsPerStroke: 6000, points: 160_000, bytes: 1_000_000 };

export const INK = {
  light: ['#1f1d28', '#2f6fdf', '#d6334a', '#1f9d61', '#e07b13', '#7a4be0'],
  dark: ['#f4f1fa', '#7fb2ff', '#ff7a8c', '#5fd99a', '#ffb357', '#c3a6ff'],
};
export const HIGHLIGHTS = ['#ffe14d', '#7dffa0', '#ff8fd0', '#7fd6ff', '#ffb35c'];

export const PAPER_COLORS = { light: '#ffffff', dark: '#1d1f26' };
const LINE_COLORS = { light: 'rgba(80,110,170,.22)', dark: 'rgba(200,210,235,.14)' };
const MARGIN_COLORS = { light: 'rgba(214,51,74,.28)', dark: 'rgba(255,122,140,.22)' };
export const HIGHLIGHT_ALPHA = 0.38;
export const RULE_GAP = 50;

export const HEX = /^#[0-9a-f]{6}$/i;
export const DRAWING_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const emptyDrawing = (theme = 'light') => ({ v: DRAWING_VERSION, w: PAGE.width, h: PAGE.height, paper: 'blank', theme, strokes: [] });

/**
 * The paper itself: its colour and, for ruled or grid paper, the lines. Drawn separately from the
 * ink so the eraser, which removes ink, never rubs the lines off the page.
 */
export function paintPaper(ctx, doc, scale = 1) {
  const { w, h } = doc;
  ctx.save();
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.fillStyle = PAPER_COLORS[doc.theme] || PAPER_COLORS.light;
  ctx.fillRect(0, 0, w, h);
  if (doc.paper === 'ruled' || doc.paper === 'grid') {
    ctx.strokeStyle = LINE_COLORS[doc.theme] || LINE_COLORS.light;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let y = RULE_GAP * 2; y < h; y += RULE_GAP) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
    if (doc.paper === 'grid') for (let x = RULE_GAP; x < w; x += RULE_GAP) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
    ctx.stroke();
    if (doc.paper === 'ruled') {
      ctx.strokeStyle = MARGIN_COLORS[doc.theme] || MARGIN_COLORS.light;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(120, 0); ctx.lineTo(120, h); ctx.stroke();
    }
  }
  ctx.restore();
}

/** One stroke, smoothed through the midpoints of its samples so handwriting does not look jagged. */
export function paintStroke(ctx, stroke) {
  const p = stroke.p;
  if (!p || p.length < 2) return;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = stroke.s;
  if (stroke.t === 'eraser') {
    ctx.globalCompositeOperation = 'destination-out';
    ctx.strokeStyle = '#000';
    ctx.fillStyle = '#000';
  } else {
    ctx.strokeStyle = stroke.c;
    ctx.fillStyle = stroke.c;
    if (stroke.t === 'highlighter') { ctx.globalAlpha = HIGHLIGHT_ALPHA; ctx.lineCap = 'butt'; }
  }
  if (p.length === 2) {
    // A tap: a dot, which a zero-length path would not draw.
    ctx.beginPath(); ctx.arc(p[0], p[1], stroke.s / 2, 0, Math.PI * 2); ctx.fill();
  } else {
    ctx.beginPath();
    ctx.moveTo(p[0], p[1]);
    for (let i = 2; i < p.length - 2; i += 2) {
      const mx = (p[i] + p[i + 2]) / 2, my = (p[i + 1] + p[i + 3]) / 2;
      ctx.quadraticCurveTo(p[i], p[i + 1], mx, my);
    }
    ctx.lineTo(p[p.length - 2], p[p.length - 1]);
    ctx.stroke();
  }
  ctx.restore();
}

/** All the ink, on its own layer so eraser strokes can cut through it without touching the paper. */
export function paintInk(ctx, doc, scale = 1) {
  ctx.save();
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.clearRect(0, 0, doc.w, doc.h);
  for (const stroke of doc.strokes) paintStroke(ctx, stroke);
  ctx.restore();
}

/** Whether a stroke passes within `radius` of a point, for the whole-stroke eraser. */
export function strokeHits(stroke, x, y, radius) {
  if (stroke.t === 'eraser') return false;
  const reach = radius + stroke.s / 2;
  const r2 = reach * reach, p = stroke.p;
  for (let i = 0; i < p.length; i += 2) {
    const dx = p[i] - x, dy = p[i + 1] - y;
    if (dx * dx + dy * dy <= r2) return true;
    if (i + 3 < p.length) {
      // Distance to the segment, so a fast straight line is not missed between its two samples.
      const ex = p[i + 2] - p[i], ey = p[i + 3] - p[i + 1];
      const len = ex * ex + ey * ey;
      if (len) {
        const t = Math.max(0, Math.min(1, ((x - p[i]) * ex + (y - p[i + 1]) * ey) / len));
        const qx = p[i] + t * ex - x, qy = p[i + 1] + t * ey - y;
        if (qx * qx + qy * qy <= r2) return true;
      }
    }
  }
  return false;
}

/** Whether anything visible has been drawn. An eraser stroke alone draws nothing. */
export const hasInk = doc => !!doc?.strokes?.some(s => s.t !== 'eraser');

export const pagesIn = doc => Math.max(1, Math.round(doc.h / PAGE.height));

/** The lowest point any ink reaches, counting the width of the tip. */
export function inkBottom(doc) {
  let bottom = 0;
  for (const s of doc.strokes) {
    if (s.t === 'eraser') continue;
    for (let i = 1; i < s.p.length; i += 2) bottom = Math.max(bottom, s.p[i] + s.s / 2);
  }
  return bottom;
}

/** Which page a stroke belongs to: the one holding the middle of its height. */
export function pageOf(stroke) {
  let top = Infinity, bottom = -Infinity;
  for (let i = 1; i < stroke.p.length; i += 2) { top = Math.min(top, stroke.p[i]); bottom = Math.max(bottom, stroke.p[i]); }
  return Math.max(0, Math.floor((top + bottom) / 2 / PAGE.height));
}

export const pageHasInk = (doc, index) => doc.strokes.some(s => s.t !== 'eraser' && pageOf(s) === index);

/** The drawing with one page taken out: its strokes go, and everything below moves up a page. */
export function removePage(doc, index) {
  if (pagesIn(doc) <= 1) return { ...doc, strokes: [] };
  const strokes = [];
  for (const s of doc.strokes) {
    const page = pageOf(s);
    if (page === index) continue;
    strokes.push(page < index ? s : { ...s, p: s.p.map((v, i) => (i % 2 ? Math.max(-50, v - PAGE.height) : v)) });
  }
  return { ...doc, h: doc.h - PAGE.height, strokes };
}

/** The drawing without the empty pages at its end. */
export function trimDrawing(doc) {
  const h = Math.min(doc.h, Math.max(PAGE.height, Math.ceil(inkBottom(doc) / PAGE.height) * PAGE.height));
  return h === doc.h ? doc : { ...doc, h };
}

/**
 * Device pixels per CSS pixel for a canvas of this size: sharp on high-density screens, but kept
 * under the area mobile browsers allow a canvas, past which Safari silently draws nothing.
 */
export const MAX_CANVAS_PIXELS = 8_000_000;
export const canvasRatio = (width, height, dpr = 1) =>
  Math.max(0.5, Math.min(dpr, 2, Math.sqrt(MAX_CANVAS_PIXELS / Math.max(1, width * height))));
