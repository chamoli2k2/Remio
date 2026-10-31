import { z } from 'zod';
import { hasCloze } from '../../../shared/cloze.js';
import { PLAN_IDS } from '../../../shared/account.js';
import { TEAM_PLAN_IDS, SEATS } from '../../../shared/teams.js';
import { BRAND } from '../../../shared/brand.js';
import { COUNTRY_NAMES, PHONE_PATTERN } from '../../../shared/countries.js';
import { SCOPE_IDS } from '../../../shared/agent.js';
import { DETAIL, FORMAT, EXTRAS, AUDIENCE, CUSTOM_GUIDANCE_MAX, cleanGuidance } from '../../../shared/answerStyle.js';
import { MODE_IDS } from '../../../shared/game.js';
import { DRAWING_ID, DRAWING_VERSION, PAGE, MAX_HEIGHT, PAPERS, THEMES, TOOLS, SIZE, LIMITS, HEX, SHAPES, OBJECT_ID, STROKE_WIDTH, FONT_SIZE, MIN_BOX } from '../../../shared/drawing.js';
import { NOTE_LIMITS } from '../../../shared/notes.js';
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
// A blank username is a request to have one picked, which is what a Google signup gets anyway.
export const signupSchema = z.object({ username: z.preprocess(v => (v === '' || v === null ? undefined : v), usernameSchema.refine(v => !RESERVED.has(v), 'That username is reserved. Please pick another.').optional()), name: z.string().trim().min(1).max(60), email: z.email().toLowerCase(), country: z.enum(COUNTRY_NAMES, 'Choose your country from the list.'), password: z.string().min(10).max(128),
  // Refused rather than defaulted. Consent that the server supplies on the user's behalf is not
  // consent, and the timestamp it produces would be evidence of nothing.
  acceptedTerms: z.literal(true, 'Please accept the terms and the privacy policy to continue.') });
// The current password is optional only so an account that has never had one can set its first;
// the service refuses to skip it for anyone who does have one.
export const passwordChangeSchema = z.object({ currentPassword: z.string().min(1).max(128).optional(), newPassword: z.string().min(10).max(128) });
export const deleteAccountSchema = z.object({ password: z.string().min(1).max(128), confirm: z.literal('delete my account') });
export const verifyEmailSchema = z.object({ token: z.string().regex(/^[a-f\d]{64}$/i, 'That confirmation link is not valid.') });
// A browser sends nothing and relies on the cookie; a native app sends the token it was given.
export const refreshSchema = z.object({ refreshToken: z.string().regex(/^[a-f\d]{64}$/i).optional() }).default({});
export const forgotPasswordSchema = z.object({ email: z.email().toLowerCase() });
export const resetPasswordSchema = z.object({ token: z.string().regex(/^[a-f\d]{64}$/i, 'That reset link is not valid.'), newPassword: z.string().min(10).max(128) });
export const folderSchema = z.object({ title: z.string().trim().min(1).max(80), description: z.string().max(500).default(''), color: z.enum(['violet', 'blue', 'orange', 'green', 'pink', 'slate']).default('violet'), icon: z.enum(['layers', 'code', 'globe', 'brain', 'book', 'flask', 'terminal', 'palette']).default('layers'), visibility: z.enum(['private', 'global']).default('private'), thumbnail: idSchema.nullable().optional() });
/** The title as stored, typed back. The service re-checks it against the live name. */
export const folderDeleteSchema = z.object({ confirm: z.string().min(1).max(80) });
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
export const drawingIdSchema = z.string().regex(DRAWING_ID, 'Invalid drawing');
const side = z.object({ text: z.string().max(10000).default(''), image: idSchema.nullable().optional(), drawing: drawingIdSchema.nullable().optional() });
const filled = v => v.text.trim() || v.image || v.drawing;

/**
 * A drawing as the editor saves it. Numbers, hex colours, a closed set of words, and the text of
 * labels. That text is the one free-form string in the document: it is only ever drawn onto a
 * canvas by the editor and the viewer and never inserted into a page as markup, it is capped in
 * length, and control characters other than a line break are refused.
 */
