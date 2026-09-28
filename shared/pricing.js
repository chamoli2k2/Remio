import { countryByName, countryOf, HOME_COUNTRY, regionForCountry, SELLING_COUNTRY_CODES } from './countries.js';

/**
 * The currencies Premium is priced in, and what it costs in each by default.
 *
 * These figures are the shipped defaults, not the live prices. An operator edits prices from the
 * dashboard and the override is stored; what anyone is actually charged comes from a pricebook,
 * which layers those overrides on top of this. Read one through `pricebook()` rather than reaching
 * into this table, or you will quote a price nobody agreed to.
 *
 * Prices are grouped into regions rather than set per country, so a single edit moves every country
 * that shares a market. Each country in shared/countries.js names the region it belongs to; split
 * one out by giving it a region of its own here and pointing it at that instead.
 *
 * Two rules the rest of the code depends on:
 *
 *  - Prices are whole units of the currency, tax included. What the buyer is shown is what leaves
 *    their account, which is the only honest way to price for India, where quoting a figure and
 *    adding tax at the end is not the convention.
 *  - The region comes from the country on the account, never from anything the browser sends.
 *    Otherwise the cheaper price is a request away.
 *
 * ── What is left after a sale ──────────────────────────────────────────────────────────────────
 *
 * India, priced with 18% GST inside the figure, charged through Razorpay:
 *   UPI costs nothing to accept; cards, net banking, and wallets cost 2% plus 18% GST on the fee,
 *   so 2.36% all in. On the ₹1,499 year that is ₹1,270 of revenue after GST and about ₹1,235 in
 *   hand after the gateway, or 82% of the sticker price. GST only applies once turnover passes the
 *   ₹20 lakh registration threshold for services; below it the whole ₹1,464 is yours.
 *
 * International, charged in dollars:
 *   Razorpay takes 3% plus 18% GST on the fee, so 3.54%. Selling software to a buyer outside India
 *   is an export of services and zero-rated, so there is no GST inside the price to give back. On
 *   the $45 year that leaves about $43.40, or 96% of the sticker price.
 *
 * Which is why the two ladders are not a currency conversion of each other. A year from an
 * international buyer is worth roughly three times a year from an Indian one, and it has to be: the
 * Indian price is set against what the market will bear, and the shortfall is made up abroad.
 *
 * Zero-rating an export is not automatic — it wants a LUT on file and the money received in foreign
 * currency. Worth half an hour with an accountant before the first international sale, not after.
 */
export const DEFAULT_REGIONS = {
  IN: {
    label: 'India',
    currency: 'INR',
    symbol: '₹',
    locale: 'en-IN',
    // Priced for the Indian market rather than converted into it. Free alternatives set the
    // expectation here, so the monthly is what a couple of coffees costs and the year undercuts it.
    premium: { monthly: 199, quarterly: 499, halfyearly: 899, yearly: 1499 },
    perSeat: { 'team-monthly': 99, 'team-yearly': 799 },
  },
  INTL: {
    label: 'United States, United Kingdom, Canada, and Australia',
    // One currency for all four rather than four price lists. Dollars are the unit people in each
    // of them expect to see software priced in, and it is one fewer exchange rate to be wrong
    // about. Give a country its own region here the day that stops being true.
    currency: 'USD',
    symbol: '$',
    locale: 'en-US',
    // Set against what the comparable tools charge, a little under most of them, with the same
    // discount ladder as India so the two read as one product rather than two.
    premium: { monthly: 6, quarterly: 15, halfyearly: 27, yearly: 45 },
    perSeat: { 'team-monthly': 4, 'team-yearly': 32 },
  },
};

/** The default markets, and the fallback whenever no override is stored. */
export const DEFAULT_SELLING = SELLING_COUNTRY_CODES;
export const DEFAULT_REGION = 'IN';

/**
 * The amount as a payment gateway wants it: the smallest unit of the currency. Both currencies here
 * happen to divide by a hundred, but stating it per currency means one that does not — yen, won —
 * is a config change rather than a rounding bug in someone's invoice.
 */
