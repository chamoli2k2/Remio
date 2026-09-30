import { COUNTRIES, SELLING_COUNTRY_CODES } from './countries.js';
import { PREMIUM_PLANS } from './account.js';
import { TEAM_PLANS } from './teams.js';
import { DEFAULT_REGIONS } from './pricing.js';

/**
 * Every setting an operator can change without a deploy.
 *
 * One declaration per knob, and it is the only place any of them is described: the admin form is
 * generated from this, the API validates against it, and the server reads its effective value
 * through it. Adding a setting is adding an entry here and reading it where it matters.
 *
 * Two rules hold the whole thing together:
 *
 *  - `fallback` is the value the code used before it was configurable, taken from the module that
 *    used to own it rather than retyped. So an empty settings collection behaves exactly like the
 *    app did before any of this existed, and deleting an override is always safe.
 *  - Bounds are part of the declaration, not the form. A number typed into a browser is the least
 *    trustworthy input there is, and a rate limit of zero or a price of a hundredth of a rupee are
 *    both a bad afternoon.
 *
 * What is deliberately not here: anything secret. Gateway keys and SMTP passwords stay in the
 * environment, because a value that can be read back out of an admin page is a value that leaks
 * with the first borrowed session, and rotating one is a deploy anyway.
 */

/** Ordered, because the admin page renders them in this order and the first should be the useful one. */
export const SETTING_GROUPS = [
  { id: 'access', label: 'Access', blurb: 'Who can get in, and what is switched on for them.' },
  { id: 'selling', label: 'Selling', blurb: 'Where Premium is on sale and how it can be paid for.' },
  { id: 'pricing', label: 'Pricing', blurb: 'What each plan costs, in whole units of the region currency, tax included.' },
  { id: 'plans', label: 'Plan lengths', blurb: 'How many days each plan grants. Changing one affects future purchases, never a subscription already sold.' },
  { id: 'limits', label: 'Limits', blurb: 'Caps on what one account can upload, import, and hold.' },
  { id: 'throttle', label: 'Rate limits', blurb: 'How often an endpoint may be called before it starts refusing. Requests per window, per IP.' },
  { id: 'teams', label: 'Teams', blurb: 'Seat bounds and invite rules.' },
  { id: 'ads', label: 'Advertising', blurb: 'Whether ads are shown, to whom, and where. Never to anyone with Premium, and never inside a study session.' },
  { id: 'agent', label: 'AI assistants', blurb: 'Whether people may connect an assistant to their account to write cards for them, and how much it may write.' },
];

const bool = (group, label, fallback, help) => ({ group, type: 'boolean', label, fallback, help });
const count = (group, label, fallback, min, max, help, unit = '') => ({ group, type: 'number', label, fallback, min, max, help, unit, step: 1 });

/**
 * Prices are one setting per plan per region rather than one blob, so the audit trail can say which
 * price changed and by how much. Generated from the regions, so opening a market creates its rows.
 */
function priceSettings() {
  const out = {};
  for (const [id, region] of Object.entries(DEFAULT_REGIONS)) {
    const money = `in ${region.currency}`;
    for (const plan of PREMIUM_PLANS) {
      out[`price.${id}.${plan.id}`] = {
        group: 'pricing', type: 'number', min: 1, max: 1_000_000, step: 1, unit: region.symbol,
        label: `${region.label} · ${plan.label}`,
        help: `What ${plan.label.toLowerCase()} Premium costs ${money}, tax included.`,
        fallback: region.premium[plan.id],
      };
    }
    for (const plan of TEAM_PLANS) {
      out[`seat.${id}.${plan.id}`] = {
        group: 'pricing', type: 'number', min: 1, max: 1_000_000, step: 1, unit: region.symbol,
        label: `${region.label} · ${plan.label} seat`,
        help: `What one seat costs ${money} on the ${plan.label.toLowerCase()} team plan.`,
        fallback: region.perSeat[plan.id],
      };
    }
  }
  return out;
}

/** Plan lengths, generated the same way so a new plan cannot be forgotten here. */
function planSettings() {
  const out = {};
  for (const plan of [...PREMIUM_PLANS, ...TEAM_PLANS]) {
    out[`days.${plan.id}`] = count('plans', `${plan.label} runs for`, plan.days, 1, 3650,
      'Days of access one purchase of this plan grants.', 'days');
  }
  return out;
}

