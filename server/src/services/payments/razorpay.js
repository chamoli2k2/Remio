import crypto from 'node:crypto';
import { AppError, badRequest } from '../../utils/errors.js';

/**
 * Overridable so a test suite can point the client at a stub on localhost and exercise the real
 * request-building, error-mapping, and order-reserving code without reaching the internet or
 * needing live keys. Unset everywhere except in tests, which is where it should stay.
 */
const API = () => process.env.RAZORPAY_API_URL || 'https://api.razorpay.com/v1';
export const keyId = () => process.env.RAZORPAY_KEY_ID || '';
const keySecret = () => process.env.RAZORPAY_KEY_SECRET || '';
const webhookSecret = () => process.env.RAZORPAY_WEBHOOK_SECRET || '';
export const isConfigured = () => !!(keyId() && keySecret());

const sign = (payload, secret) => crypto.createHmac('sha256', secret).update(payload).digest('hex');
/** Constant-time compare that tolerates a wrong-length or non-hex candidate instead of throwing. */
export function signatureMatches(payload, candidate, secret) {
  if (!secret || typeof candidate !== 'string') return false;
  const expected = Buffer.from(sign(payload, secret), 'utf8');
  const given = Buffer.from(candidate, 'utf8');
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}

/** Razorpay signs the checkout callback over "<order_id>|<payment_id>" with the API secret. */
export const checkoutSignatureValid = ({ orderId, paymentId, signature }) => signatureMatches(`${orderId}|${paymentId}`, signature, keySecret());
/** Webhooks are signed over the exact raw body, so it must be verified before any JSON parsing. */
export const webhookSignatureValid = (rawBody, signature) => signatureMatches(rawBody.toString('utf8'), signature, webhookSecret());

/** Pulls the parts we care about out of a webhook envelope, whatever event it is. */
export function readWebhook(rawBody) {
  let body;
  try { body = JSON.parse(rawBody.toString('utf8')); } catch { throw badRequest('Webhook body is not valid JSON.', 'BAD_JSON'); }
  const payment = body?.payload?.payment?.entity;
  return { event: body?.event || '', orderId: payment?.order_id || null, paymentId: payment?.id || null, status: payment?.status || null };
}

export async function createOrder({ amount, currency = 'INR', receipt, notes }) {
  const auth = Buffer.from(`${keyId()}:${keySecret()}`).toString('base64');
  let response;
  try {
    response = await fetch(`${API()}/orders`, {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount, currency, receipt, notes, payment_capture: 1 }),
      signal: AbortSignal.timeout(12000),
    });
  } catch (cause) {
    throw new AppError(502, 'Could not reach the payment gateway. Please try again.', 'GATEWAY_UNREACHABLE', { cause });
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.id) {
    throw new AppError(502, 'The payment gateway rejected this order. Please try again.', 'GATEWAY_REJECTED', { cause: new Error(data?.error?.description || `razorpay ${response.status}`) });
  }
  return { id: data.id, amount: data.amount, currency: data.currency };
}
