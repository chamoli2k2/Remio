import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import request from 'supertest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { createApp } from '../src/app.js';
import { allModels, AuditEntry, Setting, User } from '../src/models/index.js';
import { reload } from '../src/services/settingsService.js';
import { BRAND } from '../../shared/brand.js';

const enabled = process.env.RUN_INTEGRATION === '1';
let mongo, app, boss, admin, punter;
const password = 'Settings-integration-2026';

before(async () => {
  if (!enabled) return;
  process.env.DISABLE_RATE_LIMIT = '1';
  const dbName = `${BRAND.slug}_settings_${crypto.randomBytes(6).toString('hex')}`;
  if (!process.env.TEST_MONGODB_URI) mongo = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  await mongoose.connect(process.env.TEST_MONGODB_URI || mongo.getUri(), { dbName });
  await Promise.all(allModels.map(m => m.init()));
  app = createApp();
  [boss, admin, punter] = [request.agent(app), request.agent(app), request.agent(app)];
  for (const [agent, username] of [[boss, 'theboss'], [admin, 'anadmin'], [punter, 'apunter']]) {
    const r = await agent.post('/api/auth/signup').send({ username, name: username, email: `${username}@example.test`, password, country: 'India', acceptedTerms: true });
    assert.equal(r.status, 201, JSON.stringify(r.body));
  }
  await User.updateOne({ username: 'theboss' }, { $set: { account: 'superadmin', emailVerifiedAt: new Date() } });
  await User.updateOne({ username: 'anadmin' }, { $set: { account: 'admin', emailVerifiedAt: new Date() } });
  await User.updateOne({ username: 'apunter' }, { $set: { emailVerifiedAt: new Date() } });
});

after(async () => {
  if (mongoose.connection.readyState) { await mongoose.connection.dropDatabase(); await mongoose.disconnect(); }
  if (mongo) await mongo.stop();
  delete process.env.DISABLE_RATE_LIMIT;
});

// Each test starts from the shipped configuration, so one leaving the shop shut cannot fail the
// next one in a way that looks unrelated to what it changed.
beforeEach(async () => { if (enabled) { await Promise.all([Setting.deleteMany({}), AuditEntry.deleteMany({})]); await reload(); } });

const integration = (name, fn) => test(name, { skip: !enabled }, fn);

integration('the price list is public, and an override reaches the browser', async () => {
  const before = await request(app).get('/api/config');
  assert.equal(before.status, 200, 'a signed-out visitor can read prices');
  assert.equal(before.body.regions.IN.premium.yearly, 1499);

  assert.equal((await boss.patch('/api/admin/settings').send({ values: { 'price.IN.yearly': 1199 } })).status, 200);

  const after = await request(app).get('/api/config');
  assert.equal(after.body.regions.IN.premium.yearly, 1199, 'the next page load quotes the new price');
  assert.equal(after.body.regions.INTL.premium.yearly, 45, 'and the other region is untouched');
});

integration('nothing secret is served with the public config', async () => {
  // The guard on the one rule that cannot be walked back: this response is readable by anyone, so a
  // key that reaches it is a key that has to be rotated. The allow-list in publicConfig is what
  // keeps that from happening by accident when a setting is added later.
  const text = JSON.stringify((await request(app).get('/api/config')).body).toLowerCase();
  for (const word of ['secret', 'password', 'key_id', 'apikey', 'smtp', 'razorpay_', 'token']) {
    assert.equal(text.includes(word), false, `the public config mentions ${word}`);
  }
});

integration('an admin can read the settings but only a superadmin can change one', async () => {
  assert.equal((await punter.get('/api/admin/settings')).status, 403);
  assert.equal((await admin.get('/api/admin/settings')).status, 200, 'reading is dashboard work');

  const refused = await admin.patch('/api/admin/settings').send({ values: { 'price.IN.yearly': 1 } });
  assert.equal(refused.status, 403);
  assert.equal(refused.body.code, 'SUPERADMIN_REQUIRED');
  assert.equal((await request(app).get('/api/config')).body.regions.IN.premium.yearly, 1499, 'and the price did not move');

  assert.equal((await boss.patch('/api/admin/settings').send({ values: { 'price.IN.yearly': 1299 } })).status, 200);
});