export const SETTINGS = {
  // ── Access ──────────────────────────────────────────────────────────────────────────────────
  'signup.open': bool('access', 'Signups open', true,
    'Off turns away new accounts with a notice. Everyone who already has one can still sign in.'),
  'signup.requireVerifiedEmailToStudy': bool('access', 'Require a verified email before studying', false,
    'Off lets someone start straight away and verify later. Paid checkout always requires it either way.'),
  'explore.public': bool('access', 'Public explore page', true,
    'Off hides the global library from people who are not signed in. Folders shared by link still open.'),
  'imports.enabled': bool('access', 'Deck imports', true,
    'A switch to pull if an import ever starts costing more in support than it is worth.'),
  'quiz.enabled': bool('access', 'Live quiz', true,
    'Off stops new rooms being hosted. Rooms already running are not closed.'),
  'maintenance.readOnly': bool('access', 'Read-only mode', false,
    'Everything can be read, nothing can be written. For a migration, or for buying yourself an hour.'),
  'maintenance.notice': { group: 'access', type: 'text', label: 'Banner message', fallback: '', maxLength: 240,
    help: 'Shown across the top of every page while it is set, to signed-in and signed-out visitors alike. Leave empty for no banner.' },
  'maintenance.noticeLink': { group: 'access', type: 'text', label: 'Banner link', fallback: '', maxLength: 200, link: true,
    help: 'Optional. Where the banner goes when clicked — a path like /pricing, or a full https:// address.' },
  'maintenance.noticeOffer': bool('access', 'Style the banner as an offer', false,
    'Draws it in the accent colour with a tag, for a sale or a launch. Left off it reads as a plain notice, which is what you want for planned downtime.'),

  // ── Selling ─────────────────────────────────────────────────────────────────────────────────
  'selling.countries': {
    group: 'selling', type: 'countries', label: 'Countries Premium is sold in', fallback: SELLING_COUNTRY_CODES,
    help: 'Anyone may register and study from anywhere. This is only about who can be charged, and each country has to belong to a priced region.',
    options: () => COUNTRIES.map(c => ({ value: c.code, label: c.name, region: c.region })),
  },
  'selling.razorpay': bool('selling', 'Card, UPI, and net banking', true,
    'The gateway checkout. Needs the Razorpay keys in the environment to work at all; this only hides it.'),

  // ── Advertising ─────────────────────────────────────────────────────────────────────────────
  'ads.enabled': bool('ads', 'Show ads', false,
    'The master switch. Off means no ad script is loaded at all, for anybody — not merely hidden.'),
  'ads.publisherId': { group: 'ads', type: 'text', label: 'AdSense publisher id', fallback: '', maxLength: 40, pattern: /^ca-pub-\d{10,20}$/,
    patternHelp: 'It has to look like ca-pub- followed by digits.',
    help: 'Looks like ca-pub-0000000000000000. Without it nothing can be served, whatever the switch above says.' },
  'ads.slotId': { group: 'ads', type: 'text', label: 'Ad unit id', fallback: '', maxLength: 24, pattern: /^\d{6,20}$/,
    patternHelp: 'It is the string of digits from the ad unit you created in AdSense.',
    help: 'The display unit every placement uses. One unit is enough; AdSense reports per page on its own.' },
  'ads.countries': {
    group: 'ads', type: 'countries', label: 'Countries that see ads', fallback: [],
    help: 'Ads are shown only to visitors we place in one of these. Leaving the European Economic Area and the United Kingdom out of this list is what keeps consent law out of scope; adding them means you need a consent banner first.',
    options: () => COUNTRIES.map(c => ({ value: c.code, label: c.name, region: c.region })),
  },
  'ads.personalised': bool('ads', 'Personalised ads', false,
    'On uses the visitor\'s interests, which pays more and, in California, counts as sharing personal information — so the opt-out link is shown and honoured. Off serves ads based only on the page.'),
  // Placements. There is deliberately no switch for "during a study session": an ad beside the
  // rating buttons would collect accidental clicks, which is the fastest way to lose an AdSense
  // account, and it would wreck the one screen the product exists for.
  'ads.onExplore': bool('ads', 'On the explore page', true,
    'Below the grid of public collections.'),
  'ads.onPublicFolder': bool('ads', 'On a public collection', true,
    'Under the cards, where somebody who has finished reading them will be.'),
  'ads.onLibrary': bool('ads', 'On the library page', false,
    'In a signed-in free account\'s own library. The most intrusive of these, so it starts off.'),
  'ads.afterStudy': bool('ads', 'After a study session', true,
    'On the finished screen, which is a natural pause rather than an interruption.'),

  // ── AI assistants ───────────────────────────────────────────────────────────────────────────
  'agent.enabled': bool('agent', 'Allow connected assistants', true,
    'The master switch. Off refuses every assistant call and hides the connection settings; nothing already written is touched, and existing connections start working again the moment it goes back on.'),
  'agent.cardsPerDay': count('agent', 'Cards an assistant may add a day', 500, 10, 20_000,
    'Counted per account across every assistant it has connected, and separate from the rate limit below: a model in a loop can exhaust a generous per-minute allowance in an afternoon without ever tripping it.', 'cards'),
  /**
   * A separate, much tighter allowance, because an image costs something a card does not.
   *
   * A card is a few hundred bytes of text. An image is an outbound request to a stranger's
   * server, up to three megabytes in the bucket, and a resize for every width a browser later
   * asks for. Sharing one counter would let a model spend the whole day's cards on pictures.
   *
   * Zero is a supported value and turns the feature off without touching the master switch,
   * which is the setting to reach for if fetching ever becomes a problem.
   */
  'agent.imagesPerDay': count('agent', 'Images an assistant may fetch a day', 100, 0, 2_000,
    'Counted per account, and only images we actually stored — one the collection already had costs nothing. Set to zero to stop assistants fetching images while leaving everything else working.', 'images'),
  'agent.grantsPerUser': count('agent', 'Assistants one account may connect', 10, 1, 50,
    'Each connected assistant, whether added by pasting a token or through the approval screen.', 'connections'),
  'agent.tokenDays': count('agent', 'A connection expires after', 90, 1, 365,
    'How long a connection keeps working before the person has to approve it again. Refreshing extends it; it never becomes permanent.', 'days'),

  // ── Pricing and plan lengths (generated) ───────────────────────────────────────────────────
  ...priceSettings(),
  ...planSettings(),

  // ── Limits ──────────────────────────────────────────────────────────────────────────────────
  'limits.imageMb': count('limits', 'Largest image upload', 5, 1, 25,
    'Applies to card pictures, folder covers, and payment screenshots.', 'MB'),
  'limits.importMb': count('limits', 'Largest import file', 25, 1, 100, 'Anki, CSV, JSON, or Markdown.', 'MB'),
  'limits.importCards': count('limits', 'Cards per import', 2000, 10, 50_000,
    'A bigger number means a slower import holding a connection open for longer.', 'cards'),
  'limits.cardText': count('limits', 'Characters per card side', 10_000, 100, 100_000, '', 'chars'),
  'limits.projectFolders': count('limits', 'Folders per project', 40, 1, 500, '', 'folders'),
  'limits.dailyGoalMax': count('limits', 'Highest daily goal', 200, 1, 2000,
    'The most cards someone may set as their daily target.', 'cards'),

  // ── Rate limits ─────────────────────────────────────────────────────────────────────────────
  'throttle.apiPerMinute': count('throttle', 'API requests a minute', 300, 30, 10_000,
    'The baseline for every endpoint. Too low and the app fights itself on a busy page.', 'req/min'),
  'throttle.authPer15Min': count('throttle', 'Sign-in attempts per 15 minutes', 30, 3, 500,
    'Covers signup, login, password reset, and account deletion. The main defence against credential stuffing.', 'req'),
  'throttle.uploadsPerMinute': count('throttle', 'Image uploads a minute', 20, 1, 500, '', 'req/min'),
  'throttle.importsPerMinute': count('throttle', 'Imports a minute', 10, 1, 200, '', 'req/min'),
  'throttle.paymentsPerMinute': count('throttle', 'Checkout attempts a minute', 8, 1, 100,
    'Low on purpose. A buyer who needs more than eight tries in a minute has a problem a ninth will not fix.', 'req/min'),
  'throttle.agentPerMinute': count('throttle', 'Assistant calls a minute', 60, 1, 1000,
    'Per connection rather than per IP, because several people behind one office address should not throttle each other.', 'req/min'),

  // ── Teams ───────────────────────────────────────────────────────────────────────────────────
  'teams.minSeats': count('teams', 'Fewest seats sellable', 5, 1, 1000, '', 'seats'),
  'teams.maxSeats': count('teams', 'Most seats sellable', 500, 1, 100_000, '', 'seats'),
  'teams.maxInviteDays': count('teams', 'Longest invite link life', 90, 1, 365, '', 'days'),
};

