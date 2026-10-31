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
export const LIMITS = { strokes: 4000, pointsPerStroke: 6000, points: 160_000, bytes: 1_000_000, objects: 400, textLength: 1000, textTotal: 30_000 };

/**
 * Shapes and text boxes sit on the page beside the pen strokes, as objects that stay editable:
 * they can be picked up, moved and resized after they are placed, which ink cannot.
 *
 * Every object has a box `{ x, y, w, h }` in page units. A box shape (`rect`, `ellipse`,
 * `triangle`, `diamond`) fills it. A `line` or `arrow` runs from `(x, y)` to `(x + w, y + h)`, so
 * `w` and `h` are signed. Text wraps inside `w` and its `h` is stored, worked out by whoever last
 * edited it, so a box can be found and selected without measuring any text.
 *
 * Text is drawn onto the canvas and never inserted into a page as markup.
 */
export const SHAPES = ['rect', 'ellipse', 'triangle', 'diamond', 'line', 'arrow'];
export const BOX_SHAPES = ['rect', 'ellipse', 'triangle', 'diamond'];
export const OBJECT_TYPES = [...SHAPES, 'text'];
export const OBJECT_ID = /^[a-z0-9]{4,16}$/;
export const STROKE_WIDTH = { min: 1, max: 24 };
export const FONT_SIZE = { min: 12, max: 300 };
export const MIN_BOX = 12;
export const FONT = '"DM Sans Variable", system-ui, -apple-system, "Segoe UI", "Noto Sans", sans-serif';
export const LINE_HEIGHT = 1.3;
export const FILL_ALPHA = 0.18;

export const newObjectId = () => Math.random().toString(36).slice(2, 10).padEnd(8, '0');

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

export const emptyDrawing = (theme = 'light') => ({ v: DRAWING_VERSION, w: PAGE.width, h: PAGE.height, paper: 'blank', theme, strokes: [], objects: [] });

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

/**
 * All the ink, on its own layer so eraser strokes can cut through it without touching the paper.
 * Objects go on top once the ink is down, so rubbing out never takes a shape or a label with it.
 */
export function paintInk(ctx, doc, scale = 1, { objects = true } = {}) {
  ctx.save();
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.clearRect(0, 0, doc.w, doc.h);
  for (const stroke of doc.strokes) paintStroke(ctx, stroke);
  if (objects) paintObjects(ctx, doc.objects);
  ctx.restore();
}

/* ── Objects ─────────────────────────────────────────────────────────────────────────────────── */

/** The text broken into lines that fit its box. Long words are split rather than overflowing. */
export function layoutText(ctx, o) {
  ctx.save();
  ctx.font = `${o.fs}px ${FONT}`;
  const lines = [];
  for (const raw of String(o.text || '').split('\n')) {
    let line = '';
    for (const word of raw.split(/( +)/)) {
      if (!word) continue;
      if (ctx.measureText(line + word).width <= o.w || !line.trim()) { line += word; }
      else { lines.push(line.replace(/ +$/, '')); line = word.replace(/^ +/, ''); }
      while (ctx.measureText(line).width > o.w && line.length > 1) {
        let cut = line.length - 1;
        while (cut > 1 && ctx.measureText(line.slice(0, cut)).width > o.w) cut -= 1;
        lines.push(line.slice(0, cut)); line = line.slice(cut);
      }
    }
    lines.push(line);
  }
  ctx.restore();
  return { lines, lineHeight: o.fs * LINE_HEIGHT };
}

/** The height a text box needs for its words. */
export function textHeight(ctx, o) {
  const { lines, lineHeight } = layoutText(ctx, o);
  return Math.max(o.fs, Math.ceil(lines.length * lineHeight));
}