integration('a value outside its bounds is refused field by field, and nothing else in the patch is saved', async () => {
  const result = await boss.patch('/api/admin/settings').send({ values: { 'limits.imageMb': 9000, 'signup.open': false } });
  assert.equal(result.status, 400);
  assert.equal(result.body.code, 'SETTINGS_INVALID');
  assert.ok(result.body.details['limits.imageMb'], 'the problem is named against the field it belongs to');
  // The good half of a bad patch is not applied. A form that half-saved would leave the operator
  // guessing which of the things they just changed actually took.
  assert.equal((await request(app).get('/api/config')).body.flags.signupOpen, true);
});

integration('settings that would break the product together are refused together', async () => {
  const result = await boss.patch('/api/admin/settings').send({ values: { 'selling.razorpay': false } });
  assert.equal(result.status, 400);
  assert.equal(result.body.code, 'SETTINGS_CONFLICT');
  assert.ok(result.body.details['selling.razorpay']);
});

integration('closing signups turns away new accounts and leaves existing ones alone', async () => {
  assert.equal((await boss.patch('/api/admin/settings').send({ values: { 'signup.open': false } })).status, 200);

  const turned = await request(app).post('/api/auth/signup').send({ username: 'toolate', name: 'Too Late', email: 'toolate@example.test', password, country: 'India', acceptedTerms: true });
  assert.equal(turned.status, 503);
  assert.equal(turned.body.code, 'SIGNUP_CLOSED');

  const back = await request.agent(app).post('/api/auth/login').send({ identifier: 'apunter', password });
  assert.equal(back.status, 200, 'everyone who already has an account can still sign in');
});

integration('read-only mode stops writes without locking the operator out of the switch', async () => {
  assert.equal((await boss.patch('/api/admin/settings').send({ values: { 'maintenance.readOnly': true } })).status, 200);

  assert.equal((await punter.post('/api/folders').send({ title: 'Nope', visibility: 'private' })).status, 503, 'writing is paused');
  assert.equal((await punter.get('/api/folders')).status, 200, 'reading is not');

  // The carve-out that makes this survivable. Without it the only way out of read-only mode is a
  // redeploy, which is exactly what a runtime switch is supposed to avoid.
  const off = await boss.patch('/api/admin/settings').send({ values: { 'maintenance.readOnly': false } });
  assert.equal(off.status, 200, 'the way back is still open');
  assert.equal((await punter.post('/api/folders').send({ title: 'Now fine', visibility: 'private' })).status, 201);
});

integration('closing a market stops the sale there and not everywhere', async () => {
  await User.updateOne({ username: 'apunter' }, { $set: { country: 'United States' } });
  assert.equal((await boss.patch('/api/admin/settings').send({ values: { 'selling.countries': ['IN'] } })).status, 200);

  const refused = await punter.post('/api/premium/checkout').send({ plan: 'monthly', name: 'A Punter', email: 'apunter@example.test', phone: '+14155550123', country: 'United States', address: '1 Test Street' });
  assert.equal(refused.status, 400);
  assert.equal(refused.body.code, 'COUNTRY_UNSUPPORTED');

  assert.equal((await request(app).get('/api/config')).body.selling.includes('US'), false);
  await User.updateOne({ username: 'apunter' }, { $set: { country: 'India' } });
});

integration('a country with no prices cannot be put on sale at all', async () => {
  const result = await boss.patch('/api/admin/settings').send({ values: { 'selling.countries': ['IN', 'NG'] } });
  assert.equal(result.status, 400);
  assert.ok(result.body.details['selling.countries']);
});

integration('every change is recorded with who made it and what it was before', async () => {
  await boss.patch('/api/admin/settings').send({ values: { 'limits.imageMb': 8 }, note: 'people kept hitting it' });

  const { body } = await admin.get('/api/admin/audit');
  const entry = body.entries.find(e => e.action === 'settings.update');
  assert.ok(entry, 'the change is in the trail');
  assert.equal(entry.actor, 'theboss');
  assert.equal(entry.before['limits.imageMb'], 5, 'including what it used to be, which is the number you want at midnight');
  assert.equal(entry.after['limits.imageMb'], 8);
  assert.equal(entry.note, 'people kept hitting it');
});

integration('saving a form nobody touched records nothing', async () => {
  // Otherwise the trail fills with entries that changed nothing and stops being usable for finding
  // the one that did.
  const result = await boss.patch('/api/admin/settings').send({ values: { 'limits.imageMb': 5 } });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.changed, []);
  assert.equal((await admin.get('/api/admin/audit')).body.entries.filter(e => e.action === 'settings.update').length, 0);
});

