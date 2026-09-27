import test from 'node:test';
import assert from 'node:assert/strict';
import { canAssign, hasPremium, hasDashboard, planById, premiumDaysLeft, premiumExpiryAfter, PREMIUM_PLANS } from '../../shared/account.js';
import { premiumOrderSchema } from '../src/middleware/validate.js';
import { COUNTRIES, composePhone, dialFor } from '../../shared/countries.js';

const order = (over = {}) => ({ plan: 'monthly', name: 'A Buyer', phone: '+919999999999', country: 'India', address: '1 Somewhere Street', ...over });

test('checkout never accepts an email, so a receipt cannot be aimed at someone else', () => {
  // `validate` replaces req.body with what this returns, so a stripped key cannot reach the service
  // even if the client sends it. The address on the confirmed account is the only one used.
  const parsed = premiumOrderSchema.parse(order({ email: 'attacker@example.test' }));
  assert.equal('email' in parsed, false);
  assert.deepEqual(Object.keys(parsed).sort(), ['address', 'country', 'name', 'phone', 'plan']);
});
test('a phone number is only accepted with a dialling code in front of it', () => {
  assert.equal(premiumOrderSchema.safeParse(order()).success, true);
  for (const bad of ['9999999999', '+0999999999', '+91 99999 99999', '+91', 'not-a-number', '']) {
    assert.equal(premiumOrderSchema.safeParse(order({ phone: bad })).success, false, `${bad} should be refused`);
  }
});
test('the country has to be one we actually offer, and every one of them dials', () => {
  assert.equal(premiumOrderSchema.safeParse(order({ country: 'Atlantis' })).success, false);
  assert.equal(premiumOrderSchema.safeParse(order({ country: 'india' })).success, false, 'the list is exact, not fuzzy');
  for (const c of COUNTRIES) {
    assert.match(c.dial, /^\+[1-9]\d{0,3}$/, `${c.name} needs a dialling code`);
    assert.equal(premiumOrderSchema.safeParse(order({ country: c.name })).success, true, `${c.name} should be offered`);
  }
});
test('composing a phone number strips whatever the buyer typed around the digits', () => {
  assert.equal(composePhone('IN', '98765 43210'), '+919876543210');
  assert.equal(composePhone('US', '(555) 010-9999'), '+15550109999');
  assert.equal(dialFor('GB'), '+44');
  assert.equal(dialFor('ZZ'), '', 'an unknown code contributes nothing rather than throwing');
  assert.equal(premiumOrderSchema.safeParse(order({ phone: composePhone('US', '555 010 9999') })).success, true);
});
test('premium and dashboard flags follow account type', () => {
  assert.equal(hasPremium({ account: 'normal' }), false);
  assert.equal(hasPremium({ account: 'premium' }), true);
  assert.equal(hasPremium({ account: 'admin' }), true);
  assert.equal(hasDashboard({ account: 'premium' }), false);
  assert.equal(hasDashboard({ account: 'admin' }), true);
  assert.equal(hasDashboard({ account: 'superadmin' }), true);
});
test('admins can only move normal people between normal and premium', () => {
  const admin = { id: '1', account: 'admin' };
  const learner = { id: '2', account: 'normal' };
  assert.equal(canAssign(admin, learner, 'premium'), true);
  assert.equal(canAssign(admin, learner, 'admin'), false);
  assert.equal(canAssign(admin, { id: '3', account: 'superadmin' }, 'normal'), false);
  assert.equal(canAssign(admin, admin, 'premium'), false);
});
test('superadmin can assign any role except their own', () => {
  const superadmin = { id: '1', account: 'superadmin' };
  assert.equal(canAssign(superadmin, { id: '2', account: 'admin' }, 'normal'), true);
  assert.equal(canAssign(superadmin, { id: '2', account: 'normal' }, 'superadmin'), true);
  assert.equal(canAssign(superadmin, superadmin, 'admin'), false);
});
const DAY = 86400000;
test('a lapsed subscription loses Premium but staff roles never do', () => {
  const now = Date.now();
  assert.equal(hasPremium({ account: 'premium', premiumExpiresAt: new Date(now + 5 * DAY) }, now), true);
  assert.equal(hasPremium({ account: 'premium', premiumExpiresAt: new Date(now - DAY) }, now), false);
  assert.equal(hasPremium({ account: 'premium', premiumExpiresAt: null }, now), true, 'no end date means it never lapses');
  assert.equal(hasPremium({ account: 'admin', premiumExpiresAt: new Date(now - DAY) }, now), true);
});
test('days left rounds up and goes negative once lapsed', () => {
  const now = Date.now();
  assert.equal(premiumDaysLeft({ premiumExpiresAt: new Date(now + 2.4 * DAY) }, now), 3);
  assert.equal(premiumDaysLeft({ premiumExpiresAt: new Date(now - 2 * DAY) }, now), -2);
  assert.equal(premiumDaysLeft({ premiumExpiresAt: null }, now), null);
});
test('buying a plan extends an unexpired subscription instead of truncating it', () => {
  const now = Date.now();
  const monthly = planById('monthly');
  assert.equal(premiumExpiryAfter({ premiumExpiresAt: null }, monthly, now).getTime(), now + 30 * DAY);
  assert.equal(premiumExpiryAfter({ premiumExpiresAt: new Date(now + 100 * DAY) }, monthly, now).getTime(), now + 130 * DAY);
  assert.equal(premiumExpiryAfter({ premiumExpiresAt: new Date(now - 10 * DAY) }, monthly, now).getTime(), now + 30 * DAY, 'a lapsed subscription restarts from today');
  // Every plan on sale runs out; only a legacy grant with no day count has no end date.
  for (const plan of PREMIUM_PLANS) assert.ok(plan.days > 0, `${plan.id} should have a term`);
  assert.equal(premiumExpiryAfter({}, { id: 'legacy', days: null }, now), null);
});
