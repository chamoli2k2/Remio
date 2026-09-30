import { Card, Folder, User } from '../models/index.js';
import { BRAND } from '../../../shared/brand.js';
import { site } from '../../../shared/seo.js';

/**
 * What a crawler reads, filled in per route before the HTML is sent.
 *
 * This is a single-page app: one `index.html` answers every URL, so until now every page told
 * Google and every link preview the same thing — the product's own name. That makes a hundred
 * distinct pages look like one page repeated, and a shared collection preview as the homepage.
 *
 * Rendered here rather than in React because the audience is software that does not run
 * JavaScript. Social preview crawlers never do; search engines do eventually, but they index the
 * served HTML first and a title that arrives later is a title that arrives too late.
 *
 * Only what is already public appears here. A private collection's name is not a small leak — it
 * would be published to anyone who could guess a URL, which is the opposite of what
 * `visibility: 'private'` promises.
 */
const DEFAULTS = {
  title: BRAND.title,
  description: BRAND.description,
  canonical: `${site}/`,
  image: `${site}/icons/icon-512.png`,
  robots: 'index, follow, max-image-preview:large, max-snippet:-1',
};

/** Trimmed to something a search result or a preview card will actually show, not truncate. */
const summarise = (text, limit = 155) => {
  const flat = String(text || '').replace(/\s+/g, ' ').trim();
  if (flat.length <= limit) return flat;
  // Cut at a word so the ellipsis does not land mid-word.
  return `${flat.slice(0, limit).replace(/\s+\S*$/, '')}…`;
};

const page = (path, title, description) => ({
  title: `${title} · ${BRAND.name}`,
  description,
  canonical: `${site}${path}`,
});

/**
 * The fixed pages. Each one says what it is for rather than what the product is called, because
 * a title beginning "Pricing" can rank for a pricing question, and one that is only the product's
 * name and tagline cannot.
 */
const STATIC = {
  '/': { ...DEFAULTS, canonical: `${site}/` },
  '/pricing': page('/pricing', 'Pricing', `What ${BRAND.name} costs. The free tier is the whole product — collections, spaced repetition, publishing and progress. Premium adds projects, import and export, folder covers, live quizzes and editor invites.`),
  '/explore': page('/explore', 'Explore public flashcard collections', `Browse flashcard collections other people have published on ${BRAND.name}. Read and study any of them without an account, or take your own copy.`),
  '/signup': { ...page('/signup', 'Create a free account', `Create a free ${BRAND.name} account. Build flashcard collections, study with spaced repetition, and learn alongside people you trust. No card required.`) },
  '/login': { ...page('/login', 'Sign in', `Sign in to ${BRAND.name}.`), robots: 'noindex, follow' },
  '/terms': page('/terms', 'Terms of use', `The agreement between you and ${BRAND.name}, written to be read. Plain language and a refund policy you can rely on.`),
  '/privacy': page('/privacy', 'Privacy policy', `What ${BRAND.name} collects, why it is held, who else sees it, and how to get it all back or have it deleted. No advertising and no trackers.`),
  '/refunds': page('/refunds', 'Cancellation and refunds', `A full refund within ${BRAND.refundDays} days for any reason. Nothing renews automatically and no mandate is held against your card.`),
  '/contact': page('/contact', 'Contact us', `Questions about ${BRAND.name} reach a person, not a queue. We answer within two working days.`),
};

/** Routes behind a sign-in have nothing for a crawler and should not be competing with the rest. */
const PRIVATE_PREFIXES = ['/settings', '/dashboard', '/premium', '/progress', '/projects', '/friends', '/teams', '/rooms', '/archive', '/shared', '/verify-email', '/forgot-password', '/reset-password'];

async function folderMeta(id) {
  // Only a published collection. Anything else gets the default, which reveals nothing about
  // whether that id exists at all.
  const folder = await Folder.findById(id).select('title description visibility owner thumbnail').catch(() => null);
  if (!folder || folder.visibility !== 'global') return null;
  const [owner, count] = await Promise.all([
    User.findById(folder.owner).select('username').catch(() => null),
    Card.countDocuments({ folder: folder.id }).catch(() => 0),
  ]);
  const cards = count ? `${count} flashcard${count === 1 ? '' : 's'}` : 'Flashcards';
  const by = owner?.username ? ` Published by @${owner.username} on ${BRAND.name}.` : '';
  return {
    title: `${folder.title} — flashcards · ${BRAND.name}`,
    description: summarise(folder.description ? `${folder.description}${by}` : `${cards} on ${folder.title}. Study them free, no account needed.${by}`),
    canonical: `${site}/folders/${folder.id}`,
    /**
     * The collection's own cover, where it has one, rather than the app icon.
     *
     * This is what a link to it looks like when shared, and what a search result shows beside it.
     * Every published collection sharing one picture — the product logo — is the reason a shared
     * deck looked like a link to the homepage. The media route is public for a published folder,
     * so a crawler can follow it without a session.
     */
    ...(folder.thumbnail ? { image: `${site}/api/media/${folder.thumbnail}` } : {}),
  };
}

async function profileMeta(username) {
  const user = await User.findOne({ username: String(username).toLowerCase() }).select('name username bio').catch(() => null);
  if (!user) return null;
  return {
    title: `${user.name} (@${user.username}) · ${BRAND.name}`,
    description: summarise(user.bio || `Flashcard collections published by ${user.name} on ${BRAND.name}.`),
    canonical: `${site}/u/${user.username}`,
  };
}

