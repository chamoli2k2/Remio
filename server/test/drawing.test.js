import test from 'node:test';
import assert from 'node:assert/strict';
import { strokeHits, hasInk, emptyDrawing, trimDrawing, removePage, pageHasInk, PAGE, MAX_HEIGHT } from '../../shared/drawing.js';
import { drawingSchema } from '../src/middleware/validate.js';

test('the whole-stroke eraser finds a stroke between its samples, not only on them', () => {
  const line = { t: 'pen', c: '#000000', s: 4, p: [0, 0, 1000, 0] };
  assert.equal(strokeHits(line, 500, 3, 5), true, 'the middle of a long, fast line');
  assert.equal(strokeHits(line, 500, 40, 5), false);
  assert.equal(strokeHits({ ...line, t: 'eraser' }, 500, 0, 5), false, 'rubbing-out strokes are not themselves erasable ink');
});

test('a page with only rubbing out on it has nothing to save', () => {
  assert.equal(hasInk(emptyDrawing()), false);
  assert.equal(hasInk({ strokes: [{ t: 'eraser', p: [1, 1] }] }), false);
  assert.equal(hasInk({ strokes: [{ t: 'pen', p: [1, 1] }] }), true);
});

test('coordinates are rounded on the way in, so the stored document stays small', () => {
  const parsed = drawingSchema.parse({ ...emptyDrawing(), strokes: [{ t: 'pen', c: '#123abc', s: 2.5, p: [10.4, 20.6] }] });
  assert.deepEqual(parsed.strokes[0].p, [10, 21]);
});

test('a drawing grows a whole page at a time, up to a ceiling', () => {
  const ink = y => [{ t: 'pen', c: '#000000', s: 4, p: [10, y] }];
  assert.equal(drawingSchema.safeParse({ ...emptyDrawing(), h: 3000, strokes: ink(2900) }).success, true, 'ink on the third page');
  assert.equal(drawingSchema.safeParse({ ...emptyDrawing(), h: MAX_HEIGHT, strokes: ink(MAX_HEIGHT - 10) }).success, true);
  assert.equal(drawingSchema.safeParse({ ...emptyDrawing(), h: 1500, strokes: ink(10) }).success, false, 'half a page');
  assert.equal(drawingSchema.safeParse({ ...emptyDrawing(), h: MAX_HEIGHT + PAGE.height, strokes: ink(10) }).success, false, 'past the ceiling');
  assert.equal(drawingSchema.safeParse({ ...emptyDrawing(), strokes: ink(MAX_HEIGHT + 500) }).success, false, 'ink far below any page');
});

test('deleting a page takes its ink with it and moves the pages below up', () => {
  const line = y => ({ t: 'pen', c: '#000000', s: 4, p: [10, y, 200, y + 20] });
  const doc = { ...emptyDrawing(), h: 3000, strokes: [line(100), line(1500), line(2400)] };
  const after = removePage(doc, 1);
  assert.equal(after.h, 2000);
  assert.deepEqual(after.strokes.map(s => s.p[1]), [100, 1400], 'page 3 is now page 2');
  assert.equal(pageHasInk(after, 1), true);
  assert.deepEqual(removePage(doc, 0).strokes.map(s => s.p[1]), [500, 1400]);
  assert.deepEqual(removePage({ ...emptyDrawing(), strokes: [line(100)] }, 0), { ...emptyDrawing(), strokes: [] }, 'the only page is emptied, not removed');
  assert.equal(drawingSchema.safeParse(removePage({ ...doc, strokes: [line(980), line(1010)] }, 0)).success, true, 'a stroke straddling the break stays on the page');
});

test('saving drops the empty pages at the end, but never the ink or the first page', () => {
  const doc = { ...emptyDrawing(), h: 4000, strokes: [{ t: 'pen', c: '#000000', s: 10, p: [10, 1200] }, { t: 'eraser', c: '#000000', s: 30, p: [10, 3500] }] };
  assert.equal(trimDrawing(doc).h, 2000, 'the eraser does not count as ink');
  assert.equal(trimDrawing({ ...doc, strokes: [] }).h, PAGE.height);
  assert.equal(trimDrawing({ ...doc, strokes: [{ t: 'pen', c: '#000000', s: 10, p: [10, 3990] }] }).h, 4000, 'ink at the very bottom keeps its page');
});

/* ── Shapes and text ─────────────────────────────────────────────────────────────────────────── */
import { objectHit, objectAt, resizeObject, shapeFromDrag, keepOnPage, boundsOf, handlesFor, inkBottom, layoutText } from '../../shared/drawing.js';

