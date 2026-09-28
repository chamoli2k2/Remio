import crypto from 'node:crypto';
import { User } from '../../models/index.js';
import { assert } from '../../utils/errors.js';
import { reservedUsername } from '../../middleware/validate.js';
import { setting } from '../settingsService.js';
import { BRAND } from '../../../../shared/brand.js';
import { logger } from '../../utils/logger.js';
import * as google from './googleToken.js';

/**
 * A username derived from the address, since Google does not supply one.
 *
 * The local part of an email is close to what most people would have chosen anyway, so it is
 * cleaned up to the rules the signup form enforces and then made unique. Collisions are resolved
 * with a short random suffix rather than a counter: counting means a query per attempt and tells
 * the next person how many `alex`es there already are.
 */
async function freeUsername(email) {
  const base = email.split('@')[0].toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 18) || 'learner';
  const seed = base.length >= 3 ? base : `${base}learner`.slice(0, 18);
  for (const candidate of [seed, ...Array.from({ length: 6 }, () => `${seed}_${crypto.randomBytes(2).toString('hex')}`)]) {
    if (reservedUsername(candidate)) continue;
    if (!(await User.findOne({ username: candidate }).select('_id').lean())) return candidate;
  }
  // Six collisions on a random suffix is not bad luck, so stop guessing and use something that
  // cannot collide rather than looping forever.
  return `learner_${crypto.randomBytes(5).toString('hex')}`;
}

/**
 * Signs somebody in with Google, creating or linking the account as needed.
 *
 * Three cases, in this order:
 *
 *  1. We have seen this Google account before — sign in, nothing else to decide.
 *  2. An account already exists with the same address — link them, but only because Google has
 *     confirmed the address belongs to them. Without that check, anyone able to mint a token for
 *     an unverified address could take over the matching account here.
 *  3. Nobody is here yet — create an account, which needs the two things Google cannot tell us:
 *     which country they are in, because that decides what they would be charged, and whether
 *     they accept the terms. Neither is invented on their behalf, so a first sign-in from the
 *     login page is turned away with `GOOGLE_NEEDS_SIGNUP` rather than quietly guessing.
 */
export async function signInWithGoogle({ credential, country = '', acceptedTerms = false }) {
  const profile = await google.verify(credential);

  const existing = await User.findOne({ googleId: profile.googleId });
  if (existing) return { user: existing, created: false };

  const sameEmail = await User.findOne({ email: profile.email });
  if (sameEmail) {
    assert(profile.emailVerified, 400,
      'Google has not confirmed that email address, so we cannot connect it to an existing account. Sign in with your password instead.',
      'GOOGLE_EMAIL_UNVERIFIED');
    sameEmail.googleId = profile.googleId;
    // Google has just confirmed the address, so a pending verification here is settled. This is
    // the difference between buying Premium today and waiting for an email to arrive.
    if (!sameEmail.emailVerifiedAt) sameEmail.emailVerifiedAt = new Date();
    await sameEmail.save();
    logger.info('linked a Google account to an existing user', { userId: sameEmail.id });
    return { user: sameEmail, created: false, linked: true };
  }

  assert(setting('signup.open'), 503, 'New accounts are paused for the moment. Please try again later.', 'SIGNUP_CLOSED');
  // The client sends these alongside the credential from the signup form, where the country picker
  // and the consent checkbox are already on screen. From the sign-in form they are absent, which
  // is exactly the case this code distinguishes.
  assert(country && acceptedTerms === true, 400,
    'Almost there — we need your country and your agreement to the terms to finish creating the account.',
    'GOOGLE_NEEDS_SIGNUP');

  const user = await User.create({
    username: await freeUsername(profile.email),
    email: profile.email,
    name: profile.name || profile.email.split('@')[0],
    country,
    googleId: profile.googleId,
    // No password at all rather than a random one nobody knows: "set a password" is then an honest
    // offer instead of a reset of something that never existed.
    emailVerifiedAt: profile.emailVerified ? new Date() : null,
    termsAcceptedAt: new Date(),
    termsVersion: BRAND.policyUpdated,
  });
  logger.info('created an account from a Google sign-in', { userId: user.id });
  return { user, created: true };
}
