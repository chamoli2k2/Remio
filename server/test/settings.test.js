import test from 'node:test';
import assert from 'node:assert/strict';
import { SETTINGS, SETTING_KEYS, parseSetting, parseSettings, settingConflicts, settingFallbacks } from '../../shared/settings.js';

// parseSetting throws on a bad value so a caller cannot forget to check one. These wrap it into a
// pass/fail for the assertions below, which care only about which way it went.
const accepts = (key, raw) => parseSetting(key, raw);
const refuses = (key, raw) => { try { parseSetting(key, raw); return false; } catch { return true; } };
const conflicts = effective => Object.keys(settingConflicts(effective));
import { DEFAULT_REGIONS } from '../../shared/pricing.js';
import { SELLING_COUNTRY_CODES } from '../../shared/countries.js';

test('an empty settings collection is the app as it shipped', () => {
  // The safety property the whole design rests on. Every fallback is the constant the code used
  // before it was configurable, so a fresh install, a wiped collection, and a database that cannot
  // be read all behave identically, and deleting an override is never the thing that breaks prod.
  const shipped = settingFallbacks();
  assert.equal(Object.keys(shipped).length, SETTING_KEYS.length);
  assert.equal(shipped['signup.open'], true);
  assert.equal(shipped['maintenance.readOnly'], false, 'nothing ships switched off');
  assert.equal(shipped['limits.imageMb'], 5);
  assert.equal(shipped['price.IN.yearly'], DEFAULT_REGIONS.IN.premium.yearly);
  assert.equal(shipped['price.INTL.yearly'], DEFAULT_REGIONS.INTL.premium.yearly);
  assert.deepEqual(shipped['selling.countries'], SELLING_COUNTRY_CODES);
});

test('every setting declares enough to render and police itself', () => {
  for (const key of SETTING_KEYS) {
    const spec = SETTINGS[key];
    assert.ok(spec.group, `${key} needs a group`);
    assert.ok(spec.label, `${key} needs a label`);
    assert.notEqual(spec.fallback, undefined, `${key} needs the value the code used before it was configurable`);
    // Bounds live with the declaration rather than in the form, so the server enforces exactly what
    // the form shows and a hand-made request cannot slip past a check that only existed in the UI.
    if (spec.type === 'number') {
      assert.equal(typeof spec.min, 'number', `${key} needs a floor`);
      assert.ok(spec.max > spec.min, `${key} needs a ceiling above its floor`);
      assert.ok(spec.fallback >= spec.min && spec.fallback <= spec.max, `${key} ships outside its own bounds`);
    }
  }
});

test('numbers are clamped, not trusted', () => {
  assert.equal(accepts('limits.imageMb', '9'), 9, 'a form posts strings');
  assert.ok(refuses('limits.imageMb', 9000), 'above the ceiling is refused, not silently capped');
  assert.ok(refuses('limits.imageMb', 0));
  assert.ok(refuses('limits.imageMb', 'big'));
  assert.ok(refuses('throttle.apiPerMinute', -1));
});

test('a price cannot be negative and a free plan has to be meant', () => {
  assert.equal(accepts('price.IN.yearly', 999), 999);
  assert.ok(refuses('price.IN.yearly', -5), 'nobody gets paid to subscribe');
});

test('the selling list only accepts countries there are prices for', () => {
  assert.deepEqual(accepts('selling.countries', ['IN', 'US']), ['IN', 'US']);
  assert.ok(refuses('selling.countries', ['IN', 'NG']), 'Nigeria has no region, so no price');
  assert.ok(refuses('selling.countries', ['IN', 'ZZ']), 'not a country at all');
  assert.ok(refuses('selling.countries', 'IN'), 'a list, not a string');
});

test('an unknown key is refused rather than stored', () => {
  // Otherwise a typo becomes a row nothing reads, and the operator believes they changed something.
  const { errors, ok } = parseSettings({ 'signup.opne': false });
  assert.equal(ok, false);
  assert.ok(errors['signup.opne'], 'and it comes back keyed by the field, for the form to show in place');
});

test('combinations that would break the app are caught before they are saved', () => {
  const base = settingFallbacks();
  // Each of these is a legal value on its own and a broken product together, which is why the check
  // runs against the whole effective configuration rather than field by field.
  assert.ok(conflicts({ ...base, 'teams.minSeats': 50, 'teams.maxSeats': 10 }).length, 'a floor above the ceiling sells nothing');
  assert.ok(conflicts({ ...base, 'selling.razorpay': false, 'selling.manual': false }).length, 'no way to pay is a checkout that cannot complete');
  assert.ok(conflicts({ ...base, 'selling.countries': [] }).length, 'on sale nowhere');
  assert.equal(conflicts(base).length, 0, 'and the shipped configuration is coherent');
});