const box = (t, extra = {}) => ({ id: 'abcd1234', t, x: 100, y: 100, w: 200, h: 100, c: '#2f6fdf', s: 4, ...extra });
const label = (extra = {}) => ({ id: 'text0001', t: 'text', x: 50, y: 50, w: 300, h: 40, c: '#1f1d28', fs: 32, text: 'Hello', ...extra });
const withObjects = objects => ({ ...emptyDrawing(), objects });

test('a drawing of only shapes or text can be saved, and old drawings without objects still can', () => {
  assert.equal(drawingSchema.safeParse(withObjects([box('rect')])).success, true);
  assert.equal(drawingSchema.safeParse(withObjects([label()])).success, true);
  assert.equal(drawingSchema.safeParse(withObjects([])).success, false, 'an empty page has nothing to save');
  const legacy = { v: 1, w: PAGE.width, h: PAGE.height, paper: 'blank', theme: 'light', strokes: [{ t: 'pen', c: '#000000', s: 3, p: [1, 1] }] };
  assert.deepEqual(drawingSchema.parse(legacy).objects, []);
  assert.equal(hasInk(withObjects([box('arrow')])), true);
});

test('objects are a closed, bounded shape: no extra fields, odd colours, markup-like ids or runaway text', () => {
  const bad = o => drawingSchema.safeParse(withObjects([o])).success;
  assert.equal(bad({ ...box('rect'), onclick: 'x' }), false, 'unknown field');
  assert.equal(bad(box('rect', { c: 'red' })), false, 'named colour');
  assert.equal(bad(box('rect', { c: 'url(javascript:1)' })), false);
  assert.equal(bad(box('star')), false, 'unknown shape');
  assert.equal(bad(box('rect', { id: '<img onerror>' })), false);
  assert.equal(bad(box('rect', { s: 99 })), false);
  assert.equal(bad(label({ text: '' })), false);
  assert.equal(bad(label({ text: 'x'.repeat(1001) })), false);
  assert.equal(bad(label({ text: 'a\u0000b' })), false, 'control characters');
  assert.equal(bad(label({ text: 'line one\nline two' })), true, 'a line break is fine');
  assert.equal(bad(label({ text: '<script>alert(1)</script>' })), true, 'markup is only ever text on a canvas');
  assert.equal(bad(label({ fs: 5 })), false);
  assert.equal(bad(label({ w: 5000 })), false);
});

test('there is a ceiling on objects, on total text, and ids cannot repeat', () => {
  const many = n => Array.from({ length: n }, (_, i) => box('rect', { id: `obj${String(i).padStart(5, '0')}` }));
  assert.equal(drawingSchema.safeParse(withObjects(many(400))).success, true);
  assert.equal(drawingSchema.safeParse(withObjects(many(401))).success, false);
  assert.equal(drawingSchema.safeParse(withObjects([box('rect'), box('ellipse')])).success, false, 'same id twice');
  const words = Array.from({ length: 31 }, (_, i) => label({ id: `text${String(i).padStart(4, '0')}`, text: 'x'.repeat(1000) }));
  assert.equal(drawingSchema.safeParse(withObjects(words)).success, false, 'over 30,000 characters of text');
});

test('a thin outline is picked up near its line, a filled shape anywhere inside, and the top one wins', () => {
  const ring = box('rect');
  assert.equal(objectHit(ring, 100, 150), true, 'on the left edge');
  assert.equal(objectHit(ring, 200, 150), false, 'the empty middle of an outline');
  assert.equal(objectHit({ ...ring, f: true }, 200, 150), true, 'inside a filled one');
  assert.equal(objectHit(ring, 500, 500), false);
  const disc = box('ellipse', { f: true });
  assert.equal(objectHit(disc, 200, 150), true);
  assert.equal(objectHit(disc, 101, 101), false, 'the corner of the box is outside the ellipse');
  const under = box('rect', { id: 'under001', f: true }), over = box('rect', { id: 'over0001', f: true });
  assert.equal(objectAt([under, over], 200, 150).id, 'over0001');
  assert.equal(objectHit(label(), 100, 60), true, 'anywhere in a text box');
  const diag = box('line', { x: 0, y: 0, w: 100, h: 100 });
  assert.equal(objectHit(diag, 50, 52), true); assert.equal(objectHit(diag, 90, 10), false);
});

