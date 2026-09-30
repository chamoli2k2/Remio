import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { BRAND, brandName, sessionCookieNames, storageKeys } from '../../shared/brand.js';

test('the display values all derive from the name', () => {
  assert.equal(brandName, BRAND.name);
  assert.ok(BRAND.title.startsWith(BRAND.name));
  assert.ok(BRAND.description.startsWith(BRAND.name));
  assert.ok(BRAND.legalName.startsWith(BRAND.name));
  for (const address of Object.values(BRAND.email)) assert.match(address, /^[^@\s]+@[^@\s]+\.[a-z]+$/i, address);
  assert.ok(BRAND.mailFrom.includes(BRAND.name) && BRAND.mailFrom.includes(BRAND.email.general));
});

test('the identifiers all derive from the slug', () => {
  assert.equal(BRAND.slug, BRAND.name.toLowerCase());
  assert.equal(BRAND.sessionCookie, `${BRAND.slug}_session`);
  for (const key of Object.values(BRAND.storage)) assert.ok(key.startsWith(BRAND.slug), key);
});

test('a rename still accepts sessions and preferences issued under the old name', () => {
  assert.equal(sessionCookieNames[0], BRAND.sessionCookie, 'the current name is preferred');
  for (const old of BRAND.legacySlugs) assert.ok(sessionCookieNames.includes(`${old}_session`), old);

  assert.equal(storageKeys('theme')[0], BRAND.storage.theme);
  for (const old of BRAND.legacySlugs) assert.ok(storageKeys('theme').includes(`${old}-theme`), old);
});

/** Walk the source, skipping build output and dependencies. */
function* sources(dir) {
  for (const entry of readdirSync(dir)) {
    // Build output is not source. `dist-ssr` is the server-rendering bundle, and it contains the
    // product name as many times as the components it was built from mention it through BRAND.
    if (['node_modules', 'dist', 'dist-ssr', '.git', '.local-data', 'coverage'].includes(entry)) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) yield* sources(path);
    else if (/\.(js|jsx)$/.test(entry)) yield path;
  }
}

/**
 * Capitalised uses of the word that are the vocabulary of spaced repetition rather than the brand.
 * "Recall" here sits beside "Collect" as a step in how studying works, so it stays a verb whatever
 * the product ends up being called.
 */
const ALLOWED = { 'client/src/pages/HomePage.jsx': 1 };

test('no source file spells the product name out for itself', () => {
  const root = new URL('../../', import.meta.url).pathname;
  const offenders = [];
  for (const path of sources(root)) {
    if (path.endsWith('shared/brand.js') || path.endsWith('server/test/brand.test.js')) continue;
    const text = readFileSync(path, 'utf8');
    // The brand as a standalone capitalised word. Lowercase "recall" is the spaced-repetition verb
    // and "recalled"/"recallStability" are FSRS terms, so only the exact product name counts.
    const relative = path.replace(root, '');
    for (const word of [BRAND.name, 'Recall']) {
      const hits = (text.match(new RegExp(`\\b${word}\\b`, 'g')) || []).length - (ALLOWED[relative] || 0);
      if (hits > 0) offenders.push(`${relative}: ${hits}x ${word}`);
    }
  }
  assert.deepEqual(offenders, [], `these should read from BRAND instead:\n${offenders.join('\n')}`);
});