/** Never throws and never blocks the page: a crawler getting the default beats nobody getting HTML. */
export async function metaFor(path) {
  try {
    const clean = path.split('?')[0].replace(/\/+$/, '') || '/';
    if (STATIC[clean]) return { ...DEFAULTS, ...STATIC[clean] };
    if (PRIVATE_PREFIXES.some(p => clean === p || clean.startsWith(`${p}/`))) return { ...DEFAULTS, robots: 'noindex, nofollow' };

    const folder = /^\/folders\/([A-Za-z0-9]+)$/.exec(clean);
    if (folder) return { ...DEFAULTS, ...(await folderMeta(folder[1]) || {}) };

    const profile = /^\/u\/([A-Za-z0-9_]+)$/.exec(clean);
    if (profile) return { ...DEFAULTS, ...(await profileMeta(profile[1]) || {}) };

    return DEFAULTS;
  } catch { return DEFAULTS; }
}

/** For text inside an XML element, where only these three characters can end it early. */
const escapeXml = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const escapeAttr = value => String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Rewrites the tags the build produced with the ones this route needs.
 *
 * String replacement rather than an HTML parser: it runs on every page load, the markup it edits
 * is generated by our own build two lines away, and the values are escaped before they go in.
 */
export function applyMeta(html, meta) {
  const title = escapeAttr(meta.title);
  const description = escapeAttr(meta.description);
  return html
    .replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`)
    .replace(/(<meta name="description" content=")[^"]*(")/, `$1${description}$2`)
    .replace(/(<link rel="canonical" href=")[^"]*(")/, `$1${escapeAttr(meta.canonical)}$2`)
    .replace(/(<meta property="og:title" content=")[^"]*(")/, `$1${title}$2`)
    .replace(/(<meta property="og:description" content=")[^"]*(")/, `$1${description}$2`)
    .replace(/(<meta property="og:url" content=")[^"]*(")/, `$1${escapeAttr(meta.canonical)}$2`)
    .replace(/(<meta property="og:image" content=")[^"]*(")/, `$1${escapeAttr(meta.image)}$2`)
    .replace(/(<meta name="twitter:title" content=")[^"]*(")/, `$1${title}$2`)
    .replace(/(<meta name="twitter:description" content=")[^"]*(")/, `$1${description}$2`)
    .replace(/(<meta name="twitter:image" content=")[^"]*(")/, `$1${escapeAttr(meta.image)}$2`)
    .replace(/(<meta name="robots" content=")[^"]*(")/, `$1${escapeAttr(meta.robots)}$2`);
}

/**
 * The sitemap, built from what is actually published.
 *
 * Served rather than generated at build time, because the build has no database and the pages
 * worth finding are the collections people publish — which change without a deploy. A build-time
 * file could only ever list the nine fixed pages, which is what it was doing.
 *
 * Cached for an hour: a crawler may ask repeatedly and this is a collection scan.
 */
const FIXED = [['/', '1.0'], ['/pricing', '0.9'], ['/explore', '0.8'], ['/signup', '0.7'], ['/terms', '0.3'], ['/privacy', '0.3'], ['/refunds', '0.3'], ['/contact', '0.3']];
const SITEMAP_TTL = 60 * 60 * 1000;
let cached = { xml: '', at: 0 };

export async function sitemap() {
  if (cached.xml && Date.now() - cached.at < SITEMAP_TTL) return cached.xml;

  /**
   * `image` puts the collection's cover in the sitemap alongside the page it belongs to.
   *
   * Google will find an image on a page it crawls, but declaring it is what gets it considered for
   * image search with a caption attached — and image search is a second way to be found for a
   * topic, with far less competition than the page itself.
   */
  const entry = (loc, priority, lastmod, image) =>
    `  <url><loc>${site}${loc}</loc>${lastmod ? `<lastmod>${lastmod.toISOString().slice(0, 10)}</lastmod>` : ''}<priority>${priority}</priority>` +
    `${image ? `<image:image><image:loc>${site}/api/media/${image.id}</image:loc><image:title>${escapeXml(image.title)}</image:title></image:image>` : ''}</url>`;

  let published = [];
  try {
    // Only what a stranger can already open.
    const open = await Folder.find({ visibility: 'global', archived: { $ne: true } })
      .select('updatedAt title thumbnail').sort({ updatedAt: -1 }).limit(5000).lean();
    // And only the ones with cards in them. An empty collection is a page with nothing to rank
    // for that spends crawl budget saying so. Counted in one pass rather than per folder, because
    // the count is assembled at presentation time and is not on the document.
    const counts = await Card.aggregate([
      { $match: { folder: { $in: open.map(f => f._id) } } },
      { $group: { _id: '$folder', n: { $sum: 1 } } },
    ]);
    const filled = new Set(counts.filter(c => c.n > 0).map(c => String(c._id)));
    published = open.filter(f => filled.has(String(f._id)));
  } catch { /* a sitemap of the fixed pages beats no sitemap at all */ }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n${[
    ...FIXED.map(([loc, priority]) => entry(loc, priority)),
    ...published.map(f => entry(`/folders/${f._id}`, '0.6', f.updatedAt, f.thumbnail ? { id: f.thumbnail, title: f.title } : null)),
  ].join('\n')}\n</urlset>\n`;

  cached = { xml, at: Date.now() };
  return xml;
}