test('dragging a handle resizes from the opposite side, never smaller than a sliver', () => {
  const r = box('rect');
  assert.deepEqual(boundsOf(resizeObject(r, 'se', 50, 20)), { x: 100, y: 100, w: 250, h: 120 });
  assert.deepEqual(boundsOf(resizeObject(r, 'nw', -30, -10)), { x: 70, y: 90, w: 230, h: 110 });
  assert.deepEqual(boundsOf(resizeObject(r, 'e', -5000, 0)), { x: 100, y: 100, w: 12, h: 100 }, 'cannot collapse or flip');
  const square = boundsOf(resizeObject(box('rect', { w: 100, h: 100 }), 'se', 60, 10, { keep: true }));
  assert.equal(square.w, square.h, 'shift keeps a square square');
  assert.deepEqual(handlesFor(r).length, 8); assert.deepEqual(handlesFor(box('arrow')), ['start', 'end']);
});

test('a line is resized by its ends and shift snaps it to a clean angle', () => {
  const l = box('line', { x: 0, y: 0, w: 100, h: 10 });
  const moved = resizeObject(l, 'end', 20, 40);
  assert.deepEqual([moved.x, moved.y, moved.w, moved.h], [0, 0, 120, 50]);
  const flat = resizeObject(l, 'end', 100, -8, { keep: true });
  assert.equal(flat.h, 0, 'a nearly flat line snaps flat');
  const start = resizeObject(l, 'start', 10, 10);
  assert.deepEqual([start.x + start.w, start.y + start.h], [100, 10], 'the far end does not move');
});

test('text resizes by width, and from a corner its letters grow with it', () => {
  const t = label({ w: 200, h: 40, fs: 20 });
  const wider = resizeObject(t, 'e', 100, 0, { relayout: () => 40 });
  assert.equal(wider.w, 300); assert.equal(wider.fs, 20);
  const bigger = resizeObject(t, 'se', 200, 0, { relayout: o => o.fs * 2 });
  assert.equal(bigger.fs, 40); assert.equal(bigger.w, 400);
  const fromTop = resizeObject(t, 'nw', -200, 0, { relayout: o => o.fs * 2 });
  assert.equal(fromTop.y + fromTop.h, t.y + t.h, 'the bottom edge stays put when dragging from the top');
  assert.equal(resizeObject(t, 'se', -5000, 0, { relayout: () => 20 }).fs >= 12, true);
});

test('a drag makes a box from either direction, a square or circle with shift, and a line from start to end', () => {
  assert.deepEqual(shapeFromDrag('rect', [300, 300], [100, 200]), { x: 100, y: 200, w: 200, h: 100 });
  const sq = shapeFromDrag('ellipse', [100, 100], [220, 150], { keep: true });
  assert.equal(sq.w, sq.h);
  assert.deepEqual(shapeFromDrag('arrow', [300, 300], [100, 200]), { x: 300, y: 300, w: -200, h: -100 });
});

test('objects are kept on the page, and move and count with their page', () => {
  assert.equal(keepOnPage(box('rect', { x: -40 }), PAGE.height).x, 0);
  assert.equal(keepOnPage(box('rect', { x: 1500 }), PAGE.height).x, PAGE.width - 200);
  assert.equal(keepOnPage(box('rect', { y: 950 }), PAGE.height).y, PAGE.height - 100);
  const doc = { ...withObjects([box('rect', { id: 'one00001', y: 100 }), box('rect', { id: 'two00001', y: 1500 }), box('rect', { id: 'three001', y: 2400 })]), h: 3000 };
  assert.equal(pageHasInk(doc, 1), true);
  const after = removePage(doc, 1);
  assert.deepEqual(after.objects.map(o => [o.id, o.y]), [['one00001', 100], ['three001', 1400]]);
  assert.ok(inkBottom({ strokes: [], objects: [box('rect', { y: 1900 })] }) >= 2000, 'a shape near the bottom counts, so the page grows');
});

test('text wraps inside its box and splits words too long to fit', () => {
  const ctx = { font: '', save() {}, restore() {}, measureText: s => ({ width: s.length * 10 }) };
  assert.deepEqual(layoutText(ctx, label({ w: 100, text: 'aaa bbb ccc ddd' })).lines, ['aaa bbb', 'ccc ddd']);
  assert.deepEqual(layoutText(ctx, label({ w: 100, text: 'one\n\ntwo' })).lines, ['one', '', 'two'], 'blank lines are kept');
  const long = layoutText(ctx, label({ w: 50, text: 'abcdefghijkl' })).lines;
  assert.ok(long.length >= 3 && long.every(l => l.length <= 5), JSON.stringify(long));
});