export const SETTING_KEYS = Object.keys(SETTINGS);
export const settingSpec = key => SETTINGS[key] || null;

/** Everything at its shipped value, which is what an empty settings collection means. */
export const settingFallbacks = () => Object.fromEntries(SETTING_KEYS.map(k => [k, SETTINGS[k].fallback]));

/**
 * One override checked against its own declaration.
 *
 * Returns the value to store, coerced to the declared type, or throws with a message written for
 * whoever is looking at the form. Numbers are the dangerous ones: a string that happens to parse,
 * a fraction where only whole units make sense, or a bound quietly ignored.
 */
export function parseSetting(key, raw) {
  const spec = settingSpec(key);
  if (!spec) throw new Error(`${key} is not a setting.`);
  if (spec.type === 'boolean') {
    if (typeof raw === 'boolean') return raw;
    throw new Error(`${spec.label} has to be on or off.`);
  }
  if (spec.type === 'number') {
    const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
    if (!Number.isFinite(n)) throw new Error(`${spec.label} has to be a number.`);
    if (spec.step === 1 && !Number.isInteger(n)) throw new Error(`${spec.label} has to be a whole number.`);
    if (n < spec.min || n > spec.max) throw new Error(`${spec.label} has to be between ${spec.min} and ${spec.max}.`);
    return n;
  }
  if (spec.type === 'text') {
    const s = String(raw ?? '').trim();
    if (s.length > spec.maxLength) throw new Error(`${spec.label} has to be ${spec.maxLength} characters or fewer.`);
    // A banner is on every page, so a malformed link here is malformed everywhere at once. Only a
    // path on this site or an explicit https address; anything else, including javascript:, is out.
    if (spec.link && s && !/^\/[^/\\]/.test(s) && !/^https:\/\/[^\s]+$/.test(s)) {
      throw new Error(`${spec.label} has to start with / for a page here, or https:// for somewhere else.`);
    }
    if (spec.pattern && s && !spec.pattern.test(s)) throw new Error(`${spec.label}: ${spec.patternHelp}`);
    return s;
  }
  if (spec.type === 'countries') {
    // Refused rather than coerced. Treating a stray string as an empty list would read as "on sale
    // nowhere", which is a long way from what whoever sent it meant.
    if (!Array.isArray(raw)) throw new Error(`${spec.label} has to be a list of countries.`);
    const list = raw.map(String);
    const known = new Map(COUNTRIES.map(c => [c.code, c]));
    for (const code of list) {
      const country = known.get(code);
      if (!country) throw new Error(`${code} is not a country we know.`);
      // A country with no pricing region has no prices to sell at, so letting it through here would
      // put a plan in front of someone and then refuse them at the gateway.
      if (!country.region) throw new Error(`${country.name} has no pricing region, so it cannot be sold to yet.`);
    }
    return [...new Set(list)];
  }
  throw new Error(`${key} has a type this cannot check.`);
}