integration('resetting an override puts the shipped value back', async () => {
  await boss.patch('/api/admin/settings').send({ values: { 'limits.imageMb': 9 } });
  assert.equal((await boss.get('/api/admin/settings')).body.values['limits.imageMb'], 9);
  assert.ok((await boss.get('/api/admin/settings')).body.overridden.includes('limits.imageMb'));

  assert.equal((await boss.post('/api/admin/settings/reset').send({ keys: ['limits.imageMb'] })).status, 200);
  const after = await boss.get('/api/admin/settings');
  assert.equal(after.body.values['limits.imageMb'], 5);
  assert.equal(after.body.overridden.includes('limits.imageMb'), false, 'and it is a default again, not an override that happens to match');
});

integration('the analytics are staff-only and answer with every panel', async () => {
  assert.equal((await punter.get('/api/admin/analytics')).status, 403);
  const { status, body } = await admin.get('/api/admin/analytics?days=30&weeks=8');
  assert.equal(status, 200);
  for (const panel of ['growth', 'revenue', 'engagement', 'retention', 'health']) assert.ok(body[panel], `${panel} is missing`);
  assert.equal(body.growth.series.length, 30, 'a continuous day series, including the days nothing happened');
  assert.equal(Array.isArray(body.revenue.currencies), true, 'revenue is per currency, never one total');
  assert.equal(body.retention.rows.length, 8);
  assert.equal(typeof body.health.database.state, 'string');

  // The dashboard reads these by name. Pinning them here is the cheap way to find out that a
  // rename emptied a panel, rather than finding out from a page of blanks.
  for (const [panel, keys] of [
    ['growth', ['days', 'series', 'totals', 'activation']],
    ['revenue', ['currencies', 'byPlan', 'byCountry', 'byMethod', 'orders', 'conversion']],
    ['engagement', ['series', 'totals', 'topFolders']],
    ['retention', ['weeks', 'rows']],
    ['health', ['stuckApprovals', 'unclaimedPayments', 'unverifiedAccounts', 'database']],
  ]) for (const key of keys) assert.notEqual(body[panel][key], undefined, `${panel}.${key} is missing`);

  assert.deepEqual(Object.keys(body.growth.activation).sort(), ['createdCard', 'createdCardPercent', 'reviewed', 'reviewedPercent']);
  assert.deepEqual(Object.keys(body.engagement.totals).sort(), ['daily', 'monthly', 'reviews', 'weekly']);
});

integration('a cohort is never reported as churned for a week that has not happened', async () => {
  // The number the whole retention table hangs on. This week's cohort has had one week, so every
  // column after the first is unmeasurable, and the dashboard blanks those rather than drawing a
  // zero that reads as everybody leaving.
  const { body } = await admin.get('/api/admin/analytics?weeks=4');
  const newest = body.retention.rows.at(-1);
  assert.equal(newest.measured, 1, 'the newest cohort has had exactly one week');
  assert.ok(body.retention.rows[0].measured >= 4, 'and the oldest in a four-week window is fully measured');
});

integration('a hand-typed window cannot ask for an aggregation over all of history', async () => {
  assert.equal((await admin.get('/api/admin/analytics?days=9999&weeks=9999')).body.growth.days, 365);
  assert.equal((await admin.get('/api/admin/analytics?days=nonsense')).body.growth.days, 30);
  assert.equal((await admin.get('/api/admin/analytics?days=-5')).body.growth.days, 1, 'a negative window lands on the floor rather than the default');
});

integration('the banner is set from the dashboard and reaches every visitor', async () => {
  // Nothing set means no banner at all, which is how it spends most of its life.
  assert.equal((await request(app).get('/api/config')).body.notice, '');

  const saved = await boss.patch('/api/admin/settings').send({ values: {
    'maintenance.notice': '25% off Premium until Friday',
    'maintenance.noticeLink': '/pricing',
    'maintenance.noticeOffer': true,
  }, note: 'Launch sale' });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));

  // Served unauthenticated, because the banner is for signed-out visitors too.
  const open = await request(app).get('/api/config');
  assert.equal(open.body.notice, '25% off Premium until Friday');
  assert.equal(open.body.noticeLink, '/pricing');
  assert.equal(open.body.noticeOffer, true);

  // A banner appears on every page, so a link that is neither a path here nor an https address
  // would be a broken or hostile link everywhere at once.
  for (const bad of ['javascript:alert(1)', '//evil.example', 'pricing', 'http://insecure.example']) {
    const refused = await boss.patch('/api/admin/settings').send({ values: { 'maintenance.noticeLink': bad } });
    assert.equal(refused.status, 400, `${bad}: ${JSON.stringify(refused.body)}`);
    assert.equal(refused.body.code, 'SETTINGS_INVALID');
  }
  assert.equal((await request(app).get('/api/config')).body.noticeLink, '/pricing', 'and none of them replaced the good one');

  // Clearing the message is how it is taken down; no separate switch to forget.
  await boss.patch('/api/admin/settings').send({ values: { 'maintenance.notice': '' } });
  assert.equal((await request(app).get('/api/config')).body.notice, '');
});

