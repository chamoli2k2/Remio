import nodemailer from 'nodemailer';
import { BRAND } from '../../../shared/brand.js';

/**
 * Outbound email. With no SMTP_HOST configured the transport is a no-op that logs the message
 * instead, so local development and the test suite never need a mail server and a missing
 * credential can't take signup down with it.
 *
 * For Gmail set SMTP_HOST=smtp.gmail.com, SMTP_PORT=465, SMTP_USER to the address, and SMTP_PASS to
 * an app password, not the account password.
 */
let transport;
const configured = () => !!process.env.SMTP_HOST;

function getTransport() {
  if (!configured()) return null;
  transport ||= nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: Number(process.env.SMTP_PORT || 587) === 465,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  });
  return transport;
}

/** Said once at startup: without these, every signup code and deletion code silently goes nowhere. */
export function configWarnings() {
  if (process.env.NODE_ENV !== 'production') return [];
  if (!process.env.SMTP_HOST) return ['SMTP_HOST is not set, so email codes for signup and account deletion cannot be sent. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS and MAIL_FROM in the server .env.'];
  if (process.env.SMTP_USER && !process.env.SMTP_PASS) return ['SMTP_USER is set without SMTP_PASS, so email will be refused.'];
  return [];
}

/** Exported for tests, which swap in a recorder rather than opening a socket. */
export const _setTransport = t => { transport = t; };

/**
 * Never throws. A verification email that fails to send must not fail the signup that triggered it,
 * so the caller always gets a boolean and the address is left unverified to be retried.
 */
export async function send({ to, subject, text, html }) {
  const mailer = getTransport();
  if (!mailer) {
    console.info(`[${BRAND.slug}] mail not configured, would have sent "${subject}" to ${to}`);
    return false;
  }
  try {
    await mailer.sendMail({ from: process.env.MAIL_FROM || BRAND.mailFrom, to, subject, text, html });
    return true;
  } catch (error) {
    console.error(`[${BRAND.slug}] mail to ${to} failed`, error.message);
    return false;
  }
}

/** Wraps body copy in the one layout every message uses. Plain text is built from the same pieces. */
const layout = (heading, lines, button) => `
<div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;color:#272235">
  <p style="font-size:22px;font-weight:700;margin:0 0 24px">${BRAND.name}<span style="color:#6348dc">.</span></p>
  <h1 style="font-size:20px;margin:0 0 12px">${heading}</h1>
  ${lines.map(l => `<p style="line-height:1.6;color:#57506a;margin:0 0 12px">${l}</p>`).join('')}
  ${button ? `<p style="margin:24px 0"><a href="${button.href}" style="background:#6348dc;color:#fff;text-decoration:none;padding:12px 20px;border-radius:9px;display:inline-block;font-weight:600">${button.label}</a></p>
  <p style="color:#877e96;font-size:13px;line-height:1.6;margin:0">If the button does not work, paste this into your browser:<br><span style="color:#6348dc;word-break:break-all">${button.href}</span></p>` : ''}
  <p style="color:#877e96;font-size:13px;margin:28px 0 0">${BRAND.tagline}</p>
</div>`;

export function verificationEmail({ name, url }) {
  const lines = [
    `Hello ${name}, please confirm this address so we can reach you about your account.`,
    'The link is good for 24 hours and can only be used once.',
  ];
  return {
    subject: `Confirm your email for ${BRAND.name}`,
    text: `${lines.join('\n\n')}\n\n${url}\n\nIf you did not create an account, you can ignore this.`,
    html: layout('Confirm your email', lines, { href: url, label: 'Confirm my email' }),
  };
}

/** A code is the whole message, so it is set large and the body says what it is for and how long it lasts. */
const codeBlock = code => `<span style="display:inline-block;font-size:32px;letter-spacing:8px;font-weight:700;color:#272235;background:#f5f3fa;border-radius:10px;padding:12px 18px">${code}</span>`;

export function signupCodeEmail({ code }) {
  const lines = [`Use this code to confirm your email and finish creating your ${BRAND.name} account.`, codeBlock(code), 'It is good for 10 minutes and works once.'];
  return {
    subject: `${code} is your ${BRAND.name} sign-up code`,
    text: `Use this code to confirm your email and finish creating your ${BRAND.name} account:\n\n${code}\n\nIt is good for 10 minutes and works once. If you did not ask for it, you can ignore this message.`,
    html: layout('Confirm your email', lines),
  };
}

export function deleteCodeEmail({ name, code }) {
  const lines = [`${name ? `Hello ${name}, s` : 'S'}omebody asked to delete the ${BRAND.name} account for this address. Enter this code to confirm it was you.`, codeBlock(code), 'It is good for 10 minutes and works once. Deleting an account erases it for good.', 'If this was not you, ignore this email and nothing will be deleted.'];
  return {
    subject: `${code} is your ${BRAND.name} account deletion code`,
    text: `Somebody asked to delete the ${BRAND.name} account for this address. Enter this code to confirm it was you:\n\n${code}\n\nIt is good for 10 minutes and works once. Deleting an account erases it for good. If this was not you, ignore this email and nothing will be deleted.`,
    html: layout('Confirm account deletion', lines),
  };
}

export function passwordResetEmail({ name, url }) {
  const lines = [
    `Hello ${name}, somebody asked to reset the password on your ${BRAND.name} account. Use the link below to choose a new one.`,
    'The link is good for one hour and can only be used once. Until you use it, your current password keeps working.',
  ];
  return {
    subject: `Reset your ${BRAND.name} password`,
    text: `${lines.join('\n\n')}\n\n${url}\n\nIf you did not ask for this, you can ignore this message and nothing will change.`,
    html: layout('Choose a new password', lines, { href: url, label: 'Choose a new password' }),
  };
}

export function passwordChangedEmail({ name }) {
  const lines = [
    `Hello ${name}, the password on your ${BRAND.name} account was just changed, and every other signed-in device was signed out.`,
    `If this was not you, reply to this message straight away and we will help you lock the account down.`,
  ];
  return {
    subject: `Your ${BRAND.name} password was changed`,
    text: lines.join('\n\n'),
    html: layout('Your password was changed', lines),
  };
}

export function accountDeletedEmail({ name }) {
  const lines = [
    `Hello ${name}, your ${BRAND.name} account and everything in it has now been deleted, as you asked.`,
    'Your collections, cards, and study history are gone from our database. Payment records are kept with your personal details stripped out, because we are required to hold proof of the transaction.',
    'Thank you for giving it a go. You are welcome back whenever you like.',
  ];
  return {
    subject: `Your ${BRAND.name} account has been deleted`,
    text: lines.join('\n\n'),
    html: layout('Your account has been deleted', lines),
  };
}
