/**
 * Everything that names the product lives here. Change `name` and the whole app follows: page titles,
 * the wordmark, error copy, legal pages, server logs, the session cookie, browser storage keys, and
 * the HTML shell, which Vite rewrites at build time from these same values. Nothing else in the
 * codebase should spell the product name out.
 *
 * The word "recall" also means retrieving a memory, which is what a flashcard app does. Those uses
 * are the vocabulary of spaced repetition rather than the brand, so they stay as they are.
 */
const name = 'Remio';
const domain = 'remio.in';

/**
 * The one mailbox that exists today. The four roles below stay separate even though they all land
 * here, because the split is about telling a reader what a message is for, and because giving
 * billing or security its own address later is then one line rather than a hunt through the legal
 * pages for every place an address is printed.
 */
const inbox = `support@${domain}`;

/** Lowercase and safe for cookie names, storage keys, log prefixes, and filenames. */
const slug = name.toLowerCase();

export const BRAND = {
  name,
  slug,
  tagline: 'Learn a little. Remember a lot.',
  description: `${name}: a thoughtful space to create flashcards, learn together, and remember more.`,
  title: `${name}, your learning library`,
  domain,
  legalName: `${name} Learning`,
  city: 'Delhi',
  country: 'India',
  /**
   * Addresses printed on the contact and legal pages. All four point at the single mailbox above
   * for now; replace any one of them with its own address on the domain when the volume justifies
   * it, and every page that prints it follows.
   */
  email: {
    general: inbox,
    billing: inbox,
    privacy: inbox,
    security: inbox,
  },
  /** Shown as the "last updated" date on the terms and privacy pages. */
  policyUpdated: '28 September 2026',

  /**
   * How long a buyer has to change their mind, stated once because it appears on the terms, the
   * refund page, the pricing page, the home page questions, and the file agents read — and a
   * refund promise that says seven days in one place and fourteen in another is worse than either.
   *
   * Fourteen rather than seven because the United Kingdom is one of the markets, and the Consumer
   * Contracts Regulations give a consumer fourteen days to cancel a distance contract. Offering
   * the same everywhere is simpler than geography-dependent small print, and more generous than
   * the law requires in the other four.
   */
  refundDays: 14,

  /**
   * From header on anything the server sends. MAIL_FROM overrides it per environment.
   * Sent from the real mailbox rather than a noreply address, because that address does not exist
   * yet and mail from a sender nobody can reply to is both rejected more often and ruder than it
   * needs to be. Move it to noreply@ once that mailbox exists and SPF and DKIM cover the domain.
   */
  mailFrom: `${name} <${inbox}>`,

  /** The signed access token, and the refresh token that renews it. Both HttpOnly. */
  cookies: { access: `${slug}_access`, refresh: `${slug}_refresh` },
  /** Keys this app owns in localStorage. */
  storage: {
    theme: `${slug}-theme`,
    sidebar: `${slug}:sidebar`,
    draft: `${slug}-draft`,
  },

  /**
   * Slugs the product used to go by. A rename would otherwise reset every saved preference, so they
   * are still read under these names and rewritten under the current one.
   */
  legacySlugs: ['recall'],
};

export const brandName = BRAND.name;

/** Storage keys to read for `which`, current first, so a rename keeps the saved value. */
export const storageKeys = which =>
  [BRAND.storage[which], ...BRAND.legacySlugs.map(s => BRAND.storage[which].replace(BRAND.slug, s))];
