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
