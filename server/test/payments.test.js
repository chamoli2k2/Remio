import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import * as razorpay from '../src/services/payments/razorpay.js';
import { availableMethods, configWarnings, methodById, requireMethod } from '../src/services/payments/index.js';

const hmac = (payload, secret) => crypto.createHmac('sha256', secret).update(payload).digest('hex');
const withEnv = (vars, fn) => {
  const before = Object.fromEntries(Object.keys(vars).map(k => [k, process.env[k]]));
  Object.entries(vars).forEach(([k, v]) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; });
  try { return fn(); } finally { Object.entries(before).forEach(([k, v]) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; }); }
};

test('a checkout callback is trusted only when the signature matches the secret', () => {
  withEnv({ RAZORPAY_KEY_ID: 'rzp_test_key', RAZORPAY_KEY_SECRET: 'top-secret' }, () => {
    const orderId = 'order_ABC', paymentId = 'pay_XYZ';
    const good = hmac(`${orderId}|${paymentId}`, 'top-secret');
    assert.equal(razorpay.checkoutSignatureValid({ orderId, paymentId, signature: good }), true);
    assert.equal(razorpay.checkoutSignatureValid({ orderId, paymentId, signature: hmac(`${orderId}|${paymentId}`, 'guessed') }), false, 'a signature from the wrong secret is refused');
    assert.equal(razorpay.checkoutSignatureValid({ orderId, paymentId: 'pay_OTHER', signature: good }), false, 'a signature cannot be replayed onto another payment');
    assert.equal(razorpay.checkoutSignatureValid({ orderId, paymentId, signature: 'short' }), false, 'a wrong-length candidate is refused rather than throwing');
    assert.equal(razorpay.checkoutSignatureValid({ orderId, paymentId, signature: undefined }), false);
  });
});

test('a webhook is verified against the raw bytes, not a re-serialised body', () => {
  withEnv({ RAZORPAY_WEBHOOK_SECRET: 'hook-secret' }, () => {
    // Key order and whitespace are part of what the gateway signed, so only the original bytes verify.
    const raw = Buffer.from('{"event":"payment.captured","payload":{"payment":{"entity":{"id":"pay_1","order_id":"order_1","status":"captured"}}}}');
    assert.equal(razorpay.webhookSignatureValid(raw, hmac(raw.toString(), 'hook-secret')), true);
    const reserialised = Buffer.from(JSON.stringify(JSON.parse(raw.toString()), null, 2));
    assert.equal(razorpay.webhookSignatureValid(reserialised, hmac(raw.toString(), 'hook-secret')), false);
    assert.deepEqual(razorpay.readWebhook(raw), { event: 'payment.captured', orderId: 'order_1', paymentId: 'pay_1', status: 'captured' });
  });
});

test('readWebhook survives an envelope with no payment in it', () => {
  const raw = Buffer.from('{"event":"order.paid"}');
  assert.deepEqual(razorpay.readWebhook(raw), { event: 'order.paid', orderId: null, paymentId: null, status: null });
  assert.throws(() => razorpay.readWebhook(Buffer.from('not json')), /valid JSON/);
});

test('a gateway that can take money but cannot verify a webhook is called out at boot', () => {
  const keys = { RAZORPAY_KEY_ID: 'rzp_test_key', RAZORPAY_KEY_SECRET: 's' };
  // The dangerous shape: orders go through, the money leaves the buyer, and every webhook then
  // fails its signature check, so nobody is ever granted what they paid for.
  withEnv({ ...keys, RAZORPAY_WEBHOOK_SECRET: undefined }, () => {
    assert.match(configWarnings().join(' '), /RAZORPAY_WEBHOOK_SECRET/);
  });
  withEnv({ ...keys, RAZORPAY_WEBHOOK_SECRET: '' }, () => {
    // An empty string is what a value starting with # parses to, which is silent otherwise.
    assert.match(configWarnings().join(' '), /RAZORPAY_WEBHOOK_SECRET/, 'blank counts as missing');
  });
  withEnv({ ...keys, RAZORPAY_WEBHOOK_SECRET: 'whsec' }, () => {
    assert.deepEqual(configWarnings(), [], 'fully configured, so nothing to say');
  });
  withEnv({ RAZORPAY_KEY_ID: '', RAZORPAY_KEY_SECRET: '', RAZORPAY_WEBHOOK_SECRET: undefined }, () => {
    const warnings = configWarnings().join(' ');
    assert.match(warnings, /nothing can be bought/);
    assert.doesNotMatch(warnings, /WEBHOOK/, 'no point naming the webhook when the gateway is off entirely');
  });
});

test('only usable methods are advertised, and the retired transfer flow stays retired', () => {
  withEnv({ RAZORPAY_KEY_ID: 'rzp_test_key', RAZORPAY_KEY_SECRET: 's', MANUAL_PAYMENT: undefined }, () => {
    assert.deepEqual(availableMethods().map(m => m.id), ['razorpay'], 'the gateway alone, because the transfer flow is off by default now');
    assert.throws(() => requireMethod('manual'), /not available/);
  });
  withEnv({ RAZORPAY_KEY_ID: '', RAZORPAY_KEY_SECRET: '', MANUAL_PAYMENT: undefined }, () => {
    // Nothing is offered rather than falling back to the transfer, so a server missing its keys
    // cannot quietly start collecting screenshots again.
    assert.deepEqual(availableMethods().map(m => m.id), [], 'no keys means nothing is on sale');
    assert.throws(() => requireMethod('razorpay'), /not available/);
    assert.throws(() => requireMethod('manual'), /not available/);
  });
  withEnv({ RAZORPAY_KEY_ID: 'rzp_test_key', RAZORPAY_KEY_SECRET: 's', MANUAL_PAYMENT: 'on' }, () => {
    assert.deepEqual(availableMethods().map(m => m.id), ['razorpay', 'manual'], 'the old flow can still be brought back for a stranded order');
  });
  assert.throws(() => requireMethod('bitcoin'), /how you want to pay/);
  assert.equal(methodById('manual').requiresProof, true, 'the transfer needs a screenshot; the gateway does not');
  assert.equal(methodById('razorpay').requiresProof, false);
});
