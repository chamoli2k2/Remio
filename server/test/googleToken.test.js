import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { verify, _setKeyCache, isConfigured } from '../src/services/auth/googleToken.js';

/**
 * These tests sign their own tokens.
 *
 * The point of the verifier is that it rejects everything except a token Google actually signed
 * for this application, and the only way to test that is to hold the signing key ourselves: mint a
 * good token, prove it is accepted, then mint each flavour of bad one and prove it is not. A stub
 * key set stands in for Google's published keys so nothing here touches the network.
 */
const AUDIENCE = 'remio-test.apps.googleusercontent.com';
const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const KID = 'test-key-1';

const b64 = obj => Buffer.from(JSON.stringify(obj)).toString('base64url');

function tokenFor(claims = {}, { key = privateKey, header = {} } = {}) {
  const head = b64({ alg: 'RS256', kid: KID, typ: 'JWT', ...header });
  const body = b64({
    iss: 'https://accounts.google.com', aud: AUDIENCE, sub: '1234567890',
    email: 'someone@gmail.com', email_verified: true, name: 'Some One',
    exp: Math.floor(Date.now() / 1000) + 600, ...claims,
  });
  if (header.alg === 'none') return `${head}.${body}.`;
  const signature = crypto.createSign('RSA-SHA256').update(`${head}.${body}`).sign(key).toString('base64url');
  return `${head}.${body}.${signature}`;
}

// Awaited, not just called: restoring the environment in a `finally` around an un-awaited promise
// would put it back before the verification it is meant to cover had run.
const withClientId = async (id, fn) => {
  const before = process.env.GOOGLE_CLIENT_ID;
  process.env.GOOGLE_CLIENT_ID = id;
  // The stub is reinstated per call because a rejected token can trigger a refetch, which would
  // otherwise empty the cache and send the next test to the network.
  _setKeyCache({ keys: [{ ...publicKey.export({ format: 'jwk' }), kid: KID, alg: 'RS256', use: 'sig' }], expiresAt: Date.now() + 60000 });
  try { return await fn(); } finally { if (before === undefined) delete process.env.GOOGLE_CLIENT_ID; else process.env.GOOGLE_CLIENT_ID = before; }
};

test('a token Google signed for us is accepted, and its claims come back', async () => {
  await withClientId(AUDIENCE, async () => {
    const claims = await verify(tokenFor());
    assert.equal(claims.googleId, '1234567890');
    assert.equal(claims.email, 'someone@gmail.com');
    assert.equal(claims.emailVerified, true);
    assert.equal(claims.name, 'Some One');
  });
});

test('the email is lowercased and a string email_verified still counts as verified', async () => {
  await withClientId(AUDIENCE, async () => {
    const claims = await verify(tokenFor({ email: 'Mixed.Case@Gmail.COM', email_verified: 'true' }));
    assert.equal(claims.email, 'mixed.case@gmail.com');
    assert.equal(claims.emailVerified, true, 'Google sends this as a string from some endpoints');
  });
});

test('a token minted for a different application is refused', async () => {
  await withClientId(AUDIENCE, async () => {
    // The whole reason the audience is checked: without it, a valid Google token issued to any
    // other site could be replayed here and would sign somebody in.
    await assert.rejects(verify(tokenFor({ aud: 'someone-elses-app.apps.googleusercontent.com' })), /not meant for us/);
  });
});

test('a token signed by the wrong key is refused', async () => {
  await withClientId(AUDIENCE, async () => {
    const attacker = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    await assert.rejects(verify(tokenFor({}, { key: attacker.privateKey })), /could not be verified/);
  });
});

test('an unsigned token claiming alg none is refused', async () => {
  await withClientId(AUDIENCE, async () => {
    // The oldest JWT hole there is: trusting the algorithm the token names about itself.
    await assert.rejects(verify(tokenFor({}, { header: { alg: 'none' } })), /could not be read/);
  });
});

test('an expired token is refused, and a slightly slow clock is not', async () => {
  await withClientId(AUDIENCE, async () => {
    const now = Math.floor(Date.now() / 1000);
    await assert.rejects(verify(tokenFor({ exp: now - 120 })), /expired/);
    await verify(tokenFor({ exp: now - 30 }));
  });
});

test('a token from somewhere other than Google is refused', async () => {
  await withClientId(AUDIENCE, async () => {
    await assert.rejects(verify(tokenFor({ iss: 'https://accounts.evil.example' })), /could not be verified/);
  });
});

test('a token with no subject or no email is refused', async () => {
  await withClientId(AUDIENCE, async () => {
    await assert.rejects(verify(tokenFor({ sub: undefined })), /did not tell us enough/);
    await assert.rejects(verify(tokenFor({ email: undefined })), /did not tell us enough/);
  });
});

test('rubbish that is not a token at all is refused without reaching Google', async () => {
  await withClientId(AUDIENCE, async () => {
    for (const bad of ['', 'not-a-token', 'a.b', 'a.b.c.d', '{}.{}.{}']) {
      await assert.rejects(verify(bad), /could not be read/, `${bad} should be refused`);
    }
  });
});

test('with no client id configured, Google sign-in reports itself as unavailable', async () => {
  const before = process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_ID;
  try {
    assert.equal(isConfigured(), false);
    await assert.rejects(verify(tokenFor()), /not set up/);
  } finally { if (before !== undefined) process.env.GOOGLE_CLIENT_ID = before; }
});
