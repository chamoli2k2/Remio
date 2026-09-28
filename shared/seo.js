import { createHash } from 'node:crypto';
import { BRAND } from './brand.js';
import { PREMIUM_FEATURES, PREMIUM_PLANS } from './account.js';
import { DEFAULT_REGIONS, DEFAULT_REGION } from './pricing.js';

export const site = `https://${BRAND.domain}`;

/**
 * What the page says about itself to something that is not a person.
 *
 * Search engines and language models both read a page before a human does, and both do a better
 * job when they are told what they are looking at rather than left to infer it from markup. This
 * is generated from the same constants the product runs on, so a price change or a renamed feature
 * cannot leave the description quietly stating last month's facts.
 *
 * Deliberately absent: any review count or star rating. Inventing those is the quickest way to a
 * manual penalty, and there is nothing to report until real people have rated it.
 *
 * Node-only, because of the crypto import.
 */
const prices = DEFAULT_REGIONS[DEFAULT_REGION];
const plan = id => prices.premium?.[id] || 0;

const graph = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Organization',
      '@id': `${site}/#organization`,
      name: BRAND.legalName,
      alternateName: BRAND.name,
      url: site,
      logo: `${site}/icons/icon-512.png`,
      email: BRAND.email.general,
      address: { '@type': 'PostalAddress', addressLocality: BRAND.city, addressCountry: BRAND.country },
      contactPoint: { '@type': 'ContactPoint', contactType: 'customer support', email: BRAND.email.general, areaServed: ['IN', 'US', 'GB', 'CA', 'AU'] },
    },
    {
      '@type': 'WebSite',
      '@id': `${site}/#website`,
      name: BRAND.name,
      description: BRAND.description,
      url: site,
      publisher: { '@id': `${site}/#organization` },
      inLanguage: 'en',
      // The search box on the home page, described so an agent can query the library directly
      // instead of guessing at a URL shape.
      potentialAction: {
        '@type': 'SearchAction',
        target: { '@type': 'EntryPoint', urlTemplate: `${site}/?q={search_term_string}` },
        'query-input': 'required name=search_term_string',
      },
    },
    {
      '@type': 'SoftwareApplication',
      '@id': `${site}/#app`,
      name: BRAND.name,
      description: BRAND.description,
      url: site,
      applicationCategory: 'EducationalApplication',
      applicationSubCategory: 'Flashcards and spaced repetition',
      operatingSystem: 'Any modern web browser',
      browserRequirements: 'Requires JavaScript',
      publisher: { '@id': `${site}/#organization` },
      featureList: [
        'Unlimited flashcard collections',
        'Spaced repetition scheduling with FSRS',
        'Progress tracking and retention statistics',
        'Publish collections publicly and copy others',
        'Classrooms with assignments and coverage reports',
        ...PREMIUM_FEATURES.map(f => f.label),
      ],
      // A free tier and a set of one-off plans, described as a range rather than a single number
      // because the price depends on the length bought.
      offers: {
        '@type': 'AggregateOffer',
        priceCurrency: prices.currency,
        lowPrice: '0',
        highPrice: String(plan('yearly')),
        offerCount: PREMIUM_PLANS.length + 1,
        offers: [
          { '@type': 'Offer', name: 'Free', price: '0', priceCurrency: prices.currency, description: 'Collections, cards, spaced repetition, publishing, and progress tracking.', availability: 'https://schema.org/InStock' },
          ...PREMIUM_PLANS.map(p => ({
            '@type': 'Offer',
            name: `Premium ${p.label}`,
            price: String(plan(p.id)),
            priceCurrency: prices.currency,
            // One payment for a fixed period, which is the thing buyers most often assume wrongly.
            description: `${p.days} days of Premium. A single payment; nothing renews automatically.`,
            availability: 'https://schema.org/InStock',
            eligibleRegion: ['IN', 'US', 'GB', 'CA', 'AU'],
          })),
        ],
      },
    },
  ],
};

export const jsonLd = JSON.stringify(graph);
/** Quoted and ready for a script-src list: ld+json is a script tag, so the CSP has to allow it. */
export const jsonLdHash = `'sha256-${createHash('sha256').update(jsonLd).digest('base64')}'`;

/** Tags that decide how the site reads when it is shared, previewed, or summarised. */
export const socialTags = [
  `<link rel="canonical" href="${site}/">`,
  `<meta property="og:type" content="website">`,
  `<meta property="og:site_name" content="${BRAND.name}">`,
  `<meta property="og:title" content="${BRAND.title}">`,
  `<meta property="og:description" content="${BRAND.description}">`,
  `<meta property="og:url" content="${site}/">`,
  `<meta property="og:image" content="${site}/icons/icon-512.png">`,
  `<meta property="og:image:alt" content="The ${BRAND.name} logo">`,
  `<meta property="og:locale" content="en">`,
  `<meta name="twitter:card" content="summary">`,
  `<meta name="twitter:title" content="${BRAND.title}">`,
  `<meta name="twitter:description" content="${BRAND.description}">`,
  `<meta name="twitter:image" content="${site}/icons/icon-512.png">`,
  `<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1">`,
].join('\n    ');
