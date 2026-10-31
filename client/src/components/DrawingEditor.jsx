import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Pen, Highlighter, Eraser, Undo2, Redo2, Trash2, Maximize2, Minimize2, X, Check, Square, Rows3, Grid3x3, Sun, Moon, Loader2, Plus, RotateCcw, AlertTriangle, ZoomIn, ZoomOut, MousePointer2, Type, Circle, Triangle, Diamond, Minus, MoveUpRight, Copy, BringToFront, Pencil, PaintBucket } from 'lucide-react';
import { api } from '../services/api';
import { BRAND } from '../../../shared/brand.js';
import {
  PAGE, MAX_HEIGHT, MAX_PAGES, INK, HIGHLIGHTS, LIMITS, emptyDrawing, paintPaper, paintInk, paintStroke, strokeHits, hasInk,
  pagesIn, trimDrawing, canvasRatio, removePage, pageHasInk, inkBottom, paintObjects, objectAt, resizeObject, shapeFromDrag, keepOnPage,
  textHeight, handlesFor, boundsOf, newObjectId, BOX_SHAPES, FONT, LINE_HEIGHT, MIN_BOX,
} from '../../../shared/drawing.js';

/**
 * A whiteboard for one side of a card.
 *
 * Two canvases stacked: the paper underneath, repainted only when the paper changes, and the ink
 * above it. Finished strokes are kept on an offscreen copy, so drawing a new one is a copy of that
 * bitmap plus one stroke per frame rather than repainting the whole page under the pen — which is
 * what keeps a page with hundreds of strokes on it from lagging behind the hand.
 *
 * Full screen is the same editor with the chrome taken away: it asks the browser for real full
 * screen where that is allowed, and fills the window where it is not (iPhone Safari), so writing
 * a page of notes and coming back to the card is one button either way.
 *
 * The page never runs out: ink that reaches near the bottom adds another page below, and the
 * stage scrolls — with two fingers on a touch screen, or one once a stylus is doing the drawing.
 * Two fingers also pinch to zoom, so small handwriting on a phone is not written at phone size.
 *
 * Shapes and text boxes are objects rather than ink: they stay editable. With the select tool one
 * can be picked up, moved, resized by its handles, recoloured, duplicated or deleted. They are
 * painted over the ink on every frame instead of being baked into it, so dragging one never
 * repaints the strokes underneath, and the eraser rubs out ink without taking a shape with it.
 */

const PREFS_KEY = `${BRAND.slug}:drawing-tools`;
const SIZE_RANGE = { pen: [1, 24], highlighter: [8, 60], eraser: [8, 60], shape: [1, 24], text: [16, 160] };
const SHAPE_TOOLS = ['rect', 'ellipse', 'triangle', 'diamond', 'line', 'arrow'];
const OBJECT_TOOLS = ['select', 'text', ...SHAPE_TOOLS];
const DEFAULT_PREFS = { tool: 'pen', eraseMode: 'area', penColor: null, hlColor: HIGHLIGHTS[0], fill: false, sizes: { pen: 4, highlighter: 26, eraser: 30, shape: 4, text: 40 } };
const loadPrefs = () => {
  try {
    const saved = JSON.parse(localStorage.getItem(PREFS_KEY)) || {};
    return { ...DEFAULT_PREFS, ...saved, sizes: { ...DEFAULT_PREFS.sizes, ...saved.sizes } };
  } catch { return DEFAULT_PREFS; }
};
const normalize = d => (d.objects ? d : { ...d, objects: [] });
/** Another page is added when anything is placed this close to the bottom, as for pen strokes. */
const growFor = d => {
  let h = d.h; const bottom = inkBottom(d);
  while (bottom > h - 200 && h < MAX_HEIGHT) h += PAGE.height;
  return h === d.h ? d : { ...d, h };
};
let scratch = null;
/** Text is measured on a canvas that is never shown, with the same font it is drawn in. */
const measure = () => (scratch ||= document.createElement('canvas').getContext('2d'));
const relayout = o => textHeight(measure(), o);
const pointsIn = doc => doc.strokes.reduce((n, s) => n + s.p.length / 2, 0);
const MIN_STEP = 1.4;
/** How close to the bottom, in page units, ink has to come before another page is added. */
const GROW_AT = 200;
const MAX_ZOOM = 4;
const ZOOM_STEP = 1.25;
const canFullscreen = typeof document !== 'undefined' && !!(document.fullscreenEnabled || document.webkitFullscreenEnabled);
const fullscreenElement = () => document.fullscreenElement || document.webkitFullscreenElement || null;
const exitFullscreen = () => (document.exitFullscreen || document.webkitExitFullscreen)?.call(document);

/** Keeps palette colours meaningful when the page flips between white and dark. */
function swapInk(color, from, to) {
  const i = INK[from].indexOf(color);
  return i >= 0 ? INK[to][i] : color;
}

