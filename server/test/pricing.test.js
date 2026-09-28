import test from 'node:test';
import assert from 'node:assert/strict';
import { PLAN_IDS, PREMIUM_PLANS } from '../../shared/account.js';
import { TEAM_PLAN_IDS } from '../../shared/teams.js';
import { COUNTRIES, HOME_COUNTRY, PRICEABLE_COUNTRIES, countryOf, regionForCountry } from '../../shared/countries.js';
import { DEFAULT_REGION, DEFAULT_REGIONS, defaultPricebook, formatMoney, minorUnitsIn, pricebook, toMinorUnits } from '../../shared/pricing.js';
import { signupSchema } from '../src/middleware/validate.js';

// The shipped book, which is what the app runs on until an operator changes something.
const { currencyNote, premiumPrice, pricingFor, regionFor, seatPrice, sellsInCountry, sellsTo, teamPlanFor } = defaultPricebook;
const REGIONS = DEFAULT_REGIONS;

const buyer = country => ({ country });

test('anyone in the world can be an account, and only a handful of countries can be charged', () => {
  // The whole point of the split: registering is open, selling is not. If these two ever converge
  // it means either the list shrank to the markets we bill, or we started billing everywhere.
  assert.ok(COUNTRIES.length > 200, `only ${COUNTRIES.length} countries offered at signup`);
  assert.ok(PRICEABLE_COUNTRIES.length < COUNTRIES.length);
  assert.deepEqual(PRICEABLE_COUNTRIES.map(c => c.code).sort(), ['AU', 'CA', 'GB', 'IN', 'US']);
  for (const c of COUNTRIES) {
    // Every country has to be registerable, and a dialling code, since checkout builds a phone
    // number from whichever one the buyer picks.
    assert.equal(signupSchema.safeParse({ username: 'someone', name: 'Some One', email: 'a@b.test', password: 'a-long-enough-password', country: c.name }).success, true, `${c.name} should be able to register`);
    assert.match(c.dial, /^\+[1-9]\d{0,3}$/, `${c.name} needs a dialling code`);
  }
  assert.equal(new Set(COUNTRIES.map(c => c.name)).size, COUNTRIES.length, 'two countries sharing a name would make the stored value ambiguous');
  assert.equal(new Set(COUNTRIES.map(c => c.code)).size, COUNTRIES.length);
});

test('a country we sell to can price every plan; one we do not has no prices at all', () => {
  for (const c of PRICEABLE_COUNTRIES) {
    assert.equal(sellsInCountry(c.name), true);
    assert.ok(REGIONS[regionForCountry(c.name)], `${c.name} points at a region that does not exist`);
    // A sellable country with a plan priced at zero would take an order and charge nothing for it.
    for (const id of PLAN_IDS) assert.ok(premiumPrice(id, buyer(c.name)) > 0, `${c.name} has no price for ${id}`);
    for (const id of TEAM_PLAN_IDS) assert.ok(seatPrice(id, buyer(c.name)) > 0, `${c.name} has no seat price for ${id}`);
  }
  for (const name of ['Nigeria', 'Germany', 'Brazil', 'Japan', 'Kenya', 'Singapore']) {
    assert.equal(regionForCountry(name), null, `${name} is not a market yet, so it has no region`);
    assert.equal(sellsInCountry(name), false, `${name} must not be sellable`);
    assert.equal(sellsTo(buyer(name)), false);
  }
  // Every country is either sellable or explicitly not; none is left in between.
  for (const c of COUNTRIES) assert.equal(sellsInCountry(c.name), !!c.region, c.name);
});

test('an account with no country is priced as home rather than left unpriced', () => {
  // Accounts predate the country being asked for, and every one of them was opened while this was
  // an India-only product. An unrecognised string is bad data and lands in the same place.
  for (const stray of [{}, { country: '' }, { country: 'Atlantis' }, { country: 'india' }, null, undefined]) {
    assert.equal(countryOf(stray), HOME_COUNTRY);
    assert.equal(regionFor(stray), DEFAULT_REGION);
    assert.equal(sellsTo(stray), true, 'a fallback that cannot buy anything would strand the account');
    assert.ok(premiumPrice('monthly', stray) > 0);
  }
});

test('a price shown to someone we cannot sell to is never mistaken for an offer', () => {
  // regionFor settles on a default so formatting cannot throw, which means it returns a real price
  // list for a country that has nothing for sale. Only sellsTo answers whether to show it.
  const nigerian = buyer('Nigeria');
  assert.equal(regionFor(nigerian), DEFAULT_REGION);
  assert.ok(premiumPrice('yearly', nigerian) > 0, 'a figure exists');
  assert.equal(sellsTo(nigerian), false, 'but it is not for sale, and that is the only question that counts');
});

test('India is charged in rupees and the other four in dollars, and never the other way about', () => {
  assert.equal(pricingFor(buyer('India')).currency, 'INR');
  for (const name of ['United States', 'United Kingdom', 'Canada', 'Australia']) {
    assert.equal(pricingFor(buyer(name)).currency, 'USD', `${name} should be billed in dollars`);
  }
  // The regional price is the whole point: it has to actually be lower, and not by a rounding error.
  const india = premiumPrice('yearly', buyer('India'));
  const abroad = premiumPrice('yearly', buyer('United States'));
  assert.ok(india > abroad, `the rupee figure ${india} should be a larger number than the dollar one ${abroad}`);
});

