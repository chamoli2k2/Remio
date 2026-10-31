import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { embedLine, embedsIn, segmentsOf, snippetOf } from '../../shared/notes.js';

const image = 'a'.repeat(24), drawing = crypto.randomUUID();

test('an embed is only an embed on a line by itself', () => {
  const body = ['Intro', embedLine('media', image, 'Leaf'), `inline ${embedLine('drawing', drawing)} is text`, embedLine('drawing', drawing, 'Sketch')].join('\n');
  assert.deepEqual(embedsIn(body), [{ kind: 'media', id: image, caption: 'Leaf' }, { kind: 'drawing', id: drawing, caption: 'Sketch' }]);
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