/** Points of a closed shape's outline, in page units. A line has two and is not closed. */
export function shapePoints(o) {
  const { x, y, w, h } = o;
  switch (o.t) {
    case 'rect': return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
    case 'triangle': return [[x + w / 2, y], [x + w, y + h], [x, y + h]];
    case 'diamond': return [[x + w / 2, y], [x + w, y + h / 2], [x + w / 2, y + h], [x, y + h / 2]];
    case 'ellipse': return Array.from({ length: 48 }, (_, i) => { const a = (i / 48) * Math.PI * 2; return [x + w / 2 + (w / 2) * Math.cos(a), y + h / 2 + (h / 2) * Math.sin(a)]; });
    default: return [[x, y], [x + w, y + h]];
  }
}

const isLine = o => o.t === 'line' || o.t === 'arrow';
const head = o => Math.max(16, o.s * 4.5);

/** Where an arrow's shaft stops: the base of the head, so a thick line never pokes through its tip. */
function arrowParts(o) {
  const ex = o.x + o.w, ey = o.y + o.h, len = Math.hypot(o.w, o.h) || 1;
  const size = Math.min(head(o), len * 0.6), ux = o.w / len, uy = o.h / len;
  const bx = ex - ux * size, by = ey - uy * size, half = size * 0.5;
  return { base: [bx, by], tip: [ex, ey], left: [bx - uy * half, by + ux * half], right: [bx + uy * half, by - ux * half] };
}

export function paintObject(ctx, o) {
  ctx.save();
  ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = o.s || 1;
  ctx.strokeStyle = o.c; ctx.fillStyle = o.c;
  if (o.t === 'text') {
    const { lines, lineHeight } = layoutText(ctx, o);
    ctx.font = `${o.fs}px ${FONT}`; ctx.textBaseline = 'middle';
    lines.forEach((line, i) => ctx.fillText(line, o.x, o.y + i * lineHeight + lineHeight / 2));
  } else if (o.t === 'line') {
    ctx.beginPath(); ctx.moveTo(o.x, o.y); ctx.lineTo(o.x + o.w, o.y + o.h); ctx.stroke();
  } else if (o.t === 'arrow') {
    const a = arrowParts(o);
    ctx.beginPath(); ctx.moveTo(o.x, o.y); ctx.lineTo(...a.base); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(...a.tip); ctx.lineTo(...a.left); ctx.lineTo(...a.right); ctx.closePath(); ctx.fill();
    ctx.stroke();
  } else {
    ctx.beginPath();
    if (o.t === 'ellipse') ctx.ellipse(o.x + o.w / 2, o.y + o.h / 2, Math.abs(o.w / 2), Math.abs(o.h / 2), 0, 0, Math.PI * 2);
    else shapePoints(o).forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
    if (o.t !== 'ellipse') ctx.closePath();
    if (o.f) { ctx.save(); ctx.globalAlpha = FILL_ALPHA; ctx.fill(); ctx.restore(); }
    ctx.stroke();
  }
  ctx.restore();
}

export function paintObjects(ctx, objects, { skip = null } = {}) {
  for (const o of objects || []) if (o.id !== skip) paintObject(ctx, o);
}

/** The smallest upright box around an object. Lines have signed sizes, so this is always positive. */
export function boundsOf(o) {
  if (isLine(o)) {
    const pad = o.t === 'arrow' ? head(o) / 2 : 0;
    return { x: Math.min(o.x, o.x + o.w) - pad, y: Math.min(o.y, o.y + o.h) - pad, w: Math.abs(o.w) + pad * 2, h: Math.abs(o.h) + pad * 2 };
  }
  return { x: o.x, y: o.y, w: o.w, h: o.h };
}

const segmentDistance = (px, py, ax, ay, bx, by) => {
  const ex = bx - ax, ey = by - ay, len = ex * ex + ey * ey;
  const t = len ? Math.max(0, Math.min(1, ((px - ax) * ex + (py - ay) * ey) / len)) : 0;
  return Math.hypot(ax + t * ex - px, ay + t * ey - py);
};
const inside = (pts, x, y) => {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
};

/**
 * Whether a point is on an object. Text is its whole box. An outline is its line, with some give
 * so a thin one can be picked up by a finger; a filled shape is also its inside.
 */
