import { z } from 'zod';
import { hasCloze } from '../../../shared/cloze.js';
import { PLAN_IDS } from '../../../shared/account.js';
import { TEAM_PLAN_IDS, SEATS } from '../../../shared/teams.js';
import { BRAND } from '../../../shared/brand.js';
import { COUNTRY_NAMES, PHONE_PATTERN } from '../../../shared/countries.js';
import { SCOPE_IDS } from '../../../shared/agent.js';
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
// Shared with the assistant's card schema below, which no longer pipes through this one and so
// would otherwise quietly stop deduplicating tags.
const tagList = z.array(z.string().trim().toLowerCase().min(1).max(30)).max(10).default([]).transform(v => [...new Set(v)]);
export const cardSchema = z.object({ front: side.refine(filled, 'Add text or an image to the front'), back: side, tags: tagList, hint: z.string().max(1000).default(''), source: z.union([z.literal(''), z.url().refine(v => /^https?:\/\//.test(v), 'Use an http or https URL')]).default('') })
  .refine(v => filled(v.back) || hasCloze(v.front.text), { path: ['back'], message: 'Add text or an image to the back, or use a cloze deletion like {{c1::answer}} on the front' });
/**
 * A card as an assistant writes one.
 *
 * Flat strings rather than the nested `{ text, image }` the API uses, because a language model
 * producing JSON gets a flat shape right and a nested one wrong often enough to matter, and the
 * cost of translating is four lines here against a retry loop in every conversation.
 *
 * Images are named by URL, never by media id. An assistant has no way to learn the id of an
 * existing image and must not be able to guess at one: ids are the only thing standing between a
 * card and a picture from a collection the user cannot see. A URL, by contrast, is something the
 * model genuinely has — it is the one form of image a language model can pass along, since it can
 * look at a picture but cannot reproduce its bytes. What arrives here is only the address; the
 * fetching, checking and storing all happen in `agent/tools.js`.
 *
 * `source` is swept rather than rejected. Models habitually put "Chapter 4, page 112" in a field
 * named source, and the honest options are to throw away one useful metadata string or to fail
 * forty good cards over it. It is documented to the model as needing a URL, and quietly dropped
 * when it is not one.
 */
const agentSource = z.string().trim().max(2000).default('').transform(v => (/^https?:\/\/\S+$/i.test(v) ? v : ''));
export const agentImageUrl = z.union([
  z.literal(''),
  z.url().max(2000).refine(v => /^https:\/\//i.test(v), 'Image URLs have to start with https'),
]).default('');
/**
 * The two "is this card actually a card" rules, restated here because an image changes the
 * answer and at this point the images are addresses rather than ids.
 *
 * The result is not piped into `cardSchema`, as the other agent schemas are. It cannot be: a card
 * whose only front content is a URL is not yet a valid card and only becomes one once that URL
 * has been fetched and turned into a media id. `addCards` runs `cardSchema` over the finished
 * shape instead, so the guarantee is unchanged — an assistant still cannot reach a card the app
 * itself would refuse — it is just enforced one step later, where the card is complete.
 */
export const agentCardSchema = z.object({
  front: z.string().max(10000).default(''),
  back: z.string().max(10000).default(''),
  hint: z.string().max(1000).default(''),
  tags: tagList,
  source: agentSource,
  frontImage: agentImageUrl,
  backImage: agentImageUrl,
})
  .refine(c => c.front.trim() || c.frontImage, { path: ['front'], message: 'Add text or an image to the front' })
  .refine(c => c.back.trim() || c.backImage || hasCloze(c.front), { path: ['back'], message: 'Add text or an image to the back, or use a cloze deletion like {{c1::answer}} on the front' })
  .transform(c => ({
    card: { front: { text: c.front }, back: { text: c.back }, hint: c.hint, tags: c.tags, source: c.source },
    images: { front: c.frontImage, back: c.backImage },
  }));

/** What an assistant may set when it creates a collection. Visibility is absent on purpose — see agent/tools.js. */
export const agentCollectionSchema = folderSchema.pick({ title: true, description: true, color: true, icon: true });

/**
 * Minting a token by hand, for a client that cannot do the approval flow.
 *
 * The scope list is required rather than defaulted, because this is the one path where the person
 * is choosing permissions on a form rather than reading them off a consent screen, and a set of
 * permissions the server picked is not a choice.
 */
export const agentGrantSchema = z.object({
  name: z.string().trim().min(1).max(60),
  scopes: z.array(z.enum(SCOPE_IDS)).min(1, 'Choose at least one permission.'),
});

/**
 * An authorization request as it arrives back from our own consent screen.
 *
 * Passthrough-free and bounded, but deliberately not the place the request is judged: every field
 * here is checked again against the registered client in the OAuth service, because this schema
 * only knows that the strings are strings.
 */
export const agentConsentSchema = z.object({
  client_id: z.string().min(1).max(64),
  redirect_uri: z.string().min(1).max(2000),
  response_type: z.string().max(40),
  code_challenge: z.string().min(43).max(128),
  code_challenge_method: z.string().max(10),
  scope: z.string().max(500).optional().default(''),
  state: z.string().max(2000).optional().default(''),
  resource: z.string().max(2000).optional().default(''),
  approve: z.boolean(),
});

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

/** The username, typed back, plus an optional reason that lands in the audit trail. */
export const deleteUserSchema = z.object({
  confirm: z.string().trim().min(1).max(24),
  note: z.string().trim().max(200).optional().default(''),
});

export const validate = schema => (req, _res, next) => { try { req.body = schema.parse(req.body); next(); } catch (e) { next(e); } };
