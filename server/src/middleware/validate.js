import { z } from 'zod';
import { hasCloze } from '../../../shared/cloze.js';
import { PLAN_IDS } from '../../../shared/account.js';
import { TEAM_PLAN_IDS, SEATS } from '../../../shared/teams.js';
import { BRAND } from '../../../shared/brand.js';
import { COUNTRY_NAMES, PHONE_PATTERN } from '../../../shared/countries.js';
export const idSchema = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid identifier');
export const usernameSchema = z.string().trim().toLowerCase().regex(/^[a-z0-9_]{3,24}$/, 'Use 3–24 letters, numbers, or underscores');
/**
 * Names that would let a stranger pass for staff, for the product itself, or for the seeded demo
 * account. Enforced at signup only, so the people and scripts that already hold one stay reachable
 * by username everywhere else.
 */
const RESERVED = new Set(['admin', 'administrator', 'superadmin', 'sysadmin', 'root', 'system', 'staff', 'moderator', 'support', 'help', 'helpdesk', 'security', 'abuse', 'billing', 'payments', 'noreply', 'no_reply', 'official', 'team', 'demo', 'demolearner', BRAND.slug]);
export const reservedUsername = name => RESERVED.has(String(name).trim().toLowerCase());
// The country is asked for here because it decides what this account is charged, and asking at
// checkout instead would put the answer in the hands of whoever wants the cheaper price.
export const signupSchema = z.object({ username: usernameSchema.refine(v => !RESERVED.has(v), 'That username is reserved. Please pick another.'), name: z.string().trim().min(1).max(60), email: z.email().toLowerCase(), country: z.enum(COUNTRY_NAMES, 'Choose your country from the list.'), password: z.string().min(10).max(128),
  // Refused rather than defaulted. Consent that the server supplies on the user's behalf is not
  // consent, and the timestamp it produces would be evidence of nothing.
  acceptedTerms: z.literal(true, 'Please accept the terms and the privacy policy to continue.') });
export const passwordChangeSchema = z.object({ currentPassword: z.string().min(1).max(128), newPassword: z.string().min(10).max(128) });
export const deleteAccountSchema = z.object({ password: z.string().min(1).max(128), confirm: z.literal('delete my account') });
export const verifyEmailSchema = z.object({ token: z.string().regex(/^[a-f\d]{64}$/i, 'That confirmation link is not valid.') });
export const forgotPasswordSchema = z.object({ email: z.email().toLowerCase() });
export const resetPasswordSchema = z.object({ token: z.string().regex(/^[a-f\d]{64}$/i, 'That reset link is not valid.'), newPassword: z.string().min(10).max(128) });
export const folderSchema = z.object({ title: z.string().trim().min(1).max(80), description: z.string().max(500).default(''), color: z.enum(['violet', 'blue', 'orange', 'green', 'pink', 'slate']).default('violet'), icon: z.enum(['layers', 'code', 'globe', 'brain', 'book', 'flask', 'terminal', 'palette']).default('layers'), visibility: z.enum(['private', 'global']).default('private'), thumbnail: idSchema.nullable().optional() });
export const projectSchema = z.object({ title: z.string().trim().min(1).max(80), description: z.string().max(500).default(''), visibility: z.enum(['private', 'global']).default('private') });
/**
 * The billing fields are shared, because seats and a personal plan are bought through one pipeline.
 * There is no email here on purpose: the receipt has to go to the confirmed address on the account,
 * which the server already knows, so asking for it again would only invite a typo.
 */
const billing = z.object({
  method: z.literal('razorpay').optional(),
  name: z.string().trim().min(1).max(80),
  phone: z.string().trim().regex(PHONE_PATTERN, 'Enter a phone number we could actually reach you on.'),
  country: z.enum(COUNTRY_NAMES, 'Choose your country from the list.'),
  address: z.string().trim().min(6).max(300),
});
export const premiumOrderSchema = billing.extend({ plan: z.enum(PLAN_IDS) });
const seats = z.coerce.number().int().min(SEATS.min).max(SEATS.max);
export const seatQuoteSchema = z.object({ plan: z.enum(TEAM_PLAN_IDS), seats });
export const teamOrderSchema = billing.extend({ plan: z.enum(TEAM_PLAN_IDS), seats });
export const teamSchema = z.object({ name: z.string().trim().min(2).max(60), kind: z.enum(['classroom', 'team']).default('classroom'), description: z.string().max(300).default('') });
export const teamInviteSchema = z.object({ role: z.enum(['teacher', 'student']).default('student'), maxUses: z.number().int().min(0).max(500).default(0), expiresInDays: z.number().int().min(1).max(90).optional() });
export const joinCodeSchema = z.object({ code: z.string().trim().min(6).max(16) });
export const assignmentSchema = z.object({ folderId: idSchema, title: z.string().trim().max(80).default(''), instructions: z.string().max(500).default(''), dueAt: z.iso.datetime().nullish() });
const side = z.object({ text: z.string().max(10000).default(''), image: idSchema.nullable().optional() });
const filled = v => v.text.trim() || v.image;
// A cloze card ({{c1::…}} on the front) needs no back: the hidden text is the answer.
export const cardSchema = z.object({ front: side.refine(filled, 'Add text or an image to the front'), back: side, tags: z.array(z.string().trim().toLowerCase().min(1).max(30)).max(10).default([]).transform(v => [...new Set(v)]), hint: z.string().max(1000).default(''), source: z.union([z.literal(''), z.url().refine(v => /^https?:\/\//.test(v), 'Use an http or https URL')]).default('') })
  .refine(v => filled(v.back) || hasCloze(v.front.text), { path: ['back'], message: 'Add text or an image to the back, or use a cloze deletion like {{c1::answer}} on the front' });
/**
 * A notice about published content. Open to signed-out visitors, because public folders are
 * readable without an account and the person who spots a problem may not have one — so the shape
 * has to stand on its own without a session behind it.
 */
export const reportSchema = z.object({
  reason: z.enum(['illegal', 'infringement', 'privacy', 'harmful', 'spam', 'other'], 'Choose what is wrong with it.'),
  detail: z.string().trim().max(1000).optional().default(''),
  // Optional, and only used to tell the reporter what was decided.
  email: z.union([z.email(), z.literal('')]).optional().default(''),
});

export const reportDecisionSchema = z.object({
  status: z.enum(['upheld', 'rejected']),
  outcome: z.string().trim().max(500).optional().default(''),
});

/**
 * A Google sign-in. The credential is the signed token from Google; the other two are only present
 * when the click came from the signup form, and are what let a new account be created.
 */
export const googleSignInSchema = z.object({
  credential: z.string().min(20).max(8192),
  country: z.enum(COUNTRY_NAMES).optional(),
  acceptedTerms: z.boolean().optional(),
});

export const validate = schema => (req, _res, next) => { try { req.body = schema.parse(req.body); next(); } catch (e) { next(e); } };