const MINOR_UNITS = { INR: 100, USD: 100, GBP: 100, CAD: 100, AUD: 100, JPY: 1, KRW: 1 };
export const minorUnitsIn = currency => MINOR_UNITS[currency] ?? 100;
export const toMinorUnits = (amount, currency) => Math.round(amount * minorUnitsIn(currency));

/**
 * A price as it should read on screen. Grouping follows the region, so an Indian buyer sees
 * ₹1,49,900 written the way they write it and everyone else sees the thousands separated theirs.
 */
export function formatMoney(amount, region = DEFAULT_REGION, regions = DEFAULT_REGIONS) {
  const { currency, locale, symbol } = regions[region] || regions[DEFAULT_REGION] || DEFAULT_REGIONS[DEFAULT_REGION];
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: Number.isInteger(amount) ? 0 : 2 }).format(amount);
  } catch {
    // Intl is present everywhere this runs, but a price is not worth throwing over.
    return `${symbol}${amount}`;
  }
}

/**
 * Everything that depends on what things cost and where they are sold, bound to one set of prices.
 *
 * The point of the indirection is that there is no ambient answer to "what does this cost". The
 * server builds a book from the stored settings, the browser builds one from the config it was
 * served, and tests build one from whatever they are testing. Nothing reads a price out of a module
 * and hopes it is current.
 *
 * `regions` is the price table, `selling` the country codes on sale, `planDays` an optional map of
 * plan id to length for when those have been overridden too.
 */
export function pricebook({ regions = DEFAULT_REGIONS, selling = DEFAULT_SELLING, planDays = null } = {}) {
  const sellable = new Set(selling);
  const regionOf = name => regionForCountry(name);

  /**
   * Whether there is anything to sell a country, which is the question every payment path asks.
   *
   * Two conditions, both needed: an operator has switched the country on, and it belongs to a
   * region that has prices. Most countries fail the first, and anyone may still register from them.
   */
  const sellsInCountry = name => {
    const country = countryByName(name);
    return !!country && sellable.has(country.code) && !!regions[country.region];
  };

  /**
   * The region whose prices an account is shown.
   *
   * Only meaningful once `sellsTo` says yes. For everyone else it settles on the default so that
   * formatting a number never throws, but that figure is not an offer and nothing should show it
   * without checking `sellsTo` first — which is why the premium page asks that before anything else.
   */
  const regionFor = user => regionOf(countryOf(user)) || DEFAULT_REGION;
  const pricingFor = user => regions[regionFor(user)] || DEFAULT_REGIONS[DEFAULT_REGION];

  return {
    regions,
    selling: [...sellable],
    regionForCountry: regionOf,
    sellsInCountry,
    sellsTo: user => sellsInCountry(countryOf(user)),
    regionFor,
    pricingFor,

    /** A plan's price for a buyer, in whole units of their currency. Zero for anything unpriced. */
    premiumPrice: (planId, user) => pricingFor(user).premium?.[planId] || 0,
    seatPrice: (planId, user) => pricingFor(user).perSeat?.[planId] || 0,

    /**
     * A team plan carrying the buyer's own seat rate, and the term length in force.
     *
     * The seat maths in shared/teams.js is about time and how many chairs, not about currency, and
     * it should stay that way — proration is the same arithmetic in every country. So the rate is
     * attached here and that code goes on reading `perSeat` off the plan it is handed, none the wiser.
     */
    teamPlanFor: (plan, user) => (plan ? { ...plan, perSeat: pricingFor(user).perSeat?.[plan.id] || 0, days: planDays?.[plan.id] ?? plan.days } : null),

    /** A plan with any overridden term length applied, for granting the right number of days. */
    planFor: plan => (plan ? { ...plan, days: planDays?.[plan.id] ?? plan.days } : null),

    money: (amount, region) => formatMoney(amount || 0, region || DEFAULT_REGION, regions),
    currencyNote: region => `All prices in ${(regions[region] || regions[DEFAULT_REGION] || DEFAULT_REGIONS[DEFAULT_REGION]).currency}, tax included.`,
  };
}

/** The shipped prices, for tests and for anywhere that genuinely predates the stored settings. */
export const defaultPricebook = pricebook();

export { HOME_COUNTRY };