export function objectHit(o, x, y, slack = 8) {
  if (o.t === 'text') return x >= o.x - slack && x <= o.x + o.w + slack && y >= o.y - slack && y <= o.y + o.h + slack;
  const reach = (o.s || 1) / 2 + slack, pts = shapePoints(o);
  if (isLine(o)) return segmentDistance(x, y, pts[0][0], pts[0][1], pts[1][0], pts[1][1]) <= reach + (o.t === 'arrow' ? head(o) / 4 : 0);
  if (o.f && inside(pts, x, y)) return true;
  for (let i = 0; i < pts.length; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % pts.length];
    if (segmentDistance(x, y, ax, ay, bx, by) <= reach) return true;
  }
  return false;
}

/** The topmost object under a point, or null. Later objects sit above earlier ones. */
export function objectAt(objects, x, y, slack) {
  for (let i = (objects?.length || 0) - 1; i >= 0; i--) if (objectHit(objects[i], x, y, slack)) return objects[i];
  return null;
}

/** Handles an object offers for resizing, by name. */
export const handlesFor = o => (isLine(o) ? ['start', 'end'] : o.t === 'text' ? ['nw', 'ne', 'se', 'sw', 'w', 'e'] : ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']);

const snap = (dx, dy, step = Math.PI / 12) => { const len = Math.hypot(dx, dy), a = Math.round(Math.atan2(dy, dx) / step) * step; return [Math.cos(a) * len, Math.sin(a) * len]; };

/**
 * The object after dragging one of its handles by `(dx, dy)` from how it was when the drag began.
 * `keep` holds the proportions (a square, a circle) or snaps a line to 15 degrees. Text resizes
 * by width, and from a corner scales its letters with it; `relayout` gives the height it then needs.
 */
export function resizeObject(o, handle, dx, dy, { keep = false, relayout = null } = {}) {
  if (isLine(o)) {
    let [ax, ay, bx, by] = [o.x, o.y, o.x + o.w, o.y + o.h];
    if (handle === 'start') { let [nx, ny] = [bx - (ax + dx), by - (ay + dy)]; if (keep) [nx, ny] = snap(nx, ny); [ax, ay] = [bx - nx, by - ny]; }
    else { let [nx, ny] = [ax + o.w + dx - ax, ay + o.h + dy - ay]; if (keep) [nx, ny] = snap(nx, ny); [bx, by] = [ax + nx, ay + ny]; }
    return { ...o, x: Math.round(ax), y: Math.round(ay), w: Math.round(bx - ax), h: Math.round(by - ay) };
  }
  let left = o.x, top = o.y, right = o.x + o.w, bottom = o.y + o.h;
  if (handle.includes('w')) left = Math.min(left + dx, right - MIN_BOX);
  if (handle.includes('e')) right = Math.max(right + dx, left + MIN_BOX);
  if (handle.includes('n')) top = Math.min(top + dy, bottom - MIN_BOX);
  if (handle.includes('s')) bottom = Math.max(bottom + dy, top + MIN_BOX);
  if (o.t === 'text') {
    const corner = handle.length === 2, width = Math.max(MIN_BOX * 4, right - left);
    const fs = corner ? Math.round(Math.min(FONT_SIZE.max, Math.max(FONT_SIZE.min, o.fs * (width / o.w)))) : o.fs;
    const x = handle.includes('w') ? o.x + o.w - width : o.x;
    const next = { ...o, x: Math.round(x), w: Math.round(width), fs };
    const h = relayout ? relayout(next) : Math.round(o.h * (fs / o.fs));
    return { ...next, h, y: Math.round(handle.includes('n') ? o.y + o.h - h : o.y) };
  }
  if (keep && handle.length === 2) {
    const ratio = o.w / o.h, w = right - left, h = bottom - top, size = Math.max(w / ratio, h);
    const nw = size * ratio, nh = size;
    if (handle.includes('w')) left = right - nw; else right = left + nw;
    if (handle.includes('n')) top = bottom - nh; else bottom = top + nh;
  }
  return { ...o, x: Math.round(left), y: Math.round(top), w: Math.round(right - left), h: Math.round(bottom - top) };
}

/** A new box shape from the two corners of a drag; `keep` makes it a square or a circle. */
export function shapeFromDrag(kind, [x1, y1], [x2, y2], { keep = false } = {}) {
  let dx = x2 - x1, dy = y2 - y1;
  if (kind === 'line' || kind === 'arrow') {
    if (keep) [dx, dy] = snap(dx, dy);
    return { x: Math.round(x1), y: Math.round(y1), w: Math.round(dx), h: Math.round(dy) };
  }
  if (keep) { const m = Math.max(Math.abs(dx), Math.abs(dy)); dx = Math.sign(dx || 1) * m; dy = Math.sign(dy || 1) * m; }
  return { x: Math.round(Math.min(x1, x1 + dx)), y: Math.round(Math.min(y1, y1 + dy)), w: Math.round(Math.abs(dx)), h: Math.round(Math.abs(dy)) };
}

/** An object shifted so its box stays on the page. */
export function keepOnPage(o, height) {
  const b = boundsOf(o);
  let dx = 0, dy = 0;
  if (b.x < 0) dx = -b.x; else if (b.x + b.w > PAGE.width) dx = Math.max(PAGE.width - b.x - b.w, -b.x);
  if (b.y < 0) dy = -b.y; else if (b.y + b.h > height) dy = Math.max(height - b.y - b.h, -b.y);
  return dx || dy ? { ...o, x: Math.round(o.x + dx), y: Math.round(o.y + dy) } : o;
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
export const hasInk = doc => !!doc?.strokes?.some(s => s.t !== 'eraser') || !!doc?.objects?.length;

export const pagesIn = doc => Math.max(1, Math.round(doc.h / PAGE.height));

/** The lowest point any ink reaches, counting the width of the tip. */
export function inkBottom(doc) {
  let bottom = 0;
  for (const s of doc.strokes) {
    if (s.t === 'eraser') continue;
    for (let i = 1; i < s.p.length; i += 2) bottom = Math.max(bottom, s.p[i] + s.s / 2);
  }
  for (const o of doc.objects || []) { const b = boundsOf(o); bottom = Math.max(bottom, b.y + b.h + (o.s || 0) / 2); }
  return bottom;
}

/** Which page a stroke belongs to: the one holding the middle of its height. */
export function pageOf(stroke) {
  let top = Infinity, bottom = -Infinity;
  for (let i = 1; i < stroke.p.length; i += 2) { top = Math.min(top, stroke.p[i]); bottom = Math.max(bottom, stroke.p[i]); }
  return Math.max(0, Math.floor((top + bottom) / 2 / PAGE.height));
}

/** Which page an object belongs to: the one holding the middle of its box. */
export const objectPage = o => { const b = boundsOf(o); return Math.max(0, Math.floor((b.y + b.h / 2) / PAGE.height)); };

export const pageHasInk = (doc, index) => doc.strokes.some(s => s.t !== 'eraser' && pageOf(s) === index) || (doc.objects || []).some(o => objectPage(o) === index);

/** The drawing with one page taken out: its strokes go, and everything below moves up a page. */
export function removePage(doc, index) {
  if (pagesIn(doc) <= 1) return { ...doc, strokes: [], objects: [] };
  const strokes = [];
  for (const s of doc.strokes) {
    const page = pageOf(s);
    if (page === index) continue;
    strokes.push(page < index ? s : { ...s, p: s.p.map((v, i) => (i % 2 ? Math.max(-50, v - PAGE.height) : v)) });
  }
  const objects = (doc.objects || []).filter(o => objectPage(o) !== index).map(o => (objectPage(o) < index ? o : { ...o, y: Math.max(-50, o.y - PAGE.height) }));
  return { ...doc, h: doc.h - PAGE.height, strokes, objects };
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