const coordinate = z.number().finite().min(-50).max(Math.max(PAGE.width, MAX_HEIGHT) + 50).transform(Math.round);
const strokeSchema = z.object({
  t: z.enum(TOOLS),
  c: z.string().regex(HEX, 'Invalid colour'),
  s: z.number().finite().min(SIZE.min).max(SIZE.max),
  p: z.array(coordinate).min(2).max(LIMITS.pointsPerStroke * 2).refine(p => p.length % 2 === 0, 'Points come in pairs'),
}).strict();
const extent = z.number().finite().min(-Math.max(PAGE.width, MAX_HEIGHT)).max(Math.max(PAGE.width, MAX_HEIGHT)).transform(Math.round);
const size = z.number().finite().min(0).max(Math.max(PAGE.width, MAX_HEIGHT)).transform(Math.round);
const objectBase = { id: z.string().regex(OBJECT_ID, 'Invalid object id'), x: coordinate, y: coordinate, c: z.string().regex(HEX, 'Invalid colour') };
const shapeSchema = z.object({
  ...objectBase,
  t: z.enum(SHAPES),
  w: extent, h: extent,
  s: z.number().finite().min(STROKE_WIDTH.min).max(STROKE_WIDTH.max).transform(Math.round),
  f: z.boolean().optional(),
}).strict();
const textSchema = z.object({
  ...objectBase,
  t: z.literal('text'),
  w: size.refine(v => v >= MIN_BOX && v <= PAGE.width, 'Text box width out of range'), h: size,
  fs: z.number().finite().min(FONT_SIZE.min).max(FONT_SIZE.max).transform(Math.round),
  text: z.string().min(1).max(LIMITS.textLength).refine(v => !/[\u0000-\u0008\u000b-\u001f\u007f]/.test(v), 'Text contains control characters'),
}).strict();
const objectSchema = z.discriminatedUnion('t', [...SHAPES.map(t => shapeSchema.extend({ t: z.literal(t) })), textSchema]);
export const drawingSchema = z.object({
  v: z.literal(DRAWING_VERSION),
  w: z.literal(PAGE.width),
  h: z.number().int().min(PAGE.height).max(MAX_HEIGHT).refine(h => h % PAGE.height === 0, 'A drawing is a whole number of pages'),
  paper: z.enum(PAPERS),
  theme: z.enum(THEMES),
  strokes: z.array(strokeSchema).max(LIMITS.strokes),
  objects: z.array(objectSchema).max(LIMITS.objects, `A drawing can hold up to ${LIMITS.objects} shapes and text boxes.`).default([]),
}).strict().refine(d => d.strokes.reduce((n, s) => n + s.p.length / 2, 0) <= LIMITS.points, 'This drawing is too detailed to save. Try clearing part of it.')
  .refine(d => d.objects.reduce((n, o) => n + (o.text?.length || 0), 0) <= LIMITS.textTotal, 'There is too much text in this drawing. Move some of it to the page.')
  .refine(d => new Set(d.objects.map(o => o.id)).size === d.objects.length, 'Objects must have different ids')
  .refine(d => d.strokes.some(s => s.t !== 'eraser') || d.objects.length > 0, 'Draw something before saving.');