/**
 * A whole patch checked before any of it is applied, so a form with one bad field changes nothing.
 * Returns the cleaned values and the problems, keyed the same way, for a form to show in place.
 */
export function parseSettings(patch) {
  const values = {}, errors = {};
  for (const [key, raw] of Object.entries(patch || {})) {
    try { values[key] = parseSetting(key, raw); } catch (e) { errors[key] = e.message; }
  }
  return { values, errors, ok: !Object.keys(errors).length };
}

/**
 * Cross-field rules, which a per-field check cannot see.
 *
 * Run against the settings as they would be after the patch, not the patch alone, so changing one
 * half of a pair is judged against the half already stored.
 */
export function settingConflicts(effective) {
  const problems = {};
  if (effective['teams.minSeats'] > effective['teams.maxSeats']) {
    problems['teams.minSeats'] = 'The fewest seats cannot be more than the most.';
  }
  if (!effective['selling.razorpay']) {
    problems['selling.razorpay'] = 'This is the only way to pay, so switching it off stops anybody buying anything.';
  }
  if (effective['ads.enabled'] && !effective['ads.publisherId']) {
    problems['ads.publisherId'] = 'Ads cannot be served without a publisher id.';
  }
  if (effective['ads.enabled'] && !effective['ads.slotId']) {
    problems['ads.slotId'] = 'Ads cannot be served without an ad unit id.';
  }
  if (effective['ads.enabled'] && !effective['ads.countries'].length) {
    problems['ads.countries'] = 'Choose at least one country, or nobody will see an ad and the switch will look broken.';
  }
  if (!effective['selling.countries'].length) {
    problems['selling.countries'] = 'Premium has to be on sale somewhere. Switch the payment methods off instead to stop selling.';
  }
  return problems;
}