export default function DrawingEditor({ folderId, basePath = `/folders/${folderId}`, target = 'card', drawingId, initial, title = 'Drawing', onSave, onClose }) {
  const [doc, setDoc] = useState(initial ? normalize(initial) : null);
  const [loading, setLoading] = useState(!initial && !!drawingId);
  const [past, setPast] = useState([]), [future, setFuture] = useState([]);
  const [prefs, setPrefs] = useState(loadPrefs);
  const [full, setFull] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [fit, setFit] = useState(0), [zoom, setZoom] = useState(1);
  /** A question waiting on the warning panel: `{ title, body, action, run }`. */
  const [ask, setAsk] = useState(null);
  const [selected, setSelected] = useState(null), [editing, setEditing] = useState(null);

  const docRef = useRef(doc); docRef.current = doc;
  const contentRef = useRef(null), paperRef = useRef(null), inkRef = useRef(null), ringRef = useRef(null), stageEl = useRef(null);
  const committed = useRef(null), live = useRef(null), frame = useRef(0), penSeen = useRef(false), erasedFrom = useRef(null), warned = useRef(false);
  const objectDrag = useRef(null), editFrom = useRef(null), editingRef = useRef(null), lastCommit = useRef({ key: null, at: 0 });
  const touches = useRef(new Map()), panning = useRef(false), gesture = useRef(null);
  const anchor = useRef(null), wheelRef = useRef(null), zoomRef = useRef(null), zoomNow = useRef(1), zoomFrame = useRef(0);

  // Starting point: the saved drawing, or a fresh page in the colours of the app's current theme.
  useEffect(() => {
    if (doc || loading) return;
    setDoc(emptyDrawing(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'));
  }, [doc, loading]);
  useEffect(() => {
    if (!loading) return;
    api(`${basePath}/drawings/${drawingId}`).then(d => { setDoc(normalize(d)); setLoading(false); })
      .catch(e => { setError(e.message); setDoc(emptyDrawing()); setLoading(false); });
  }, [loading, basePath, drawingId]);
  useEffect(() => { try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch {} }, [prefs]);

  const theme = doc?.theme || 'light';
  const penColor = prefs.penColor ? swapInk(prefs.penColor, theme === 'light' ? 'dark' : 'light', theme) : INK[theme][0];
  const selObj = doc?.objects.find(o => o.id === selected) || null;
  const editObj = doc?.objects.find(o => o.id === editing) || null;
  const picking = prefs.tool === 'select' && !!selObj;
  const sizeKey = prefs.tool === 'select' ? (selObj?.t === 'text' ? 'text' : 'shape') : prefs.tool === 'text' ? 'text' : SHAPE_TOOLS.includes(prefs.tool) ? 'shape' : prefs.tool;
  const size = picking ? (selObj.t === 'text' ? selObj.fs : selObj.s) : prefs.sizes[sizeKey];

  /** Every change to the page goes through here, so it can be undone. */
  const commit = useCallback((next, key) => {
    const now = Date.now();
    // A run of the same adjustment, like dragging a slider, is one step to undo, not fifty.
    const same = key && lastCommit.current.key === key && now - lastCommit.current.at < 900;
    lastCommit.current = { key: key || null, at: now };
    if (!same) { setPast(p => [...p.slice(-99), docRef.current]); setFuture([]); }
    docRef.current = next;
    setDoc(next);
  }, []);
  const undo = () => { if (!past.length) return; setFuture(f => [doc, ...f]); setDoc(past.at(-1)); setPast(p => p.slice(0, -1)); };
  const redo = () => { if (!future.length) return; setPast(p => [...p, doc]); setDoc(future[0]); setFuture(f => f.slice(1)); };

  // ── Layout: the page fits the screen, then zooms ───────────────────────────────────────────────
  // At 100% the whole page fits on screen, unless that would leave it a sliver (a phone held
  // sideways), in which case it fills the width and scrolls. Zoom multiplies that.
  // A callback ref rather than an effect: the dialog mounts its content a render after this
  // component, so an effect would look for the stage before it exists and never look again.
  const observer = useRef(null);
  const stageRef = useCallback(stage => {
    observer.current?.disconnect();
    stageEl.current?.removeEventListener('wheel', wheelRef.current);
    stageEl.current = stage;
    if (!stage) return;
    const fitPage = () => {
      const css = getComputedStyle(stage);
      const across = stage.clientWidth - parseFloat(css.paddingLeft) - parseFloat(css.paddingRight);
      const down = stage.clientHeight - parseFloat(css.paddingTop) - parseFloat(css.paddingBottom);
      const byHeight = down * (PAGE.width / PAGE.height);
      setFit(Math.floor(Math.max(0, byHeight < across * 0.6 ? across : Math.min(across, byHeight))));
    };
    observer.current = new ResizeObserver(fitPage);
    observer.current.observe(stage);
    // Trackpad pinches arrive as ctrl + wheel, and only a non-passive listener can keep the
    // browser from zooming the whole page instead.
    stage.addEventListener('wheel', wheelRef.current, { passive: false });
    fitPage();
  }, []);
  useEffect(() => () => { observer.current?.disconnect(); stageEl.current?.removeEventListener('wheel', wheelRef.current); }, []);

  const width = Math.round(fit * zoom);
  /** Zooms keeping the point under `at` (screen coordinates) where it is. */
  const zoomTo = useCallback((next, at) => {
    const pageEl = inkRef.current, stage = stageEl.current;
    if (!pageEl || !stage) return;
    const z = Math.min(MAX_ZOOM, Math.max(1, Math.round(next * 100) / 100));
    const rect = pageEl.getBoundingClientRect(), box = stage.getBoundingClientRect();
    const point = at || { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    anchor.current = { u: (point.x - rect.left) / rect.width, v: (point.y - rect.top) / rect.height, ...point };
    setZoom(z);
  }, []);
  useLayoutEffect(() => {
    const a = anchor.current, pageEl = inkRef.current, stage = stageEl.current;
    anchor.current = null;
    if (!a || !pageEl || !stage) return;
    const rect = pageEl.getBoundingClientRect();
    stage.scrollLeft += rect.left + a.u * rect.width - a.x;
    stage.scrollTop += rect.top + a.v * rect.height - a.y;
  }, [width]);
  wheelRef.current ||= e => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    zoomRef.current?.(z => z * Math.exp(-e.deltaY / 200), { x: e.clientX, y: e.clientY });
  };
  zoomRef.current = (f, at) => zoomTo(f(zoomNow.current), at);
  zoomNow.current = zoom;

  const docH = doc?.h || PAGE.height;
  const height = Math.round(width * (docH / PAGE.width));
  const pageHeight = width * (PAGE.height / PAGE.width);
  const ratio = canvasRatio(width, height, typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1);
  const scale = (width * ratio) / PAGE.width;
  const pages = pagesIn({ h: docH });

  const blit = useCallback(() => {
    frame.current = 0;
    const ink = inkRef.current;
    if (!ink || !committed.current) return;
    const ctx = ink.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, ink.width, ink.height);
    ctx.drawImage(committed.current, 0, 0);
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    paintObjects(ctx, docRef.current?.objects, { skip: editingRef.current });
    if (live.current) paintStroke(ctx, live.current);
  }, [scale]);
  const schedule = () => { if (!frame.current) frame.current = requestAnimationFrame(blit); };

  useEffect(() => {
    const paper = paperRef.current;
    if (!paper || !doc || !width) return;
    paper.width = Math.round(width * ratio); paper.height = Math.round(height * ratio);
    paintPaper(paper.getContext('2d'), doc, scale);
  }, [doc?.paper, doc?.theme, doc?.h, width, height, ratio, scale]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const ink = inkRef.current;
    if (!ink || !doc || !width) return;
    ink.width = Math.round(width * ratio); ink.height = Math.round(height * ratio);
    committed.current ||= document.createElement('canvas');
    committed.current.width = ink.width; committed.current.height = ink.height;
    paintInk(committed.current.getContext('2d'), doc, scale, { objects: false });
    blit();
  }, [doc?.strokes, doc?.h, width, height, ratio, scale, blit]); // eslint-disable-line react-hooks/exhaustive-deps
  // Objects are painted over the ink each frame, so moving one only needs this, not the effect above.
  useEffect(() => { blit(); }, [doc?.objects, editing, blit]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Pointer input ─────────────────────────────────────────────────────────────────────────────
  const toPage = e => {
    const rect = inkRef.current.getBoundingClientRect();
    return [Math.round(((e.clientX - rect.left) / rect.width) * PAGE.width), Math.round(((e.clientY - rect.top) / rect.height) * docRef.current.h)];
  };
  const hideRing = () => { if (ringRef.current) ringRef.current.style.opacity = '0'; };
  const finishErase = () => {
    const before = erasedFrom.current;
    erasedFrom.current = null;
    if (before && before !== docRef.current) { setPast(p => [...p.slice(-99), before]); setFuture([]); }
  };
  /**
   * Fingers that scroll rather than draw: any second finger, which turns a stroke just begun into
   * a scroll instead, and every finger once a stylus has been seen, since the pen does the drawing.
   */
  const trackTouch = e => {
    if (e.pointerType !== 'touch') return false;
    touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (!panning.current && (touches.current.size >= 2 || penSeen.current)) {
      panning.current = true;
      live.current = null;
      finishErase();
      hideRing();
      schedule();
    }
    if (panning.current) gesture.current = null;
    return panning.current;
  };
  /** Where the fingers are: their middle, and how far apart the first two are. */
  const spread = () => {
    const pts = [...touches.current.values()];
    const x = pts.reduce((n, p) => n + p.x, 0) / pts.length, y = pts.reduce((n, p) => n + p.y, 0) / pts.length;
    return { x, y, d: pts.length > 1 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : 0, n: pts.length };
  };
  /** Scrolls with the fingers and, with two of them, zooms by how far they have spread. */
  const pan = e => {
    if (!touches.current.has(e.pointerId)) return;
    touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const now = spread(), g = gesture.current, stage = stageEl.current;
    // A finger added or lifted starts the gesture again from here, so nothing jumps.
    if (!g || g.n !== now.n) { gesture.current = { ...now, zoom: zoomNow.current, start: now.d }; return; }
    if (stage) { stage.scrollLeft -= now.x - g.x; stage.scrollTop -= now.y - g.y; }
    g.x = now.x; g.y = now.y;
    if (now.n > 1 && g.start > 20) {
      const target = g.zoom * (now.d / g.start), at = { x: now.x, y: now.y };
      cancelAnimationFrame(zoomFrame.current);
      zoomFrame.current = requestAnimationFrame(() => zoomTo(target, at));
    }
  };
  const moveRing = e => {
    const ring = ringRef.current, ink = inkRef.current;
    if (!ring || !ink) return;
    const rect = ink.getBoundingClientRect();
    const d = Math.max(6, size * (rect.width / PAGE.width));
    ring.style.width = ring.style.height = `${d}px`;
    ring.style.transform = `translate(${e.clientX - rect.left - d / 2}px, ${e.clientY - rect.top - d / 2}px)`;
    ring.style.opacity = '1';
  };
  const eraseAt = (x, y) => {
    const current = docRef.current, radius = size / 2;
    const kept = current.strokes.filter(s => !strokeHits(s, x, y, radius));
    if (kept.length === current.strokes.length) return;
    // Several samples arrive per frame, so the ref moves now rather than on the next render.
    docRef.current = { ...current, strokes: kept };
    setDoc(docRef.current);
  };

  function down(e) {
    if (!doc || busy || !width) return;
    if (e.pointerType === 'pen') penSeen.current = true;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* The pointer is already gone. */ }
    if (trackTouch(e)) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    const [x, y] = toPage(e);
    finishEdit();
    if (OBJECT_TOOLS.includes(prefs.tool)) { objectDown(x, y); return; }
    if (prefs.tool === 'eraser' && prefs.eraseMode === 'stroke') { erasedFrom.current = doc; eraseAt(x, y); return; }
    if (pointsIn(doc) >= LIMITS.points || doc.strokes.length >= LIMITS.strokes) {
      if (!warned.current) { setError('This page is full. Save it, or clear part of it to keep drawing.'); warned.current = true; }
      return;
    }
    const color = prefs.tool === 'highlighter' ? prefs.hlColor : penColor;
    live.current = { t: prefs.tool, c: color, s: size, p: [x, y] };
    schedule();
  }
  function move(e) {
    if (panning.current && e.pointerType === 'touch') { pan(e); return; }
    if (objectDrag.current) { objectMove(e); return; }
    // Under a fingertip the ring would only ever be hidden by the finger.
    if (e.pointerType !== 'touch' && !OBJECT_TOOLS.includes(prefs.tool)) moveRing(e);
    const coalesced = e.nativeEvent.getCoalescedEvents?.();
    const events = coalesced?.length ? coalesced : [e.nativeEvent];
    if (erasedFrom.current) { for (const ev of events) eraseAt(...toPage(ev)); return; }
    const stroke = live.current;
    if (!stroke) return;
    for (const ev of events) {
      if (stroke.p.length >= LIMITS.pointsPerStroke * 2) break;
      const [x, y] = toPage(ev);
      const lx = stroke.p[stroke.p.length - 2], ly = stroke.p[stroke.p.length - 1];
      if (Math.hypot(x - lx, y - ly) >= MIN_STEP) stroke.p.push(x, y);
    }
    schedule();
  }
  function up(e) {
    if (e.pointerType === 'touch') {
      touches.current.delete(e.pointerId);
      if (panning.current) { gesture.current = null; if (!touches.current.size) panning.current = false; return; }
    }
    if (objectDrag.current) { objectUp(); return; }
    if (erasedFrom.current) { finishErase(); return; }
    const stroke = live.current;
    live.current = null;
    if (!stroke) return;
    const current = docRef.current;
    let reach = 0;
    for (let i = 1; i < stroke.p.length; i += 2) reach = Math.max(reach, stroke.p[i] + stroke.s / 2);
    // Writing into the last stretch of the page adds the next one, in the same undo step.
    const h = stroke.t !== 'eraser' && reach > current.h - GROW_AT ? Math.min(MAX_HEIGHT, current.h + PAGE.height) : current.h;
    commit({ ...current, h, strokes: [...current.strokes, stroke] });
  }

  // ── Shapes and text ───────────────────────────────────────────────────────────────────────────
  /** Writes one object into the page without making an undo step; the caller makes that when the gesture ends. */
  const putObject = next => {
    const cur = docRef.current;
    const objects = cur.objects.some(o => o.id === next.id) ? cur.objects.map(o => (o.id === next.id ? next : o)) : [...cur.objects, next];
    docRef.current = { ...cur, objects };
    setDoc(docRef.current);
  };
  const atLimit = () => {
    if (docRef.current.objects.length < LIMITS.objects) return false;
    setError(`A drawing can hold up to ${LIMITS.objects} shapes and text boxes.`);
    return true;
  };
  const startEdit = id => { editingRef.current = id; setEditing(id); };
  const beginEdit = id => { editFrom.current = docRef.current; startEdit(id); };
  /** Leaves the text box. Empty ones are removed; anything else is one undo step. */
  function finishEdit() {
    const id = editingRef.current;
    if (!id) return;
    startEdit(null);
    const cur = docRef.current, before = editFrom.current, o = cur.objects.find(x => x.id === id);
    editFrom.current = null;
    let next = cur;
    if (!o || !o.text.trim()) {
      next = before && before.objects.some(x => x.id === id) ? { ...cur, objects: cur.objects.filter(x => x.id !== id) } : before || cur;
      setSelected(null);
    } else next = growFor(cur);
    docRef.current = next; setDoc(next);
    if (before && (before.objects !== next.objects || before.h !== next.h)) { setPast(p => [...p.slice(-99), before]); setFuture([]); }
  }
  function objectDown(x, y) {
    const cur = docRef.current, tool = prefs.tool;
    if (tool === 'select' || tool === 'text') {
      const hit = objectAt(cur.objects, x, y, 10);
      if (tool === 'text') {
        if (hit?.t === 'text') { setSelected(hit.id); beginEdit(hit.id); return; }
        if (atLimit()) return;
        const fs = prefs.sizes.text, w = Math.max(MIN_BOX * 4, Math.min(520, PAGE.width - x - 20));
        const made = { id: newObjectId(), t: 'text', x, y: Math.max(0, y - fs / 2), w, h: Math.round(fs * LINE_HEIGHT), c: penColor, fs, text: '' };
        editFrom.current = cur;
        putObject(keepOnPage(made, cur.h)); setSelected(made.id); startEdit(made.id);
        return;
      }
      setSelected(hit?.id || null);
      if (hit) objectDrag.current = { mode: 'move', id: hit.id, from: [x, y], orig: hit, before: cur, moved: false };
      return;
    }
    if (atLimit()) return;
    objectDrag.current = { mode: 'create', kind: tool, id: newObjectId(), from: [x, y], before: cur, made: false };
  }
  function handleDown(e, handle) {
    if (!selObj || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.preventDefault(); e.stopPropagation();
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* The pointer is already gone. */ }
    objectDrag.current = { mode: 'resize', handle, id: selObj.id, from: toPage(e), orig: selObj, before: docRef.current, moved: false };
  }
  function objectMove(e) {
    const d = objectDrag.current, cur = docRef.current, [x, y] = toPage(e), dx = x - d.from[0], dy = y - d.from[1];
    if (d.mode === 'create') {
      if (!d.made && Math.hypot(dx, dy) < 6) return;
      d.made = true;
      const geometry = shapeFromDrag(d.kind, d.from, [x, y], { keep: e.shiftKey });
      putObject(keepOnPage({ id: d.id, t: d.kind, ...geometry, c: penColor, s: prefs.sizes.shape, ...(BOX_SHAPES.includes(d.kind) && prefs.fill ? { f: true } : {}) }, cur.h));
      return;
    }
    if (!d.moved && Math.hypot(dx, dy) < 3) return;
    d.moved = true;
    putObject(keepOnPage(d.mode === 'move'
      ? { ...d.orig, x: Math.round(d.orig.x + dx), y: Math.round(d.orig.y + dy) }
      : resizeObject(d.orig, d.handle, dx, dy, { keep: e.shiftKey, relayout }), cur.h));
  }
  function objectUp() {
    const d = objectDrag.current;
    objectDrag.current = null;
    if (d.mode === 'create' && !d.made) return;
    if (d.mode !== 'create' && !d.moved) return;
    const next = growFor(docRef.current);
    docRef.current = next; setDoc(next);
    setPast(p => [...p.slice(-99), d.before]); setFuture([]);
    if (d.mode === 'create') { setSelected(d.id); setPrefs(p => ({ ...p, tool: 'select' })); }
  }
  /** Changes the picked object, as one undo step per run of the same adjustment. */
  const editSelected = (change, key) => {
    const cur = docRef.current, o = cur.objects.find(x => x.id === selected);
    if (!o) return;
    let next = change(o);
    if (next.t === 'text') next = { ...next, h: relayout(next) };
    commit(growFor({ ...cur, objects: cur.objects.map(x => (x.id === o.id ? keepOnPage(next, cur.h) : x)) }), `${key}:${o.id}`);
  };
  const deleteSelected = () => {
    if (!selObj) return;
    commit({ ...docRef.current, objects: docRef.current.objects.filter(o => o.id !== selObj.id) });
    setSelected(null);
  };
  const duplicateSelected = () => {
    if (!selObj || atLimit()) return;
    const copy = keepOnPage({ ...selObj, id: newObjectId(), x: selObj.x + 30, y: selObj.y + 30 }, docRef.current.h);
    commit(growFor({ ...docRef.current, objects: [...docRef.current.objects, copy] }));
    setSelected(copy.id);
  };
  const bringToFront = () => selObj && commit({ ...docRef.current, objects: [...docRef.current.objects.filter(o => o.id !== selObj.id), selObj] });
  const nudge = (dx, dy) => selObj && editSelected(o => ({ ...o, x: o.x + dx, y: o.y + dy }), 'nudge');
  const onDouble = e => {
    if (prefs.tool !== 'select') return;
    const hit = objectAt(docRef.current.objects, ...toPage(e), 10);
    if (hit?.t === 'text') { setSelected(hit.id); beginEdit(hit.id); }
  };

  // ── Page settings ─────────────────────────────────────────────────────────────────────────────
  const setTool = tool => { finishEdit(); if (tool !== 'select') setSelected(null); hideRing(); setPrefs(p => ({ ...p, tool })); };
  const setSize = value => (picking ? editSelected(o => (o.t === 'text' ? { ...o, fs: value } : { ...o, s: value }), 'size') : setPrefs(p => ({ ...p, sizes: { ...p.sizes, [sizeKey]: value } })));
  const setPaper = paper => doc.paper !== paper && commit({ ...doc, paper });
  /** Flipping the page also flips the palette colours already on it, so black ink stays visible. */
  const flipTheme = () => {
    const to = theme === 'light' ? 'dark' : 'light';
    commit({ ...doc, theme: to, strokes: doc.strokes.map(s => (s.t === 'pen' ? { ...s, c: swapInk(s.c, theme, to) } : s)), objects: doc.objects.map(o => ({ ...o, c: swapInk(o.c, theme, to) })) });
  };
  const canReset = !!doc && (doc.strokes.length > 0 || doc.objects.length > 0 || doc.h > PAGE.height);
  const reset = () => {
    if (!canReset) return;
    setAsk({
      title: 'Reset this drawing?',
      body: pages > 1
        ? `Everything on all ${pages} pages is wiped and you are left with one blank page. You can undo this until you save.`
        : 'Everything on the page is wiped. You can undo this until you save.',
      action: 'Reset drawing',
      run: () => { setSelected(null); commit({ ...docRef.current, h: PAGE.height, strokes: [], objects: [] }); },
    });
  };
  const deletePage = index => {
    const run = () => { commit(removePage(docRef.current, index)); setError(''); warned.current = false; };
    if (!pageHasInk(doc, index)) { run(); return; }
    setAsk({
      title: `Delete page ${index + 1}?`,
      body: `Everything on page ${index + 1} is removed${index < pages - 1 ? ' and the pages below it move up' : ''}. You can undo this until you save.`,
      action: 'Delete page',
      run,
    });
  };
  const addPage = () => {
    if (doc.h >= MAX_HEIGHT) return;
    commit({ ...doc, h: doc.h + PAGE.height });
    requestAnimationFrame(() => stageEl.current?.scrollTo({ top: stageEl.current.scrollHeight, behavior: 'smooth' }));
  };

  // ── Full screen ───────────────────────────────────────────────────────────────────────────────
  const toggleFull = useCallback(async () => {
    const next = !full;
    setFull(next);
    // Safari on iPad still only has the prefixed calls; iPhone has neither, and gets the
    // window-filling layout alone.
    const el = contentRef.current, request = el && (el.requestFullscreen || el.webkitRequestFullscreen);
    try {
      if (next && request && !fullscreenElement()) await request.call(el);
      else if (!next && fullscreenElement()) await exitFullscreen();
    } catch { /* The window-filling layout is the fallback; nothing else to do. */ }
  }, [full]);
  useEffect(() => {
    const sync = () => { if (!fullscreenElement()) setFull(false); };
    document.addEventListener('fullscreenchange', sync);
    document.addEventListener('webkitfullscreenchange', sync);
    return () => {
      document.removeEventListener('fullscreenchange', sync);
      document.removeEventListener('webkitfullscreenchange', sync);
      if (fullscreenElement()) Promise.resolve(exitFullscreen()).catch(() => {});
    };
  }, []);

  const dirty = past.length > 0;
  const close = () => {
    if (!dirty) { onClose(); return; }
    setAsk({ title: 'Leave without saving?', body: 'The changes you made to this drawing will be lost.', action: 'Discard changes', run: onClose });
  };
  const answer = yes => { const pending = ask; setAsk(null); if (yes) pending?.run(); };
  async function save() {
    finishEdit();
    // Read after finishing the text box, which may have just removed an empty one.
    const latest = docRef.current;
    if (!hasInk(latest)) { setError('Draw something first.'); return; }
    if (!dirty && drawingId) { onClose(); return; }
    setBusy(true); setError('');
    try {
      const { objects, ...rest } = trimDrawing(latest);
      const kept = objects.filter(o => o.t !== 'text' || o.text.trim());
      const saved = kept.length ? { ...rest, objects: kept } : rest;
      const r = await api(`${basePath}/drawings`, { method: 'POST', body: saved });
      if (fullscreenElement()) await Promise.resolve(exitFullscreen()).catch(() => {});
      onSave(r.id, { ...saved, objects: saved.objects || [] });
    } catch (e) { setError(e.message); setBusy(false); }
  }

  function keys(e) {
    if (ask || e.target.closest('input, textarea')) return;
    const mod = e.metaKey || e.ctrlKey, k = e.key.toLowerCase();
    if (mod && k === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
    else if (mod && k === 'y') { e.preventDefault(); redo(); }
    else if (mod && k === 's') { e.preventDefault(); save(); }
    else if (mod && k === 'd') { e.preventDefault(); duplicateSelected(); }
    else if (!mod && (k === 'delete' || k === 'backspace') && selObj) { e.preventDefault(); deleteSelected(); }
    else if (!mod && k === 'enter' && selObj?.t === 'text') { e.preventDefault(); beginEdit(selObj.id); }
    else if (!mod && selObj && prefs.tool === 'select' && k.startsWith('arrow')) { e.preventDefault(); const n = e.shiftKey ? 10 : 1; nudge(k === 'arrowleft' ? -n : k === 'arrowright' ? n : 0, k === 'arrowup' ? -n : k === 'arrowdown' ? n : 0); }
    else if (!mod && k === 'v') setTool('select');
    else if (!mod && k === 't') setTool('text');
    else if (!mod && k === 'r') setTool('rect');
    else if (!mod && k === 'o') setTool('ellipse');
    else if (!mod && k === 'l') setTool('line');
    else if (!mod && k === 'a') setTool('arrow');
    else if (!mod && k === 'p') setTool('pen');
    else if (!mod && k === 'h') setTool('highlighter');
    else if (!mod && k === 'e') setTool('eraser');
    else if (!mod && k === 'f') toggleFull();
    else if (k === '=' || k === '+') { e.preventDefault(); zoomTo(zoom * ZOOM_STEP); }
    else if (k === '-') { e.preventDefault(); zoomTo(zoom / ZOOM_STEP); }
    else if (k === '0') { e.preventDefault(); zoomTo(1); }
  }

  const swatches = prefs.tool === 'highlighter' ? HIGHLIGHTS : INK[theme];
  const color = picking ? selObj.c : prefs.tool === 'highlighter' ? prefs.hlColor : penColor;
  const pickColor = c => {
    if (picking) { editSelected(o => ({ ...o, c }), 'color'); return; }
    setPrefs(p => (p.tool === 'highlighter' ? { ...p, hlColor: c } : { ...p, penColor: c }));
  };
  const [lo, hi] = SIZE_RANGE[sizeKey];
  const canFill = picking ? BOX_SHAPES.includes(selObj.t) : BOX_SHAPES.includes(prefs.tool);
  const fillOn = picking ? !!selObj.f : prefs.fill;
  const toggleFill = () => (picking ? editSelected(o => ({ ...o, f: !o.f }), 'fill') : setPrefs(p => ({ ...p, fill: !p.fill })));
  const hinting = prefs.tool === 'select' && !selObj;
  const history = where => <>
    <button key={`${where}-undo`} type="button" className="draw-icon" onClick={undo} disabled={!past.length} title="Undo (⌘Z)" aria-label="Undo"><Undo2 size={17}/></button>
    <button key={`${where}-redo`} type="button" className="draw-icon" onClick={redo} disabled={!future.length} title="Redo (⌘⇧Z)" aria-label="Redo"><Redo2 size={17}/></button>
  </>;

  return <Dialog.Root open onOpenChange={v => !v && close()}>
    <Dialog.Portal>
      <Dialog.Overlay className="modal-overlay draw-overlay"/>
      <Dialog.Content ref={contentRef} className={`drawing-editor ${full ? 'is-full' : ''} is-${theme}`} onKeyDown={keys}
        onPointerDownOutside={e => e.preventDefault()}
        onEscapeKeyDown={e => {
          if (ask) { e.preventDefault(); answer(false); }
          else if (editingRef.current) { e.preventDefault(); finishEdit(); }
          else if (selected) { e.preventDefault(); setSelected(null); }
          else if (full) { e.preventDefault(); toggleFull(); }
        }}>
        <header className="draw-head">
          <Dialog.Title>{title}</Dialog.Title>
          <Dialog.Description className="sr-only">Draw with a mouse, finger or stylus. Save to put the drawing on the {target}.</Dialog.Description>
          <div className="draw-head-actions">
            {/* On a phone, undo and redo move up here, in reach of the thumb and out of the toolbar. */}
            <span className="draw-head-history">{history('head')}</span>
            <button type="button" className={`draw-icon draw-full-button ${canFullscreen ? '' : 'is-fallback'}`} onClick={toggleFull} title={full ? 'Exit full screen (F)' : 'Full screen (F)'} aria-label={full ? 'Exit full screen' : 'Full screen'}>{full ? <Minimize2 size={17}/> : <Maximize2 size={17}/>}</button>
            <button type="button" className="button secondary small draw-cancel" onClick={close} aria-label="Cancel"><X size={15}/><span>Cancel</span></button>
            <button type="button" className="button primary small draw-save" onClick={save} disabled={busy || loading}>
              {busy ? <Loader2 className="spin" size={15}/> : <Check size={15}/>}
              <span className="draw-save-long">{full ? `Save & back to ${target}` : 'Save drawing'}</span><span className="draw-save-short">Save</span>
            </button>
          </div>
        </header>

        <div className="draw-toolbar" role="toolbar" aria-label="Drawing tools">
          <div className="draw-group draw-pill" role="radiogroup" aria-label="Tool">
            {[['pen', Pen, 'Pen (P)'], ['highlighter', Highlighter, 'Highlighter (H)'], ['eraser', Eraser, 'Eraser (E)']].map(([id, Icon, label]) =>
              <button key={id} type="button" role="radio" aria-checked={prefs.tool === id} className={`draw-icon ${prefs.tool === id ? 'active' : ''}`} title={label} aria-label={label} onClick={() => setTool(id)}><Icon size={18}/></button>)}
          </div>
          <div className="draw-group draw-pill" role="radiogroup" aria-label="Select and text">
            {[['select', MousePointer2, 'Select and move (V)'], ['text', Type, 'Text box (T)']].map(([id, Icon, label]) =>
              <button key={id} type="button" role="radio" aria-checked={prefs.tool === id} className={`draw-icon ${prefs.tool === id ? 'active' : ''}`} title={label} aria-label={label} onClick={() => setTool(id)}><Icon size={18}/></button>)}
          </div>
          <div className="draw-group draw-pill" role="radiogroup" aria-label="Shapes">
            {[['rect', Square, 'Rectangle (R)'], ['ellipse', Circle, 'Ellipse (O)'], ['triangle', Triangle, 'Triangle'], ['diamond', Diamond, 'Diamond'], ['line', Minus, 'Line (L)'], ['arrow', MoveUpRight, 'Arrow (A)']].map(([id, Icon, label]) =>
              <button key={id} type="button" role="radio" aria-checked={prefs.tool === id} className={`draw-icon ${prefs.tool === id ? 'active' : ''}`} title={label} aria-label={label} onClick={() => setTool(id)}><Icon size={18}/></button>)}
          </div>
          <span className="draw-sep" aria-hidden="true"/>

          <div className="draw-slot">
            {hinting ? <span className="draw-hint">Pick something on the page to change it, or choose a shape or text.</span> : prefs.tool === 'eraser'
              ? <div className="draw-group draw-seg" role="radiogroup" aria-label="Eraser">
                <button type="button" role="radio" aria-checked={prefs.eraseMode === 'area'} className={prefs.eraseMode === 'area' ? 'active' : ''} onClick={() => setPrefs(p => ({ ...p, eraseMode: 'area' }))}>Rub out</button>
                <button type="button" role="radio" aria-checked={prefs.eraseMode === 'stroke'} className={prefs.eraseMode === 'stroke' ? 'active' : ''} onClick={() => setPrefs(p => ({ ...p, eraseMode: 'stroke' }))}>Whole stroke</button>
              </div>
              : <div className="draw-group draw-colors" role="radiogroup" aria-label="Colour">
                {swatches.map(c => <button key={c} type="button" role="radio" aria-checked={color === c} aria-label={`Colour ${c}`} className={`draw-swatch ${color === c ? 'active' : ''}`} style={{ '--swatch': c }} onClick={() => pickColor(c)}/>)}
                <label className="draw-swatch draw-custom" title="Any colour" style={{ '--swatch': swatches.includes(color) ? 'transparent' : color }}>
                  <input type="color" aria-label="Choose any colour" value={color} onChange={e => pickColor(e.target.value)}/>
                </label>
              </div>}
          </div>
          <span className="draw-sep" aria-hidden="true"/>

          {!hinting && <label className="draw-group draw-size" title={sizeKey === 'text' ? 'Text size' : sizeKey === 'shape' ? 'Line thickness' : 'Tip size'}>
            <span className="draw-size-preview" aria-hidden="true">
              <span className={prefs.tool === 'eraser' ? 'is-eraser' : ''} style={{ transform: `scale(${Math.min(22, Math.max(4, size / 2.4)) / 22})`, background: prefs.tool === 'eraser' ? undefined : color }}/>
            </span>
            <input type="range" min={lo} max={hi} value={Math.min(hi, Math.max(lo, size))} aria-label={sizeKey === 'text' ? 'Text size' : sizeKey === 'shape' ? 'Line thickness' : 'Tip size'} onChange={e => setSize(Number(e.target.value))}/>
            <output>{size}</output>
          </label>}
          {canFill && <button type="button" className={`draw-icon ${fillOn ? 'active' : ''}`} aria-pressed={fillOn} onClick={toggleFill} title={fillOn ? 'Remove the tint' : 'Tint the inside'} aria-label="Tint the inside"><PaintBucket size={17}/></button>}
          {picking && <div className="draw-group draw-pill" role="group" aria-label="Selected object">
            {selObj.t === 'text' && <button type="button" className="draw-icon" onClick={() => beginEdit(selObj.id)} title="Edit text (Enter)" aria-label="Edit text"><Pencil size={16}/></button>}
            <button type="button" className="draw-icon" onClick={duplicateSelected} title="Duplicate (⌘D)" aria-label="Duplicate"><Copy size={16}/></button>
            <button type="button" className="draw-icon" onClick={bringToFront} title="Bring to front" aria-label="Bring to front"><BringToFront size={16}/></button>
            <button type="button" className="draw-icon is-danger" onClick={deleteSelected} title="Delete (Delete key)" aria-label="Delete"><Trash2 size={16}/></button>
          </div>}
          <span className="draw-sep" aria-hidden="true"/>

          <div className="draw-group draw-seg" role="radiogroup" aria-label="Paper">
            {[['blank', Square, 'Blank'], ['ruled', Rows3, 'Ruled'], ['grid', Grid3x3, 'Grid']].map(([id, Icon, label]) =>
              <button key={id} type="button" role="radio" aria-checked={doc?.paper === id} className={doc?.paper === id ? 'active' : ''} title={`${label} page`} onClick={() => setPaper(id)}><Icon size={15}/><span>{label}</span></button>)}
          </div>
          <button type="button" className="draw-icon" onClick={flipTheme} title={theme === 'light' ? 'Dark page' : 'White page'} aria-label={theme === 'light' ? 'Switch to a dark page' : 'Switch to a white page'}>{theme === 'light' ? <Moon size={17}/> : <Sun size={17}/>}</button>

          <div className="draw-group draw-history">
            <span className="draw-bar-history">{history('bar')}</span>
            <button type="button" className="draw-reset" onClick={reset} disabled={!canReset} title="Wipe every page and start again" aria-label="Reset"><RotateCcw size={15}/><span>Reset</span></button>
          </div>
        </div>

        <div className="draw-stage" ref={stageRef}>
          <div className="draw-stage-inner">
            {loading || !doc
              ? <div className="loading"><Loader2 className="spin" size={18}/> Opening drawing…</div>
              : <>
                <div className={`draw-page tool-${prefs.tool}`} style={{ width, height }}>
                  <canvas ref={paperRef} aria-hidden="true"/>
                  <canvas ref={inkRef} role="img" aria-label="Drawing area"
                    onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
                    onPointerLeave={hideRing} onDoubleClick={onDouble}/>
                  {selObj && !editing && prefs.tool === 'select' && (() => {
                    const k = width / PAGE.width, b = boundsOf(selObj);
                    const at = { nw: [b.x, b.y], n: [b.x + b.w / 2, b.y], ne: [b.x + b.w, b.y], e: [b.x + b.w, b.y + b.h / 2], se: [b.x + b.w, b.y + b.h], s: [b.x + b.w / 2, b.y + b.h], sw: [b.x, b.y + b.h], w: [b.x, b.y + b.h / 2], start: [selObj.x, selObj.y], end: [selObj.x + selObj.w, selObj.y + selObj.h] };
                    const line = selObj.t === 'line' || selObj.t === 'arrow';
                    return <>
                      {!line && <span className="draw-sel" style={{ left: b.x * k, top: b.y * k, width: b.w * k, height: b.h * k }} aria-hidden="true"/>}
                      {handlesFor(selObj).map(h => <span key={h} className={`draw-handle is-${h}`} style={{ left: at[h][0] * k, top: at[h][1] * k }}
                        onPointerDown={e => handleDown(e, h)} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
                        role="button" aria-label={`Resize ${h}`}/>)}
                    </>;
                  })()}
                  {editObj && <textarea className="draw-text-edit" autoFocus aria-label="Text" value={editObj.text} maxLength={LIMITS.textLength}
                    style={{ left: editObj.x * (width / PAGE.width), top: editObj.y * (width / PAGE.width), width: editObj.w * (width / PAGE.width), height: (editObj.h + editObj.fs * LINE_HEIGHT) * (width / PAGE.width), fontSize: editObj.fs * (width / PAGE.width), lineHeight: LINE_HEIGHT, color: editObj.c, fontFamily: FONT }}
                    onFocus={e => e.target.setSelectionRange(e.target.value.length, e.target.value.length)}
                    onChange={e => putObject({ ...editObj, text: e.target.value, h: relayout({ ...editObj, text: e.target.value }) })}
                    onBlur={finishEdit} onPointerDown={e => e.stopPropagation()}/>}
                  {Array.from({ length: pages - 1 }, (_, i) =>
                    <span key={i} className="draw-break" style={{ top: (i + 1) * pageHeight }} aria-hidden="true"/>)}
                  {pages > 1 && Array.from({ length: pages }, (_, i) =>
                    <span key={`tag-${i}`} className="draw-page-tag" style={{ top: i * pageHeight + 8 }}>
                      <b>Page {i + 1}</b>
                      <button type="button" onClick={() => deletePage(i)} title={`Delete page ${i + 1}`} aria-label={`Delete page ${i + 1}`}><Trash2 size={13}/></button>
                    </span>)}
                  <span ref={ringRef} className="draw-ring" aria-hidden="true"/>
                </div>
              </>}
          </div>
        </div>
        <footer className="draw-foot">
          <span className="draw-count">{pages === 1 ? '1 page' : `${pages} pages`}<span className="draw-count-note">{pages >= MAX_PAGES ? ' · the most a drawing can hold' : ''}</span></span>
          <div className="draw-zoom" role="group" aria-label="Zoom">
            <button type="button" className="draw-icon" onClick={() => zoomTo(zoom / ZOOM_STEP)} disabled={zoom <= 1} title="Zoom out (−)" aria-label="Zoom out"><ZoomOut size={16}/></button>
            <button type="button" className="draw-zoom-level" onClick={() => zoomTo(1)} disabled={zoom === 1} title="Fit the page (0)" aria-label={`Zoom ${Math.round(zoom * 100)}%, fit the page`}>{Math.round(zoom * 100)}%</button>
            <button type="button" className="draw-icon" onClick={() => zoomTo(zoom * ZOOM_STEP)} disabled={zoom >= MAX_ZOOM} title="Zoom in (+)" aria-label="Zoom in"><ZoomIn size={16}/></button>
          </div>
          <button type="button" className="draw-add-page" onClick={addPage} disabled={pages >= MAX_PAGES || !doc}><Plus size={15}/> <span>Add a page</span></button>
        </footer>
        {error && <p className="draw-error" role="alert">{error}</p>}
        {ask && <div className="draw-ask-backdrop" onPointerDown={e => { if (e.target === e.currentTarget) answer(false); }}>
          <div className="draw-ask" role="alertdialog" aria-modal="true" aria-labelledby="draw-ask-title" aria-describedby="draw-ask-body">
            <span className="draw-ask-icon" aria-hidden="true"><AlertTriangle size={20}/></span>
            <h3 id="draw-ask-title">{ask.title}</h3>
            <p id="draw-ask-body">{ask.body}</p>
            <div className="draw-ask-actions">
              <button type="button" className="button secondary small" autoFocus onClick={() => answer(false)}>Cancel</button>
              <button type="button" className="button small danger-button" onClick={() => answer(true)}>{ask.action}</button>
            </div>
          </div>
        </div>}
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