// A cloze card ({{c1::…}} on the front) needs no back: the hidden text is the answer.
// Shared with the assistant's card schema below, which no longer pipes through this one and so
// would otherwise quietly stop deduplicating tags.
const tagList = z.array(z.string().trim().toLowerCase().min(1).max(30)).max(10).default([]).transform(v => [...new Set(v)]);
export const notebookSchema = z.object({ title: z.string().trim().min(1).max(80), description: z.string().max(500).default(''), color: z.enum(['violet', 'blue', 'orange', 'green', 'pink', 'slate']).default('violet'), icon: z.enum(['layers', 'code', 'globe', 'brain', 'book', 'flask', 'terminal', 'palette']).default('book') });
export const noteCollectionSchema = notebookSchema.extend({ icon: notebookSchema.shape.icon.removeDefault().default('layers') });
export const noteSchema = z.object({ title: z.string().trim().max(NOTE_LIMITS.title).default(''), body: z.string().max(NOTE_LIMITS.body, `A page can hold up to ${NOTE_LIMITS.body.toLocaleString('en')} characters. Split it into two pages.`).default(''), tags: z.array(z.string().trim().toLowerCase().min(1).max(30)).max(NOTE_LIMITS.tags).default([]).transform(v => [...new Set(v)]), pinned: z.boolean().default(false) }).strict();
// A save sends only what changed, so nothing here has a default that would quietly overwrite a field.
export const notePatchSchema = z.object({ title: z.string().trim().max(NOTE_LIMITS.title).optional(), body: z.string().max(NOTE_LIMITS.body, `A page can hold up to ${NOTE_LIMITS.body.toLocaleString('en')} characters. Split it into two pages.`).optional(), tags: z.array(z.string().trim().toLowerCase().min(1).max(30)).max(NOTE_LIMITS.tags).transform(v => [...new Set(v)]).optional(), pinned: z.boolean().optional(), version: z.number().int().min(0) }).strict();
export const cardSchema = z.object({ front: side.refine(filled, 'Add text, an image or a drawing to the front'), back: side, tags: tagList, hint: z.string().max(1000).default(''), source: z.union([z.literal(''), z.url().refine(v => /^https?:\/\//.test(v), 'Use an http or https URL')]).default('') })
  .refine(v => filled(v.back) || hasCloze(v.front.text), { path: ['back'], message: 'Add text, an image or a drawing to the back, or use a cloze deletion like {{c1::answer}} on the front' });
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
 * One card's changes, as an assistant sends them to `update_card`.
 *
 * Every field is optional and nothing is defaulted, because an absent field means "leave it as it
 * is" — a default here would quietly blank whatever the person had written. An image is an https
 * address to fetch, or an empty string to take the picture off. A source that is not a URL is
 * refused rather than swept, unlike on a new card, since sweeping it would erase the one already
 * there.
 */
const httpsImage = z.url().max(2000).refine(v => /^https:\/\//i.test(v), 'Image URLs have to start with https');
export const agentCardPatchSchema = z.object({
  front: z.string().max(10000).optional(),
  back: z.string().max(10000).optional(),
  hint: z.string().max(1000).optional(),
  tags: z.array(z.string().trim().toLowerCase().min(1).max(30)).max(10).transform(v => [...new Set(v)]).optional(),
  source: z.union([z.literal(''), z.url().max(2000).refine(v => /^https?:\/\//i.test(v), 'Use an http or https URL')]).optional(),
  frontImage: z.union([z.literal(''), httpsImage]).optional(),
  backImage: z.union([z.literal(''), httpsImage]).optional(),
}).refine(p => Object.values(p).some(v => v !== undefined), 'Send at least one field to change.');

/**
 * How someone likes their answers written. All optional, so a call can change one thing; unknown
 * keys are refused so a misspelt option is an error rather than a setting that silently did
 * nothing. The guidance is the person's own words and is cleaned to a single short line before it
 * is stored, because it will be read back to a model.
 */
const uniq = v => [...new Set(v)];
export const answerStyleSchema = z.object({
  detail: z.enum(Object.keys(DETAIL)).optional(),
  format: z.enum(Object.keys(FORMAT)).optional(),
  include: z.array(z.enum(Object.keys(EXTRAS))).max(Object.keys(EXTRAS).length).transform(uniq).optional(),
  audience: z.enum(Object.keys(AUDIENCE)).optional(),
  custom: z.string().max(CUSTOM_GUIDANCE_MAX, `Keep custom guidance under ${CUSTOM_GUIDANCE_MAX} characters.`).transform(cleanGuidance).optional(),
}).strict();

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
  // The permissions the person ticked. Absent means "what the application asked for".
  granted: z.array(z.enum(SCOPE_IDS)).min(1, 'Choose at least one permission.').max(SCOPE_IDS.length).optional(),
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

/**
 * One answered card. `mode`, `reply`, `localHour` and `board` only feed experience and badges; the
 * rating alone decides scheduling. The hour is the learner's own clock, since days and streaks are
 * UTC but "studying at midnight" means their midnight. `reply` is what was typed or said; it is
 * checked, never stored. `echo` marks a spoken answer said back after reading it, which by
 * definition was not remembered, so it can only be rated "again".
 */
const reviewItem = z.object({
  cardId: idSchema, rating: z.enum(['again', 'hard', 'good', 'easy']), requestId: z.uuid(), version: z.number().int().min(0),
  mode: z.enum(MODE_IDS).default('classic'),
  reply: z.string().max(4000).optional(),
  echo: z.boolean().optional(),
  localHour: z.number().int().min(0).max(23).optional(),
  board: z.object({ pairs: z.number().int().min(2).max(6), mistakes: z.number().int().min(0).max(100) }).optional(),
  // When the card was answered on the device. The server clamps it to the last week and never past
  // its own clock, and uses it only for scheduling, so a wrong clock cannot buy XP or a streak.
  reviewedAt: z.iso.datetime({ offset: true }).optional(),
}).refine(b => !b.echo || (b.mode === 'voice' && b.rating === 'again'), { message: 'Only a spoken answer rated "again" can be said back.', path: ['echo'] });
export const reviewSchema = reviewItem;
/** Reviews answered on the device and synced together, oldest first. */
export const reviewBatchSchema = z.object({ reviews: z.array(reviewItem).min(1).max(100) });

export const validate = schema => (req, _res, next) => { try { req.body = schema.parse(req.body); next(); } catch (e) { next(e); } };