test('a longer plan always costs less per month, in every region', () => {
  const monthsIn = id => PREMIUM_PLANS.find(p => p.id === id).days / 30;
  for (const region of Object.keys(REGIONS)) {
    const rate = id => REGIONS[region].premium[id] / monthsIn(id);
    const rates = PLAN_IDS.map(rate);
    for (let i = 1; i < rates.length; i++) {
      // Otherwise the plan picker shows a "Save 12%" badge on something that costs more.
      assert.ok(rates[i] < rates[i - 1], `${region}: ${PLAN_IDS[i]} is not cheaper per month than ${PLAN_IDS[i - 1]}`);
    }
    assert.ok(REGIONS[region].perSeat['team-yearly'] < REGIONS[region].perSeat['team-monthly'] * 12, `${region}: a yearly seat should beat twelve monthly ones`);
  }
});

test('a gateway is handed the smallest unit of the currency, rounded to a whole one', () => {
  assert.equal(toMinorUnits(199, 'INR'), 19900, 'paise');
  assert.equal(toMinorUnits(6, 'USD'), 600, 'cents');
  assert.equal(minorUnitsIn('JPY'), 1, 'a currency with no subunit is not multiplied');
  assert.equal(minorUnitsIn('ZWL'), 100, 'an unlisted currency assumes two decimal places');
  // A price that is not whole must not arrive at the gateway as a fraction of a cent.
  assert.equal(toMinorUnits(6.995, 'USD'), 700);
  assert.equal(Number.isInteger(toMinorUnits(4.5, 'USD')), true);
});

test('the seat maths is handed the buyer\'s own rate rather than reading one off the plan', () => {
  // shared/teams.js knows nothing about currency, so a plan with no rate attached would silently
  // price every seat at zero.
  const plan = { id: 'team-monthly', label: 'Monthly', days: 30 };
  assert.equal(teamPlanFor(plan, buyer('India')).perSeat, REGIONS.IN.perSeat['team-monthly']);
  assert.equal(teamPlanFor(plan, buyer('Canada')).perSeat, REGIONS.INTL.perSeat['team-monthly']);
  assert.equal(teamPlanFor(null, buyer('India')), null, 'an unknown plan stays null rather than becoming a priced one');
});

test('prices are written the way each region writes them', () => {
  assert.match(formatMoney(1499, 'IN'), /^₹1,499$/);
  assert.match(formatMoney(45, 'INTL'), /^\$45$/);
  assert.match(formatMoney(149900, 'IN'), /1,49,900/, 'Indian grouping, not thousands');
  assert.match(currencyNote('IN'), /INR/);
  assert.match(currencyNote('INTL'), /USD/);
  assert.equal(formatMoney(0, 'IN'), formatMoney(0, 'IN'), 'zero formats without throwing');
});

test('signing up requires a country, and it has to be a real one', () => {
  const base = { username: 'newcomer', name: 'A Newcomer', email: 'new@example.test', password: 'a-long-enough-password' };
  assert.equal(signupSchema.safeParse({ ...base, country: 'Australia' }).success, true);
  assert.equal(signupSchema.safeParse({ ...base, country: 'Nigeria' }).success, true, 'registering is open even where we cannot sell');
  for (const bad of [undefined, '', 'india', 'Atlantis', 'Wakanda']) {
    assert.equal(signupSchema.safeParse({ ...base, country: bad }).success, false, `${bad} should be refused`);
  }
});

test('an overridden price is the price, and the shipped one is only a fallback', () => {
  // The whole reason prices go through a book: an operator changes a number and the next quote uses
  // it, without a deploy and without the old figure surviving in some second copy of the truth.
  const cheaper = pricebook({ regions: { ...DEFAULT_REGIONS, IN: { ...DEFAULT_REGIONS.IN, premium: { ...DEFAULT_REGIONS.IN.premium, yearly: 999 } } } });
  assert.equal(cheaper.premiumPrice('yearly', buyer('India')), 999);
  assert.equal(cheaper.premiumPrice('yearly', buyer('United States')), DEFAULT_REGIONS.INTL.premium.yearly, 'one region changing leaves the other alone');
  assert.equal(defaultPricebook.premiumPrice('yearly', buyer('India')), DEFAULT_REGIONS.IN.premium.yearly, 'and the shipped book is untouched by it');
});

test('closing a market stops the sale without unpricing the country', () => {
  const indiaOnly = pricebook({ selling: ['IN'] });
  assert.equal(indiaOnly.sellsTo(buyer('India')), true);
  assert.equal(indiaOnly.sellsTo(buyer('United States')), false, 'switched off, so nothing can be sold there');
  // It still has a region, because whether a country can be priced and whether we choose to trade
  // there are different questions. Conflating them is what would make reopening a market a deploy.
  assert.equal(indiaOnly.regionForCountry('United States'), 'INTL');
  assert.equal(indiaOnly.premiumPrice('yearly', buyer('United States')) > 0, true);
});

test('a country with no prices can never be switched on', () => {
  // Naming it in the setting is not enough: there is no currency and no price list behind it, so
  // selling would mean quoting a figure out of thin air.
  const wishful = pricebook({ selling: ['IN', 'NG', 'DE'] });
  assert.equal(wishful.sellsTo(buyer('Nigeria')), false);
  assert.equal(wishful.sellsTo(buyer('Germany')), false);
});

test('a lengthened plan grants the configured days, not the shipped ones', () => {
  const generous = pricebook({ planDays: { yearly: 400 } });
  assert.equal(generous.planFor(PREMIUM_PLANS.find(p => p.id === 'yearly')).days, 400);
  assert.equal(generous.planFor(PREMIUM_PLANS.find(p => p.id === 'monthly')).days, 30, 'untouched plans keep their own length');
});
