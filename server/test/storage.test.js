import test from 'node:test';
import assert from 'node:assert/strict';
import * as storage from '../src/services/storage.js';

/**
 * The configuration rules and the key format, without a bucket.
 *
 * Signing is local arithmetic — an HMAC over the request — so even the presigned URL can be
 * checked offline. What cannot be checked here is whether Cloudflare accepts it, which is what
 * the round-trip against the real bucket is for.
 */
const R2_VARS = ['R2_BUCKET', 'R2_ACCOUNT_ID', 'R2_ENDPOINT', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY'];

const withEnv = async (values, fn) => {
  const before = Object.fromEntries(R2_VARS.map(k => [k, process.env[k]]));
  for (const k of R2_VARS) delete process.env[k];
  Object.assign(process.env, values);
  try { return await fn(); } finally {
    for (const k of R2_VARS) { if (before[k] === undefined) delete process.env[k]; else process.env[k] = before[k]; }
  }
};

const FULL = { R2_BUCKET: 'test-bucket', R2_ACCOUNT_ID: 'acc123', R2_ACCESS_KEY_ID: 'key', R2_SECRET_ACCESS_KEY: 'secret' };

test('storage is only considered configured when every part is present', async () => {
  await withEnv({}, () => assert.equal(storage.isConfigured(), false, 'nothing set'));
  await withEnv(FULL, () => assert.equal(storage.isConfigured(), true));
  // A half-filled configuration is the dangerous one: it looks deliberate and cannot work.
  for (const missing of Object.keys(FULL)) {
    const partial = { ...FULL }; delete partial[missing];
    await withEnv(partial, () => {
      assert.equal(storage.isConfigured(), false, `${missing} missing should not count as configured`);
      assert.match(storage.configWarnings().join(' '), /partly configured/, 'and it says so at boot');
    });
  }
  // Nothing set at all is a deliberate choice, not a mistake, so it warns about nothing.
  await withEnv({}, () => assert.deepEqual(storage.configWarnings(), []));
});

test('the endpoint can be given directly or derived from the account id', async () => {
  // The SDK addresses buckets as subdomains, so the bucket name leads the host rather than the
  // path. Worth pinning: it is what the Content-Security-Policy wildcard has to cover.
  await withEnv({ ...FULL }, async () => {
    const { host, pathname } = new URL(await storage.signedUrl('f/x/y.webp', 60));
    assert.equal(host, 'test-bucket.acc123.r2.cloudflarestorage.com', 'derived from the account id');
    assert.equal(pathname, '/f/x/y.webp', 'and the key is the path');
  });
  await withEnv({ ...FULL, R2_ENDPOINT: 'https://written-out.example.com' }, async () => {
    assert.equal(new URL(await storage.signedUrl('f/x/y.webp', 60)).host, 'test-bucket.written-out.example.com', 'an explicit endpoint wins');
  });
});

test('the policy wildcard covers the host the SDK actually uses', async () => {
  await withEnv(FULL, async () => {
    const { host } = new URL(await storage.signedUrl('f/x/y.webp', 60));
    // 'https://*.r2.cloudflarestorage.com' in img-src: a CSP wildcard spans any number of labels,
    // which it has to here, because the host is bucket.account.r2.cloudflarestorage.com.
    assert.ok(host.endsWith('.r2.cloudflarestorage.com'));
    assert.equal(host.split('.').length, 5, 'two labels in front of the suffix');
  });
});

test('keys are unguessable, folder-prefixed, and carry the right extension', () => {
  const a = storage.newKey('folder123', 'image/webp');
  const b = storage.newKey('folder123', 'image/webp');
  assert.notEqual(a, b, 'two keys for the same folder never collide');
  assert.match(a, /^f\/folder123\/[0-9a-f-]{36}\.webp$/);
  assert.match(storage.newKey('f1', 'image/png'), /\.png$/);
  assert.match(storage.newKey('f1', 'image/jpeg'), /\.jpg$/);
  // A key ends up visible in a presigned URL, so it must not be derivable from the row's id.
  assert.doesNotMatch(storage.newKey('folder123', 'image/webp'), /folder123\/folder123/);
});

test('a signed link carries a signature and an expiry, and expires when told to', async () => {
  await withEnv(FULL, async () => {
    const url = new URL(await storage.signedUrl('f/x/y.webp', 90));
    assert.equal(url.searchParams.get('X-Amz-Expires'), '90');
    assert.ok(url.searchParams.get('X-Amz-Signature'), 'it is signed');
    assert.ok(url.searchParams.get('X-Amz-Credential').includes('key'), 'by our key');
  });
});

test('the browser may not cache a redirect for longer than the link it points at', () => {
  // Otherwise a cached redirect outlives its signature and starts handing out dead links.
  assert.ok(storage.REDIRECT_CACHE_SECONDS < storage.SIGNED_SECONDS);
});

test('deleting nothing, or deleting with no bucket, is a no-op rather than an error', async () => {
  await withEnv({}, async () => {
    assert.deepEqual(await storage.remove(['some/key']), { removed: 0 }, 'unconfigured: nothing to do');
  });
  await withEnv(FULL, async () => {
    assert.deepEqual(await storage.remove([]), { removed: 0 });
    assert.deepEqual(await storage.remove([null, undefined, '']), { removed: 0 }, 'rows with no key are skipped');
  });
});
