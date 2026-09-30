import test from 'node:test';
import assert from 'node:assert/strict';
import { IMAGE_WIDTHS, imageWidth, srcSet } from '../../shared/images.js';
import * as storage from '../src/services/storage.js';
import { applyRender, clearCache } from '../src/services/ssr.js';
import { isRenderable } from '../src/services/ssrData.js';
import { createStore } from '../../client/src/services/store.js';

/**
 * The parts of server-rendering and responsive images that can be checked without a browser, a
 * bucket, or a build.
 *
 * The render itself is exercised by loading a real page from a running server; what is here is the
 * reasoning around it — which URLs are rendered at all, how the data crosses into the page, and the
 * arithmetic that decides which copy of an image a browser is offered.
 */

test('only public routes are server-rendered', () => {
  for (const path of ['/', '/explore', '/pricing', '/terms', '/u/demolearner', '/folders/6abc357a9fd588420259fe92']) {
    assert.equal(isRenderable(path), true, `${path} should be rendered`);
  }
  // Nothing behind a sign-in: no crawler sees these, and rendering them would spend CPU per
  // navigation to produce markup only one person may read.
  for (const path of ['/settings', '/dashboard', '/progress', '/teams/abc', '/rooms/ABCDEF', '/folders/not-an-id']) {
    assert.equal(isRenderable(path), false, `${path} should not be rendered`);
  }
});

test('a script-closing sequence in card text cannot break out of the boot payload', () => {
  const shell = '<html><body><div id="root"></div></body></html>';
  // The three ways out of an inline script: closing the tag, opening a comment that ends it, and
  // the line separators that are newlines to a JavaScript parser but not to JSON.
  const nasty = '</script><img src=x onerror=alert(1)>  --> \u2028\u2029';
  const html = applyRender(shell, { body: '<p>hello</p>', payload: { data: { '/x': { text: nasty } } } });

  assert.match(html, /<div id="root"><p>hello<\/p><\/div>/);
  assert.equal(html.includes('</script><img'), false, 'the payload must not be able to close its own script tag');
  assert.equal(html.includes('-->'), false);
  assert.equal(html.includes('\u2028'), false);

  // Still the same value once parsed, which is the point: escaped, not mangled.
  const json = html.match(/window\.__APP_BOOT__=(.+?)<\/script>/)[1];
  assert.equal(JSON.parse(json).data['/x'].text, nasty);
});

test('a render hands its cache to the browser, and failures are left behind', async () => {
  const store = createStore();
  store.put('/folders?scope=explore', { folders: [{ id: 'a' }] });
  store.register('/broken', () => Promise.reject(new Error('nope')));
  await store.load('/broken');

  const out = store.dehydrate();
  assert.deepEqual(out['/folders?scope=explore'], { folders: [{ id: 'a' }] });
  // An error is the browser's to rediscover. Serialising it would start the app with somebody
  // else's failed request already on screen and nothing to retry it.
  assert.equal('/broken' in out, false);

  const next = createStore();
  next.hydrate(out);
  assert.deepEqual(next.peek('/folders?scope=explore').data, { folders: [{ id: 'a' }] });
});

test('the cache refreshes stale entries in the background and keeps showing the old value', async () => {
  const store = createStore();
  let served = 0;
  store.register('/thing', async () => ({ n: ++served }));
  await store.load('/thing');
  assert.equal(store.peek('/thing').data.n, 1);

  // Fresh: nothing happens.
  store.revalidate('/thing', 60_000);
  assert.equal(served, 1);

  // Stale: refetched, and the previous value was readable the entire time.
  await new Promise(r => setTimeout(r, 5));
  store.revalidate('/thing', 1);
  assert.equal(store.peek('/thing').data.n, 1, 'the old value stays on screen while the new one loads');
  await new Promise(r => setTimeout(r, 10));
  assert.equal(store.peek('/thing').data.n, 2);
});

test('prefetching declines work that is already done', async () => {
  const store = createStore();
  let calls = 0;
  const loader = async () => { calls += 1; return { ok: true }; };
  store.prefetch('/a', loader);
  store.prefetch('/a', loader);
  await new Promise(r => setTimeout(r, 5));
  store.prefetch('/a', loader);
  assert.equal(calls, 1, 'a guess that has already paid off is not worth making twice');
});

test('only widths on the ladder are served', () => {
  for (const w of IMAGE_WIDTHS) assert.equal(imageWidth(String(w)), w);
  // Anything else is refused rather than resized. Every distinct width becomes an object stored
  // for good, so an open-ended parameter is an invitation to fill the bucket.
  for (const bad of ['321', '0', '-640', '99999', 'big', '', null, undefined]) {
    assert.equal(imageWidth(bad), null, `${bad} should not be a servable width`);
  }
  // Written differently but the same number, so it resolves to the same rung and the same stored
  // object. Worth allowing: it cannot create anything new, and the app only ever emits integers.
  assert.equal(imageWidth('640.0'), 640);
  assert.equal(imageWidth('1e3'), null);
});

test('srcset never offers a copy larger than the original', () => {
  const url = w => `/api/media/abc?w=${w}`;

  const full = srcSet(url, {});
  assert.equal(full.split(',').length, IMAGE_WIDTHS.length);
  assert.match(full, /\/api\/media\/abc\?w=320 320w/);

  // A 500px upload: offering 640 and above would download the same pixels, upscaled.
  const small = srcSet(url, { max: 500 });
  assert.equal(small, '/api/media/abc?w=320 320w');

  // Smaller than the narrowest rung: there is nothing useful to offer, so say nothing and let the
  // plain src stand.
  assert.equal(srcSet(url, { max: 100 }), '');
});

test('a resized copy has its own key, and deleting an image takes them all', () => {
  const key = 'f/123/abc.webp';
  assert.equal(storage.variantKey(key, 640), 'd/640/f/123/abc.webp');

  const all = storage.allKeysFor(key, [320, 640]);
  assert.deepEqual(all, [key, 'd/320/f/123/abc.webp', 'd/640/f/123/abc.webp']);

  // A width that is no longer on the ladder is ignored rather than turned into a key that was
  // never written, which would make every delete look partly failed.
  assert.deepEqual(storage.allKeysFor(key, [640, 777]), [key, 'd/640/f/123/abc.webp']);
  // An image that never reached the bucket has no keys at all, rather than one built from nothing.
  assert.deepEqual(storage.allKeysFor('', [320]), []);
});

test('a published image is cached publicly and for longer than a private one', () => {
  // The short signature is what protects a private image, so it cannot be cached by anything
  // shared. A published one guards nothing, and asking again for it every four minutes is waste.
  assert.ok(storage.PUBLIC_SIGNED_SECONDS > storage.SIGNED_SECONDS);
  assert.ok(storage.PUBLIC_REDIRECT_CACHE_SECONDS > storage.REDIRECT_CACHE_SECONDS);
  // Both windows have to stay inside their signature or a cached redirect outlives its link.
  assert.ok(storage.REDIRECT_CACHE_SECONDS < storage.SIGNED_SECONDS);
  assert.ok(storage.PUBLIC_REDIRECT_CACHE_SECONDS < storage.PUBLIC_SIGNED_SECONDS);
  // Signature v4 refuses anything beyond a week.
  assert.ok(storage.PUBLIC_SIGNED_SECONDS <= 7 * 24 * 60 * 60);
});

test('clearing the render cache is safe to call when nothing is cached', () => {
  assert.doesNotThrow(() => { clearCache(); clearCache(); });
});