integration('ads are gated on the switch, a publisher, a unit, and the visitor being somewhere on the list', async () => {
  const config = (country = null) => {
    const r = request(app).get('/api/config');
    return (country ? r.set('cf-ipcountry', country) : r).then(res => res.body);
  };

  // Off by default, and off means no publisher id reaches the browser at all — there is nothing
  // for a client to load even if it wanted to.
  const before = await config('IN');
  assert.equal(before.ads.eligible, false);
  assert.equal(before.ads.publisherId, '');

  // Switching it on without the two things that make it work is refused rather than silently
  // doing nothing, which would look like a broken feature.
  const half = await boss.patch('/api/admin/settings').send({ values: { 'ads.enabled': true } });
  assert.equal(half.status, 400, JSON.stringify(half.body));
  assert.deepEqual(Object.keys(half.body.details).sort(), ['ads.countries', 'ads.publisherId', 'ads.slotId']);

  for (const bad of ['pub-123', 'ca-pub-abc', 'ca-pub-']) {
    const refused = await boss.patch('/api/admin/settings').send({ values: { 'ads.publisherId': bad } });
    assert.equal(refused.status, 400, `${bad} should be refused`);
  }

  const on = await boss.patch('/api/admin/settings').send({ values: {
    'ads.enabled': true, 'ads.publisherId': 'ca-pub-1234567890123456', 'ads.slotId': '1234567890',
    'ads.countries': ['IN', 'US', 'CA'], 'ads.personalised': true,
  }, note: 'Ads on for three markets' });
  assert.equal(on.status, 200, JSON.stringify(on.body));

  // A visitor in a chosen market is eligible; one outside it is not, and the country list itself
  // is never sent to the browser.
  for (const country of ['IN', 'US', 'CA']) {
    const c = await config(country);
    assert.equal(c.ads.eligible, true, `${country} should see ads`);
    assert.equal(c.ads.publisherId, 'ca-pub-1234567890123456');
    assert.equal(c.ads.countries, undefined, 'the list of markets is not the browser’s business');
  }
  for (const country of ['GB', 'DE', 'FR', 'AU', 'NG']) {
    assert.equal((await config(country)).ads.eligible, false, `${country} should not see ads`);
  }
  // Unknown location is treated as not eligible rather than as the default market: showing an ad
  // to somebody we cannot place is how the European Economic Area gets served by accident.
  assert.equal((await config(null)).ads.eligible, false, 'no country means no ads');

  // The placement switches travel so the client can leave one off without a deploy.
  assert.equal((await config('IN')).ads.placements.afterStudy, true);
  await boss.patch('/api/admin/settings').send({ values: { 'ads.afterStudy': false } });
  assert.equal((await config('IN')).ads.placements.afterStudy, false);

  // And the master switch really is one: off takes the publisher id away again.
  await boss.patch('/api/admin/settings').send({ values: { 'ads.enabled': false } });
  const off = await config('IN');
  assert.equal(off.ads.eligible, false);
  assert.equal(off.ads.publisherId, '', 'nothing to load once it is off');
});

integration('the country we guess fills the form in but never decides the price', async () => {
  const seen = c => request(app).get('/api/config').set('cf-ipcountry', c).then(r => r.body);
  assert.equal((await seen('CA')).country, 'Canada');
  assert.equal((await seen('DE')).country, 'Germany', 'we say where we think you are even where we do not sell');
  // Cloudflare's "do not know" and Tor markers are not countries.
  for (const unknown of ['XX', 'T1']) assert.equal((await seen(unknown)).country, null);
  // The guess is not the account, and the account is what prices an order.
  const priced = await request(app).get('/api/config').set('cf-ipcountry', 'US');
  assert.equal(priced.body.regions.IN.currency, 'INR', 'the pricebook is the same for everyone');
});
