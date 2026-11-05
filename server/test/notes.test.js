import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { embedLine, embedsIn, segmentsOf, snippetOf, setEmbedWidth, clampWidth, withoutEmbeds, EMBED_WIDTH } from '../../shared/notes.js';

const image = 'a'.repeat(24), drawing = crypto.randomUUID();

test('an embed is only an embed on a line by itself', () => {
  const body = ['Intro', embedLine('media', image, 'Leaf'), `inline ${embedLine('drawing', drawing)} is text`, embedLine('drawing', drawing, 'Sketch')].join('\n');
  assert.deepEqual(embedsIn(body), [{ kind: 'media', id: image, caption: 'Leaf', width: null }, { kind: 'drawing', id: drawing, caption: 'Sketch', width: null }]);
});

test('other image sources are never treated as embeds', () => {
  for (const line of ['![x](https://evil.test/a.png)', '![x](javascript:alert(1))', '![x](media:../../etc)', '![x](drawing:zz)']) assert.deepEqual(embedsIn(line), [], line);
});

test('a page splits into text and embeds in order', () => {
  const body = `# Title\n\n${embedLine('media', image)}\nAfter`;
  assert.deepEqual(segmentsOf(body).map(s => s.kind), ['text', 'media', 'text']);
});

test('captions cannot break out of the embed syntax', () => {
  const line = embedLine('media', image, 'a](javascript:x)\n![b');
  assert.equal(embedsIn(line).length, 1);
  assert.ok(!line.includes('\n'));
});

test('a snippet drops Markdown and embeds', () => {
  assert.equal(snippetOf(`## Light\n\nChlorophyll absorbs **light**.\n${embedLine('drawing', drawing)}\n- Water`), 'Light Chlorophyll absorbs light. Water');
});

test('a picture’s width is written on its line, snapped to a step, and 100 means nothing was set', () => {
  const id = crypto.randomUUID();
  assert.equal(embedLine('media', id, 'Leaf', 55), `![Leaf](media:${id}?w=55)`);
  assert.equal(embedLine('media', id, 'Leaf', 100), `![Leaf](media:${id})`, 'full width is the default and is not stored');
  assert.equal(clampWidth(33), 35);
  assert.equal(clampWidth(2), EMBED_WIDTH.min);
  assert.equal(clampWidth(900), EMBED_WIDTH.max);
  assert.equal(clampWidth('junk'), EMBED_WIDTH.max);
  assert.deepEqual(embedsIn(`![a](media:${id}?w=55)`).map(e => e.width), [55]);
  assert.deepEqual(embedsIn(`![a](media:${id})`).map(e => e.width), [null]);
  assert.deepEqual(embedsIn(`![a](media:${id}?w=500)`).map(e => e.width), [null], 'out of range reads as full width');
  assert.equal(segmentsOf(`x\n![a](drawing:${id}?w=40)`)[1].width, 40);
});

test('resizing one picture changes its line and nothing else', () => {
  const [a, b] = [crypto.randomUUID(), crypto.randomUUID()];
  const body = `Intro\n\n![One](media:${a})\n\nMiddle\n\n![Two](media:${b}?w=30)\n\nEnd`;
  const resized = setEmbedWidth(body, 0, 60);
  assert.equal(resized, body.replace(`media:${a})`, `media:${a}?w=60)`));
  assert.equal(setEmbedWidth(resized, 1, 100), resized.replace('?w=30', ''), 'back to full width drops the suffix');
  assert.equal(setEmbedWidth(body, 7, 50), body, 'a picture that is not there changes nothing');
  assert.equal(withoutEmbeds(body, [a]).includes(a), false);
  assert.ok(withoutEmbeds(body, [a]).includes(b));
});

test('a picture’s width is written on its line, snapped to a step, and 100 means nothing was set', () => {
  const id = crypto.randomUUID();
  assert.equal(embedLine('media', id, 'Leaf', 55), `![Leaf](media:${id}?w=55)`);
  assert.equal(embedLine('media', id, 'Leaf', 100), `![Leaf](media:${id})`, 'full width is the default and is not stored');
  assert.equal(clampWidth(33), 35);
  assert.equal(clampWidth(2), EMBED_WIDTH.min);
  assert.equal(clampWidth(900), EMBED_WIDTH.max);
  assert.equal(clampWidth('junk'), EMBED_WIDTH.max);
  assert.deepEqual(embedsIn(`![a](media:${id}?w=55)`).map(e => e.width), [55]);
  assert.deepEqual(embedsIn(`![a](media:${id})`).map(e => e.width), [null]);
  assert.deepEqual(embedsIn(`![a](media:${id}?w=500)`).map(e => e.width), [null], 'out of range reads as full width');
  assert.equal(segmentsOf(`x\n![a](drawing:${id}?w=40)`)[1].width, 40);
});

test('resizing one picture changes its line and nothing else', () => {
  const [a, b] = [crypto.randomUUID(), crypto.randomUUID()];
  const body = `Intro\n\n![One](media:${a})\n\nMiddle\n\n![Two](media:${b}?w=30)\n\nEnd`;
  const resized = setEmbedWidth(body, 0, 60);
  assert.equal(resized, body.replace(`media:${a})`, `media:${a}?w=60)`));
  assert.equal(setEmbedWidth(resized, 1, 100), resized.replace('?w=30', ''), 'back to full width drops the suffix');
  assert.equal(setEmbedWidth(body, 7, 50), body, 'a picture that is not there changes nothing');
  assert.equal(withoutEmbeds(body, [a]).includes(a), false);
  assert.ok(withoutEmbeds(body, [a]).includes(b));
});
