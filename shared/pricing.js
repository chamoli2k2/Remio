import { countryOf, HOME_COUNTRY, regionForCountry } from './countries.js';

/**
 * Every price in the product. This is the file to edit to change what anything costs.
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
export const REGIONS = {
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

/**
 * Regions we will actually take money from. Having this as well as the region list means a market
 * can be priced before it is opened, or closed without deleting its prices: a region missing from
 * here has a full price list that simply is not for sale.
 */
const SELLING = ['IN', 'INTL'];

export const DEFAULT_REGION = 'IN';
export const regionById = id => REGIONS[id] || null;

/**
 * Whether there is anything to sell a country, which is the question every payment path asks.
 *
 * Most countries answer no. Anyone may register and study from anywhere, so the great majority of
 * accounts are in countries with no pricing region at all, and that has to read as "not for sale"
 * rather than quietly falling back to a price list meant for somewhere else.
 */
export const sellsInCountry = name => SELLING.includes(regionForCountry(name));
export const sellsTo = user => sellsInCountry(countryOf(user));

/**
 * The region whose prices an account is shown.
 *
 * Only meaningful once `sellsTo` says yes. For everyone else it settles on the default so that
 * formatting a number never throws, but that figure is not an offer and nothing should show it
 * without checking `sellsTo` first — which is why the premium page asks that before anything else.
 */
export const regionFor = user => regionForCountry(countryOf(user)) || DEFAULT_REGION;
export const pricingFor = user => REGIONS[regionFor(user)];

/** A plan's price for a buyer, in whole units of their currency. Zero for anything unpriced. */
export const premiumPrice = (planId, user) => pricingFor(user).premium[planId] || 0;
export const seatPrice = (planId, user) => pricingFor(user).perSeat[planId] || 0;

/**
 * A team plan carrying the buyer's own seat rate.
 *
 * The seat maths in shared/teams.js is about time and how many chairs, not about currency, and it
 * should stay that way — proration is the same arithmetic in every country. So the rate is attached
 * here and that code goes on reading `perSeat` off the plan it is handed, none the wiser.
 */
export const teamPlanFor = (plan, user) => (plan ? { ...plan, perSeat: seatPrice(plan.id, user) } : null);

/**
 * The amount as a payment gateway wants it: the smallest unit of the currency. Both currencies here
 * happen to divide by a hundred, but stating it per region means a currency that does not — yen,
 * won — is a config change rather than a rounding bug in someone's invoice.
 */
const MINOR_UNITS = { INR: 100, USD: 100, GBP: 100, CAD: 100, AUD: 100, JPY: 1, KRW: 1 };
export const minorUnitsIn = currency => MINOR_UNITS[currency] ?? 100;
export const toMinorUnits = (amount, currency) => Math.round(amount * minorUnitsIn(currency));

/**
 * A price as it should read on screen. Grouping follows the region, so an Indian buyer sees
 * ₹1,49,900 written the way they write it and everyone else sees the thousands separated theirs.
 */
export function formatMoney(amount, region = DEFAULT_REGION) {
  const { currency, locale, symbol } = REGIONS[region] || REGIONS[DEFAULT_REGION];
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: Number.isInteger(amount) ? 0 : 2 }).format(amount);
  } catch {
    // Intl is present everywhere this runs, but a price is not worth throwing over.
    return `${symbol}${amount}`;
  }
}

/** Where a region's prices are quoted, for the one line of copy that has to say so. */
export const currencyNote = region => {
  const { currency } = REGIONS[region] || REGIONS[DEFAULT_REGION];
  return `All prices in ${currency}, tax included.`;
};

export { HOME_COUNTRY };
