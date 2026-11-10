import crypto from 'node:crypto';
import { EmailCode } from '../models/index.js';
import { assert } from '../utils/errors.js';
import { hashToken } from '../utils/hash.js';
import { send, signupCodeEmail, deleteCodeEmail } from './mailService.js';

/**
 * Six-digit codes that prove somebody can read a mailbox, used where a link would be clumsy: making
 * an account, and deleting one. A code is short, so the guard is everywhere else: it lives ten
 * minutes, it is spent on first use, five wrong guesses burn it, and a person may be sent only so
 * many of them an hour.
 */
const TTL_MS = 10 * 60 * 1000;
const GAP_MS = 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const MAX_SENDS_PER_HOUR = 5;
const MAX_ATTEMPTS = 5;

/**
 * Whether signing up and deleting from Settings ask for a code. Always, except that the test scripts
 * set EMAIL_CODES=off: they sign up hundreds of accounts with no mailbox behind them. Production
 * ignores that switch, so it cannot be left on by accident.
 */
export const codesRequired = () => process.env.NODE_ENV === 'production' || process.env.EMAIL_CODES !== 'off';

const digest = (email, purpose, code) => hashToken(`${purpose}:${email}:${code}`);

/** Mails a fresh code. Returns what happened rather than throwing, so a caller can choose how much to say. */
export async function issueCode(email, purpose, { name = '', userId = null } = {}) {
  email = String(email).toLowerCase().trim();
  const now = Date.now();
  const existing = await EmailCode.findOne({ email, purpose });
  if (existing && now - existing.sentAt.getTime() < GAP_MS) return { sent: false, reason: 'too-soon' };
  const inWindow = existing && now - existing.windowStart.getTime() < HOUR_MS;
  if (inWindow && existing.sends >= MAX_SENDS_PER_HOUR) return { sent: false, reason: 'limit' };

  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  await EmailCode.findOneAndUpdate({ email, purpose }, { $set: {
    codeHash: digest(email, purpose, code), attempts: 0, sentAt: new Date(now), user: userId,
    windowStart: inWindow ? existing.windowStart : new Date(now), sends: inWindow ? existing.sends + 1 : 1,
    expiresAt: new Date(now + TTL_MS),
  } }, { upsert: true });

  const template = purpose === 'signup' ? signupCodeEmail : deleteCodeEmail;
  const mailed = await send({ to: email, ...template({ name, code }) });
  // With no mail server configured, a local developer would otherwise never see the code.
  if (!mailed && !process.env.SMTP_HOST && process.env.NODE_ENV !== 'production') console.info(`[dev] ${purpose} code for ${email}: ${code}`);
  // Where no mail server is configured outside production, the console above is the mailbox.
  const devMailbox = !mailed && !process.env.SMTP_HOST && process.env.NODE_ENV !== 'production';
  if (!mailed && !devMailbox) {
    // Nothing reached the person, so this attempt must not cost them the wait or one of their hourly sends.
    if (existing) await EmailCode.updateOne({ email, purpose }, { $set: { codeHash: existing.codeHash, attempts: existing.attempts, sentAt: existing.sentAt, user: existing.user, windowStart: existing.windowStart, sends: existing.sends, expiresAt: existing.expiresAt } });
    else await EmailCode.deleteOne({ email, purpose });
  }
  return { sent: mailed || devMailbox, reason: mailed || devMailbox ? 'sent' : 'mail-unavailable', retryAfter: GAP_MS / 1000 };
}

/** Turns an `issueCode` result into the sentence a person should read, or lets a success through. */
export function assertSent({ sent, reason }) {
  assert(reason !== 'too-soon', 429, 'A code was just sent to that address. Check your inbox and spam folder, or wait a minute and ask again.', 'CODE_TOO_SOON');
  assert(reason !== 'limit', 429, 'That is enough codes for now. Try again in an hour.', 'CODE_LIMIT');
  assert(sent, 503, 'We could not send the email just now. Please try again in a moment.', 'MAIL_UNAVAILABLE');
}

/**
 * Checks a code without spending it, counting the try either way. Spending is left to the caller,
 * which does it only once the thing the code was for has actually happened, so a mistake elsewhere on
 * the form does not cost the person their code.
 */
export async function checkCode(email, purpose, code) {
  email = String(email).toLowerCase().trim();
  assert(/^\d{6}$/.test(String(code || '')), 400, 'Enter the 6-digit code from your email.', 'CODE_INVALID');
  const row = await EmailCode.findOne({ email, purpose });
  assert(row && row.expiresAt > new Date(), 400, 'That code has expired or was never sent. Ask for a new one.', 'CODE_EXPIRED');
  const tried = await EmailCode.findOneAndUpdate({ _id: row._id, attempts: { $lt: MAX_ATTEMPTS } }, { $inc: { attempts: 1 } }, { new: true });
  assert(tried, 429, 'Too many wrong codes. Ask for a new one.', 'CODE_LOCKED');
  const a = Buffer.from(digest(email, purpose, code)), b = Buffer.from(row.codeHash);
  assert(a.length === b.length && crypto.timingSafeEqual(a, b), 400, 'That code is not right. Check the email and try again.', 'CODE_INVALID');
  return row;
}

/** A code is good once. */
export const spendCode = row => EmailCode.deleteOne({ _id: row._id });
