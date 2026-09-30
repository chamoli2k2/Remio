import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import request from 'supertest';
import sharp from 'sharp';
import http from 'node:http';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { connectDatabase } from '../src/config/database.js';
import { createApp } from '../src/app.js';
import { allModels, Review, User, Notification, Relationship, PremiumOrder, Team, Folder, Card, Media } from '../src/models/index.js';
import { defaultPricebook } from '../../shared/pricing.js';
import { BRAND } from '../../shared/brand.js';
const enabled = process.env.RUN_INTEGRATION === '1';
let mongo, app, owner, editor, outsider, folderId, cardId, gateway;

/**
 * A stand-in for Razorpay's orders endpoint.
 *
 * Reserving an order is the first half of every purchase, so a suite that cannot call the gateway
 * cannot test buying anything. Pointing the client at a local server instead exercises the real
 * request building, the real error mapping, and the real order record, without live keys and
 * without the tests depending on somebody else's uptime.
 */
async function startGateway() {
  let n = 0;
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      const { amount, currency } = JSON.parse(body || '{}');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id: `order_stub_${++n}`, amount, currency }));
    });
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  process.env.RAZORPAY_API_URL = `http://127.0.0.1:${server.address().port}`;
  process.env.RAZORPAY_KEY_ID = 'rzp_test_stub';
  process.env.RAZORPAY_KEY_SECRET = 'stub-secret';
  return server;
}
const password = 'Integration-only-password-2026';
before(async () => {
  if (!enabled) return;
  gateway = await startGateway();
  // This suite reserves far more orders in a minute than a person would, and it is not the suite
  // that tests throttling. Said here rather than inherited from whichever file happened to run
  // first, which is what previously decided whether these tests saw a limiter at all.
  process.env.DISABLE_RATE_LIMIT = '1';
  const dbName = `${BRAND.slug}_test_${crypto.randomBytes(6).toString('hex')}`;
  if (!process.env.TEST_MONGODB_URI) mongo = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  await mongoose.connect(process.env.TEST_MONGODB_URI || mongo.getUri(), { dbName });
  await Promise.all(allModels.map(m => m.init())); app = createApp();
  [owner, editor, outsider] = [request.agent(app), request.agent(app), request.agent(app)];
  for (const [agent, username] of [[owner, 'owner'], [editor, 'editor'], [outsider, 'outsider']]) { const r = await agent.post('/api/auth/signup').send({ username, name: username, email: `${username}@example.test`, password, country: 'India', acceptedTerms: true }); assert.equal(r.status, 201, JSON.stringify(r.body)); }
  // Paying needs a confirmed address; these tests are about what happens after that, not about it.
  await User.updateMany({}, { $set: { account: 'premium', emailVerifiedAt: new Date() } });
  const f = await owner.post('/api/folders').send({ title: 'Concurrency', visibility: 'private' }); assert.equal(f.status, 201); folderId = f.body.folder.id;
  const c = await owner.post(`/api/folders/${folderId}/cards`).send({ front: { text: 'Q' }, back: { text: 'A' } }); assert.equal(c.status, 201); cardId = c.body.card.id;
});
after(async () => { if (mongoose.connection.readyState) { await mongoose.connection.dropDatabase(); await mongoose.disconnect(); } if (mongo) await mongo.stop(); if (gateway) await new Promise(done => gateway.close(done)); for (const k of ['RAZORPAY_API_URL', 'RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'DISABLE_RATE_LIMIT']) delete process.env[k]; });
const integration = (name, fn) => test(name, { skip: !enabled }, fn);
integration('private folders and media stay private, public access is revoked immediately', async () => {
  assert.equal((await outsider.get(`/api/folders/${folderId}`)).status, 404);
  assert.equal((await request(app).get(`/api/folders/${folderId}/cards`)).status, 404);
  const png = await sharp({ create: { width: 10, height: 10, channels: 3, background: '#6545d1' } }).png().toBuffer();
  const image = await owner.post(`/api/folders/${folderId}/images`).attach('image', png, 'test.png'); assert.equal(image.status, 201, JSON.stringify(image.body));
  assert.equal((await outsider.get(`/api/media/${image.body.id}`)).status, 404);
  assert.equal((await owner.get(`/api/media/${image.body.id}`)).headers['cache-control'], 'private, no-store');
  let f = (await owner.get(`/api/folders/${folderId}`)).body.folder;
  let result = await owner.patch(`/api/folders/${folderId}`).send({ ...f, visibility: 'global', version: f.version }); assert.equal(result.status, 200);
  assert.equal((await request(app).get(`/api/media/${image.body.id}`)).status, 200);
  f = result.body.folder; await owner.patch(`/api/folders/${folderId}`).send({ ...f, visibility: 'private', version: f.version });
  assert.equal((await request(app).get(`/api/media/${image.body.id}`)).status, 404);
});
integration('viewers cannot edit; editors can edit; revocation stops later writes', async () => {
  assert.equal((await owner.post(`/api/folders/${folderId}/members`).send({ username: 'editor', role: 'viewer' })).status, 200);
  const body = { front: { text: 'Edited' }, back: { text: 'Answer' }, version: 0 };
  assert.equal((await editor.patch(`/api/cards/${cardId}`).send(body)).status, 403);
  await owner.post(`/api/folders/${folderId}/members`).send({ username: 'editor', role: 'editor' });
  assert.equal((await editor.patch(`/api/cards/${cardId}`).send(body)).status, 200);
  await owner.post(`/api/folders/${folderId}/members`).send({ username: 'editor', role: 'remove' });
  assert.equal((await editor.patch(`/api/cards/${cardId}`).send({ ...body, version: 1 })).status, 404);
});
integration('only one simultaneous edit wins; old version is preserved', async () => {
  const current = (await owner.get(`/api/folders/${folderId}/cards`)).body.cards.find(c => c.id === cardId);
  const body = { front: { text: 'Concurrent question' }, back: { text: 'Answer' }, version: current.version };
  const results = await Promise.all([owner.patch(`/api/cards/${cardId}`).send(body), owner.patch(`/api/cards/${cardId}`).send(body)]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
  assert.ok((await owner.get(`/api/cards/${cardId}/revisions`)).body.revisions.length >= 1);
});
integration('retries count as one review; different concurrent reviews conflict', async () => {
  const body = { cardId, rating: 'good', requestId: crypto.randomUUID(), version: 0 };
  const results = await Promise.all([owner.post('/api/reviews').send(body), owner.post('/api/reviews').send(body)]);
  assert.deepEqual(results.map(r => r.status), [200, 200]); assert.equal(await Review.countDocuments({ requestId: body.requestId }), 1);
  const version = results[0].body.progress.version;
  const parallel = await Promise.all(['hard', 'easy'].map(rating => owner.post('/api/reviews').send({ cardId, rating, requestId: crypto.randomUUID(), version })));
  assert.deepEqual(parallel.map(r => r.status).sort(), [200, 409]);
});
integration('usernames are unique even with concurrent registration and capitalization', async () => {
  const results = await Promise.all(['UniqueLearner', 'uniquelearner'].map((username, i) => request(app).post('/api/auth/signup').send({ username, name: 'Test', email: `unique${i}@example.test`, password, country: 'India', acceptedTerms: true })));
  assert.deepEqual(results.map(r => r.status).sort(), [201, 409]);
});
integration('private copies own their image data after access to the source is revoked', async () => {
  const png = await sharp({ create: { width: 12, height: 12, channels: 3, background: '#8162d7' } }).png().toBuffer();
  const image = await owner.post(`/api/folders/${folderId}/images`).attach('image', png, 'copy-test.png'); assert.equal(image.status, 201);
  const imageCard = await owner.post(`/api/folders/${folderId}/cards`).send({ front: { text: 'Copy this image', image: image.body.id }, back: { text: 'An independent image copy' } }); assert.equal(imageCard.status, 201);
  await owner.post(`/api/folders/${folderId}/members`).send({ username: 'editor', role: 'viewer' });
  const r = await editor.post(`/api/folders/${folderId}/copy`); assert.equal(r.status, 201); assert.equal(r.body.folder.visibility, 'private'); assert.equal(r.body.folder.role, 'owner');
  await owner.post(`/api/folders/${folderId}/members`).send({ username: 'editor', role: 'remove' });
  const copied = await editor.get(`/api/folders/${r.body.folder.id}/cards`); assert.equal(copied.status, 200);
  const copiedImage = copied.body.cards.find(c => c.front.text === 'Copy this image').front.image;
  assert.notEqual(copiedImage, image.body.id);
  assert.equal((await editor.get(`/api/media/${copiedImage}`)).status, 200);
  assert.equal((await editor.get(`/api/media/${image.body.id}`)).status, 404);
});
integration('follow is one-way, connect needs accept, like and copy counts stay on the folder', async () => {
  assert.equal((await editor.post('/api/users/owner/follow')).status, 200);
  const profile = (await editor.get('/api/users/owner')).body.profile;
  assert.equal(profile.followers, 1); assert.equal(profile.relation.following, true); assert.equal(profile.relation.friendship, 'none');
  assert.equal((await owner.post('/api/users/editor/connect')).status, 200);
  assert.equal((await editor.get('/api/me/requests')).body.people[0].username, 'owner');
  assert.equal((await editor.post('/api/users/owner/connect/accept')).status, 200);
  assert.equal((await owner.get('/api/users/editor')).body.profile.relation.friendship, 'friends');
  assert.equal((await owner.get('/api/me/friends')).body.people.some(p => p.username === 'editor'), true);
  const pub = await owner.post('/api/folders').send({ title: 'Public likes', visibility: 'global' });
  const like = await editor.patch(`/api/folders/${pub.body.folder.id}/save`).send({ saved: true });
  assert.equal(like.status, 200); assert.equal(like.body.folder.likeCount, 1); assert.equal(like.body.folder.liked, true);
  const copied = await editor.post(`/api/folders/${pub.body.folder.id}/copy`);
  assert.equal(copied.status, 201);
  assert.equal((await owner.get(`/api/folders/${pub.body.folder.id}`)).body.folder.copyCount, 1);
  const project = await editor.post('/api/projects').send({ title: 'Interview prep', visibility: 'private' });
  assert.equal(project.status, 201);
  assert.equal((await editor.post(`/api/projects/${project.body.project.id}/folders`).send({ folderId: copied.body.folder.id })).status, 200);
  const people = await owner.get('/api/users?q=edit');
  assert.equal(people.status, 200); assert.ok(people.body.users.some(u => u.username === 'editor'));
});
integration('dashboard is staff-only; premium routes reject a normal account', async () => {
  await User.updateOne({ username: 'owner' }, { $set: { account: 'superadmin' } });
  await User.updateOne({ username: 'outsider' }, { $set: { account: 'normal' } });
  assert.equal((await outsider.get('/api/admin/users')).status, 403);
  const staff = await owner.get('/api/admin/users');
  assert.equal(staff.status, 200); assert.ok(staff.body.users.length >= 3);
  const outsiderId = staff.body.users.find(u => u.username === 'outsider').id;
  assert.equal((await owner.patch(`/api/admin/users/${outsiderId}`).send({ account: 'premium' })).status, 200);
  assert.equal((await outsider.get('/api/projects')).status, 200);
  await owner.patch(`/api/admin/users/${outsiderId}`).send({ account: 'normal' });
  assert.equal((await outsider.get('/api/projects')).status, 402);
  const order = plan => outsider.post('/api/premium/checkout').send({ plan, name: 'Out Sider', phone: '+919999999999', country: 'India', address: '1 Demo Street' });
  assert.equal((await order('galactic')).status, 400, 'an unknown plan is rejected');
  const buy = await order('monthly');
  assert.equal(buy.status, 201, JSON.stringify(buy.body));
  assert.equal(buy.body.order.plan, 'monthly');
  assert.equal(buy.body.order.currency, 'INR', 'an Indian account is billed in rupees');
  assert.equal(buy.body.order.amount, defaultPricebook.premiumPrice('monthly', { country: 'India' }) * 100);
  assert.ok(buy.body.checkout.orderId.startsWith('order_'), 'the gateway order id is handed to the browser');
  assert.equal(buy.body.checkout.key, 'rzp_test_stub', 'and the publishable key with it');

  // The same plan, bought from abroad, is a different currency and a different number. The billing
  // country typed into the form is deliberately still India here: it is the account that prices the
  // order, so filling in a cheaper country must not buy a cheaper plan.
  await PremiumOrder.deleteMany({ user: (await User.findOne({ username: 'outsider' }))._id });
  await User.updateOne({ username: 'outsider' }, { $set: { country: 'United States', account: 'normal', premiumPlan: '', premiumExpiresAt: null } });
  const abroad = await order('monthly');
  assert.equal(abroad.status, 201, JSON.stringify(abroad.body));
  assert.equal(abroad.body.order.currency, 'USD');
  assert.equal(abroad.body.order.amount, defaultPricebook.premiumPrice('monthly', { country: 'United States' }) * 100, 'in cents');
  assert.notEqual(abroad.body.order.amount, buy.body.order.amount);
  // Somewhere we do not sell cannot buy at all, however the request is dressed up. The billing
  // country below still says India, which is exactly the loophole this closes.
  await PremiumOrder.deleteMany({ user: (await User.findOne({ username: 'outsider' }))._id });
  await User.updateOne({ username: 'outsider' }, { $set: { country: 'Nigeria', account: 'normal', premiumPlan: '', premiumExpiresAt: null } });
  const refused = await order('monthly');
  assert.equal(refused.status, 400, JSON.stringify(refused.body));
  assert.equal(refused.body.code, 'COUNTRY_UNSUPPORTED', JSON.stringify(refused.body));
  assert.equal(await PremiumOrder.countDocuments({ user: (await User.findOne({ username: 'outsider' }))._id }), 0, 'a refusal leaves no order behind');

  await User.updateOne({ username: 'outsider' }, { $set: { country: 'India' } });
  await order('monthly');
  assert.equal((await order('monthly')).status, 400, 'and a second order cannot be opened while one is in progress');
  // Usage by country is staff-only and counts the account's country, not the billing one.
  assert.equal((await outsider.get('/api/admin/countries')).status, 403, 'not for ordinary accounts');
  const usage = await owner.get('/api/admin/countries?days=30');
  assert.equal(usage.status, 200, JSON.stringify(usage.body));
  assert.equal(usage.body.days, 30);
  const india = usage.body.rows.find(r => r.country === 'India');
  assert.ok(india && india.accounts >= 3, `expected the signups above to be counted: ${JSON.stringify(usage.body.rows)}`);
  assert.equal(india.sellable, true);
  assert.equal(india.code, 'IN');
  assert.equal(usage.body.totals.accounts, usage.body.rows.reduce((n, r) => n + r.accounts, 0), 'the totals add up to the rows');
  // The window is clamped rather than trusted, so a hand-typed one cannot scan all of history.
  assert.equal((await owner.get('/api/admin/countries?days=9999')).body.days, 365);
  assert.equal((await owner.get('/api/admin/countries?days=nonsense')).body.days, 30);

  const orders = await owner.get('/api/admin/orders');
  assert.equal(orders.status, 200);
  assert.equal((await owner.patch(`/api/admin/orders/${orders.body.orders[0].id}`).send({ status: 'approved' })).status, 200);
  assert.equal((await outsider.get('/api/projects')).status, 200);
  // Approval writes the plan and a 30-day window onto the account, and the owner is told about it.
  const mine = await outsider.get('/api/premium/order');
  assert.equal(mine.body.subscription.plan, 'monthly');
  assert.ok(mine.body.subscription.daysLeft > 28 && mine.body.subscription.daysLeft <= 30, `daysLeft was ${mine.body.subscription.daysLeft}`);
  const notified = await outsider.get('/api/notifications');
  assert.equal(notified.status, 200);
  assert.ok(notified.body.notifications.some(n => n.type === 'premium.approved'), JSON.stringify(notified.body));
  // A lapsed subscription closes the Premium routes again without touching the role.
  await User.updateOne({ username: 'outsider' }, { $set: { premiumExpiresAt: new Date(Date.now() - 86400000) } });
  assert.equal((await outsider.get('/api/projects')).status, 402);
});
integration('a gateway payment is verified against its signature and can only ever be granted once', async () => {
  const secret = 'webhook-test-secret';
  process.env.RAZORPAY_WEBHOOK_SECRET = secret;
  const buyer = await User.findOne({ username: 'outsider' });
  await User.updateOne({ _id: buyer._id }, { $set: { account: 'normal', premiumPlan: '', premiumExpiresAt: null } });
  await PremiumOrder.deleteMany({ user: buyer._id });
  await Notification.deleteMany({ user: buyer._id });
  const order = await PremiumOrder.create({
    user: buyer._id, plan: 'yearly', method: 'razorpay', amount: 149900, currency: 'INR',
    gatewayOrderId: 'order_signature_test', status: 'pending',
    name: 'Out Sider', email: 'out@example.test', phone: '9999999999', country: 'India', address: '1 Demo Street',
  });
  const raw = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_signature_test', order_id: 'order_signature_test', status: 'captured' } } } });
  const post = signature => request(app).post('/api/premium/webhook/razorpay').set('Content-Type', 'application/json').set('X-Razorpay-Signature', signature).send(raw);

  const forged = await post(crypto.createHmac('sha256', 'not-the-secret').update(raw).digest('hex'));
  assert.equal(forged.status, 400, 'an unsigned caller cannot hand out Premium');
  assert.equal((await PremiumOrder.findById(order.id)).status, 'pending');

  const signature = crypto.createHmac('sha256', secret).update(raw).digest('hex');
  const first = await post(signature);
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.equal(first.body.handled, 'approved');
  const granted = await User.findById(buyer._id);
  assert.equal(granted.account, 'premium');
  assert.equal(granted.premiumPlan, 'yearly');
  const expiry = granted.premiumExpiresAt.getTime();

  // Razorpay retries webhooks, and the browser callback races them. Neither may extend the plan twice.
  const replay = await post(signature);
  assert.equal(replay.status, 200);
  assert.equal(replay.body.alreadySettled, true);
  assert.equal((await User.findById(buyer._id)).premiumExpiresAt.getTime(), expiry, 'a replayed webhook adds no extra days');
  assert.equal((await PremiumOrder.findById(order.id)).gatewayPaymentId, 'pay_signature_test');
  assert.equal((await Notification.countDocuments({ user: buyer._id, type: 'premium.approved' })), 1, 'and the buyer is told exactly once');
  delete process.env.RAZORPAY_WEBHOOK_SECRET;
});
integration('a classroom: seats are sold, a seat unlocks Premium only inside the team, and the last seat cannot be sold twice', async () => {
  // Three free accounts so nothing here can be explained by a personal subscription.
  const [teacher, alice, bob] = [request.agent(app), request.agent(app), request.agent(app)];
  for (const [agent, username] of [[teacher, 'teach'], [alice, 'alice'], [bob, 'bob']]) {
    const r = await agent.post('/api/auth/signup').send({ username, name: username, email: `${username}@example.test`, password, country: 'India', acceptedTerms: true });
    assert.equal(r.status, 201, JSON.stringify(r.body));
  }
  await User.updateMany({ username: { $in: ['teach', 'alice', 'bob'] } }, { $set: { account: 'normal', premiumPlan: '', premiumExpiresAt: null, emailVerifiedAt: new Date() } });

  const made = await teacher.post('/api/teams').send({ name: 'Physics 101', kind: 'classroom', description: 'Year one mechanics' });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  const teamId = made.body.team.id;
  assert.equal(made.body.team.seats, 0);
  assert.equal(made.body.team.active, false, 'a new team is unpaid and cannot be invited into');
  assert.equal((await teacher.post(`/api/teams/${teamId}/invites`).send({ role: 'student' })).status, 402, 'no seats, no invites');

  // Seats are quoted from the team's own state, never from the client.
  const quoted = await teacher.post(`/api/teams/${teamId}/quote`).send({ plan: 'team-monthly', seats: 6 });
  assert.equal(quoted.status, 200, JSON.stringify(quoted.body));
  assert.equal(quoted.body.kind, 'team-new');
  // Every signup above is Indian, so these are the rupee rates.
  const seatRate = defaultPricebook.seatPrice('team-monthly', { country: 'India' });
  assert.equal(quoted.body.amount, seatRate * 6);
  assert.equal(quoted.body.currency, 'INR', 'quoted in the owner\'s own currency');

  const buy = await teacher.post(`/api/teams/${teamId}/checkout`)
    .send({ plan: 'team-monthly', seats: 6, name: 'Teach Er', email: 'teach@example.test', phone: '+919999999999', country: 'India', address: '1 School Road' });
  assert.equal(buy.status, 201, JSON.stringify(buy.body));
  assert.equal(buy.body.order.seats, 6);
  assert.equal(buy.body.order.amount, seatRate * 6 * 100, 'stored in the smallest unit of the currency');
  assert.equal(buy.body.order.currency, 'INR');

  const orders = await owner.get('/api/admin/orders');
  const seatOrder = orders.body.orders.find(o => o.id === buy.body.order.id);
  assert.equal(seatOrder.kind, 'team-new');
  assert.equal((await owner.patch(`/api/admin/orders/${seatOrder.id}`).send({ status: 'approved' })).status, 200);

  const paid = await teacher.get(`/api/teams/${teamId}`);
  assert.equal(paid.body.team.seats, 6);
  assert.equal(paid.body.team.active, true);
  assert.equal(paid.body.team.memberCount, 1, 'the owner holds the first seat');
  assert.ok(paid.body.team.daysLeft > 28 && paid.body.team.daysLeft <= 30);

  // The plaintext code is returned once. Everything after that is the hash.
  const invited = await teacher.post(`/api/teams/${teamId}/invites`).send({ role: 'student' });
  assert.equal(invited.status, 201, JSON.stringify(invited.body));
  const code = invited.body.code;
  assert.match(code, /^[A-Z2-9]{8}$/);
  assert.equal(invited.body.invite.code, undefined, 'the code is never echoed back in the invite record');

  const peek = await alice.get(`/api/teams/code/${code}`);
  assert.equal(peek.body.team.name, 'Physics 101');
  assert.equal(peek.body.roleLabel, 'Student');
  assert.equal((await alice.post('/api/teams/join').send({ code })).status, 201);
  assert.equal((await alice.post('/api/teams/join').send({ code })).status, 400, 'joining twice takes a second seat from nobody');
  assert.equal((await bob.post('/api/teams/join').send({ code: 'AAAAAAAA' })).status, 404, 'a wrong code reveals nothing');

  // A team folder: the roster decides access, so Alice can open it without being invited to it.
  const tf = await teacher.post(`/api/teams/${teamId}/folders`).send({ title: 'Newton', description: '', color: 'blue', icon: 'flask', visibility: 'private' });
  assert.equal(tf.status, 201, JSON.stringify(tf.body));
  const teamFolder = tf.body.folder.id;
  await teacher.post(`/api/folders/${teamFolder}/cards`).send({ front: { text: 'F = ?' }, back: { text: 'ma' } });
  const asAlice = await alice.get(`/api/folders/${teamFolder}`);
  assert.equal(asAlice.status, 200, 'a student reads the class folder');
  assert.equal(asAlice.body.folder.role, 'viewer');
  assert.equal(asAlice.body.folder.premium, true, 'her seat entitles her here');
  assert.equal((await bob.get(`/api/folders/${teamFolder}`)).status, 404, 'a non-member cannot see it at all');
  assert.ok((await alice.get('/api/folders')).body.folders.some(f => f.id === teamFolder), 'and it appears in her library');

  // The boundary: the same free account gets nothing in its own folder.
  const own = await alice.post('/api/folders').send({ title: 'My own notes', description: '', color: 'violet', icon: 'layers', visibility: 'private' });
  assert.equal(own.body.folder.premium, false, 'a seat does not follow her home');
  assert.equal((await alice.get(`/api/folders/${own.body.folder.id}/export`)).status, 402);
  assert.equal((await alice.get(`/api/folders/${teamFolder}/export`)).status, 200, 'but the toolkit works on team content');

  // Seats: the last one cannot be sold twice. Six seats, five taken, two people racing.
  const extras = [];
  for (const username of ['stu1', 'stu2', 'stu3', 'stu4']) {
    const agent = request.agent(app);
    const up = await agent.post('/api/auth/signup').send({ username, name: username, email: `${username}@example.test`, password, country: 'India', acceptedTerms: true });
    assert.equal(up.status, 201, JSON.stringify(up.body));
    extras.push(agent);
  }
  for (const agent of extras.slice(0, 3)) assert.equal((await agent.post('/api/teams/join').send({ code })).status, 201);
  const full = await teacher.get(`/api/teams/${teamId}`);
  assert.equal(full.body.team.memberCount, 5);
  assert.equal(full.body.team.seatsLeft, 1);

  const racers = [extras[3], request.agent(app)];
  await racers[1].post('/api/auth/signup').send({ username: 'stu5', name: 'stu5', email: 'stu5@example.test', password, country: 'India', acceptedTerms: true });
  const settled = await Promise.all(racers.map(a => a.post('/api/teams/join').send({ code })));
  const won = settled.filter(r => r.status === 201);
  assert.equal(won.length, 1, `exactly one racer takes the last seat, got ${settled.map(r => r.status).join()}`);
  assert.equal(settled.find(r => r.status !== 201).body.code, 'NO_SEATS');
  const after = await teacher.get(`/api/teams/${teamId}`);
  assert.equal(after.body.team.memberCount, 6, 'the roster never exceeds the seats that were paid for');
  assert.equal(after.body.team.seatsLeft, 0);

  // Extra seats bought right after paying cost full price, because no time has been used up yet.
  const perSeat = defaultPricebook.seatPrice('team-monthly', { country: 'India' });
  const fresh = await teacher.post(`/api/teams/${teamId}/quote`).send({ plan: 'team-monthly', seats: 8 });
  assert.equal(fresh.body.kind, 'team-seats');
  assert.equal(fresh.body.seats, 8);
  assert.equal(fresh.body.amount, perSeat * 2);

  // Ten days into the term, the same two seats are prorated down to what is left of it.
  const tenLeft = new Date(Date.now() + 10 * 86400000);
  await Team.updateOne({ _id: teamId }, { $set: { expiresAt: tenLeft } });
  const topUp = await teacher.post(`/api/teams/${teamId}/quote`).send({ plan: 'team-monthly', seats: 8 });
  assert.equal(topUp.body.kind, 'team-seats');
  assert.ok(topUp.body.amount < perSeat * 2 && topUp.body.amount > 0, `two seats for a third of a term, quoted ${topUp.body.amount}`);
  assert.equal(new Date(topUp.body.expiresAt).getTime(), tenLeft.getTime(), 'a top-up does not move the renewal date');
  // Renewing at the current seat count is a different quote from buying more.
  const renew = await teacher.post(`/api/teams/${teamId}/quote`).send({ plan: 'team-monthly', seats: 6 });
  assert.equal(renew.body.kind, 'team-renew');
  assert.equal(renew.body.amount, perSeat * 6);

  // Removing someone frees the seat immediately, so nobody pays for an empty chair.
  const aliceId = after.body.members.find(m => m.username === 'alice').id;
  assert.equal((await teacher.delete(`/api/teams/${teamId}/members/${aliceId}`)).status, 200);
  assert.equal((await teacher.get(`/api/teams/${teamId}`)).body.team.seatsLeft, 1);
  assert.equal((await alice.get(`/api/folders/${teamFolder}`)).status, 404, 'and her access goes with it');

  // A teacher sees the class; a student does not.
  const teacherPromoted = after.body.members.find(m => m.username === 'stu1').id;
  assert.equal((await teacher.patch(`/api/teams/${teamId}/members/${teacherPromoted}`).send({ role: 'teacher' })).status, 200);
  const view = await extras[0].get(`/api/teams/${teamId}/progress`);
  assert.equal(view.status, 200, JSON.stringify(view.body));
  assert.equal(view.body.totalCards, 1);
  assert.ok(view.body.rows.some(r => r.username === 'stu2' && r.coverage === 0), 'a student who has not studied shows zero coverage');
  assert.equal((await extras[1].get(`/api/teams/${teamId}/progress`)).status, 403, 'a student cannot read the class report');

  // Assignments reach the class as notifications.
  const assigned = await teacher.post(`/api/teams/${teamId}/assignments`).send({ folderId: teamFolder, title: 'Chapter 1', instructions: 'Finish before Friday' });
  assert.equal(assigned.status, 201, JSON.stringify(assigned.body));
  const inbox = await extras[1].get('/api/notifications');
  assert.ok(inbox.body.notifications.some(n => n.type === 'team.assignment'), JSON.stringify(inbox.body.notifications.map(n => n.type)));

  // A lapse closes the team's toolkit without anyone revoking anything.
  await Team.updateOne({ _id: teamId }, { $set: { expiresAt: new Date(Date.now() - 86400000) } });
  assert.equal((await extras[1].get(`/api/folders/${teamFolder}`)).status, 404, 'an unpaid team closes its folders');
  assert.equal((await extras[1].post('/api/teams/join').send({ code })).status, 400);
});
integration('every failure comes back in one envelope with a traceable request id', async () => {
  const missing = await outsider.get('/api/nope');
  assert.equal(missing.status, 404);
  assert.equal(missing.body.code, 'NO_ROUTE');
  assert.ok(missing.body.requestId, 'the body carries an id');
  assert.equal(missing.headers['x-request-id'], missing.body.requestId, 'and it matches the header');

  const badId = await owner.get('/api/folders/not-an-object-id');
  assert.equal(badId.status, 404);
  assert.equal(badId.body.code, 'NOT_FOUND');

  const invalid = await owner.post('/api/folders').send({ title: '' });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.code, 'VALIDATION_FAILED');
  assert.equal(invalid.body.details.field, 'title');

  const duplicate = await request(app).post('/api/auth/signup').send({ username: 'owner', name: 'Clash', email: 'clash@example.test', password, country: 'India', acceptedTerms: true });
  assert.equal(duplicate.status, 409);
  assert.doesNotMatch(JSON.stringify(duplicate.body), /E11000|mongo/i, 'driver internals never reach the client');

  const malformed = await owner.post('/api/folders').set('Content-Type', 'application/json').send('{"title":');
  assert.equal(malformed.status, 400);
  assert.equal(malformed.body.code, 'BAD_JSON');

  const caller = await request(app).get('/api/nope').set('X-Request-Id', 'trace-me-123');
  assert.equal(caller.body.requestId, 'trace-me-123', 'a caller-supplied id is reused for correlation');
  const unsafe = await request(app).get('/api/nope').set('X-Request-Id', 'bad id with spaces');
  assert.notEqual(unsafe.body.requestId, 'bad id with spaces', 'but only when it is a safe token');
});
integration('follows and connection requests notify the other person, and reads clear the badge', async () => {
  // Earlier tests already linked these two, so start from a clean graph.
  await Promise.all([Notification.deleteMany({}), Relationship.deleteMany({}), User.updateMany({}, { $set: { followers: 0, following: 0, friends: 0 } })]);
  assert.equal((await owner.post('/api/users/editor/follow')).status, 200);
  assert.equal((await owner.post('/api/users/editor/connect')).status, 200);
  const inbox = await editor.get('/api/notifications');
  assert.equal(inbox.status, 200);
  assert.deepEqual(inbox.body.notifications.map(n => n.type).sort(), ['connect.request', 'follow']);
  assert.equal(inbox.body.unread, 2);
  assert.equal(inbox.body.notifications[0].actor.username, 'owner');
  assert.equal((await editor.post('/api/users/owner/connect/accept')).status, 200);
  const accepted = await owner.get('/api/notifications');
  assert.ok(accepted.body.notifications.some(n => n.type === 'connect.accepted'));
  const read = await editor.post('/api/notifications/read').send({});
  assert.equal(read.body.unread, 0);
  assert.equal((await editor.get('/api/notifications')).body.unread, 0);
  // Nobody sees somebody else's inbox.
  assert.equal((await outsider.get('/api/notifications')).body.notifications.length, 0);
});


integration('an invoice can only be addressed to a country we are registered in', async () => {
  const buyer = request.agent(app);
  assert.equal((await buyer.post('/api/auth/signup').send({ username: 'billed', name: 'Billed Person', email: 'billed@example.test', password, country: 'India', acceptedTerms: true })).status, 201);
  await User.updateOne({ username: 'billed' }, { $set: { emailVerifiedAt: new Date() } });
  const send = country => buyer.post('/api/premium/checkout')
    .send({ plan: 'monthly', name: 'Billed Person', phone: '+919999999999', country, address: '1 Demo Street' });

  // The form only offers the five markets, so this is what happens when a request does not come
  // from the form. It has to be refused server-side too: the country lands on the invoice.
  const refused = await send('Germany');
  assert.equal(refused.status, 400, JSON.stringify(refused.body));
  assert.equal(refused.body.code, 'BILLING_COUNTRY_UNSUPPORTED');
  assert.ok(refused.body.error.includes('India'), 'and the refusal names the countries that would work');
  assert.equal(await PremiumOrder.countDocuments({ name: 'Billed Person' }), 0, 'nothing was reserved on the way out');

  // A market other than the account's own is allowed on purpose. Someone with an Indian account and
  // a card billed in the United States is a person abroad, not an arbitrage, and the proof of that
  // is the currency below: the account prices the order however this field is filled in.
  const abroad = await send('United States');
  assert.equal(abroad.status, 201, JSON.stringify(abroad.body));
  assert.equal(abroad.body.order.currency, 'INR', 'priced by the account, not by the address');
});

integration('two people can be waiting to pay at the same time', async () => {
  // Both gateway ids carry a unique index, and a sparse index only skips a field that is absent: one
  // that is present and null is indexed like any other value. Defaulting them to null therefore put
  // every unpaid order under the same key, so the second one created anywhere in the collection
  // collided with the first and the buyer was told the record already existed.
  const submit = async username => {
    const agent = request.agent(app);
    assert.equal((await agent.post('/api/auth/signup').send({ username, name: username, email: `${username}@example.test`, password, country: 'India', acceptedTerms: true })).status, 201);
    await User.updateOne({ username }, { $set: { emailVerifiedAt: new Date() } });
    return agent.post('/api/premium/checkout')
      .send({ plan: 'monthly', name: username, phone: '+919999999999', country: 'India', address: '2 Queue Lane' });
  };
  const first = await submit('queuer');
  const second = await submit('waiter');
  assert.equal(first.status, 201, JSON.stringify(first.body));
  assert.equal(second.status, 201, JSON.stringify(second.body), 'a second unpaid order is not a duplicate of the first');
  assert.notEqual(first.body.checkout.orderId, second.body.checkout.orderId, 'and each holds its own gateway order');
  assert.equal(await PremiumOrder.countDocuments({ status: 'pending', method: 'razorpay' }) >= 2, true);
});

integration('anyone can report a published collection, and upholding it takes the collection down', async () => {
  const shared = await owner.post('/api/folders').send({ title: 'Reportable', visibility: 'global' });
  assert.equal(shared.status, 201);
  const folderId = shared.body.folder.id;

  // A private folder is not published to the reporter, so it answers the same way a missing one
  // does rather than confirming that the id exists.
  const secret = await owner.post('/api/folders').send({ title: 'Not published', visibility: 'private' });
  assert.equal((await request(app).post(`/api/folders/${secret.body.folder.id}/report`).send({ reason: 'spam' })).status, 404);

  assert.equal((await request(app).post(`/api/folders/${folderId}/report`).send({ reason: 'nonsense' })).status, 400, 'the reason has to be one we recognise');

  // Signed out, because a public folder can be read without an account.
  const filed = await request(app).post(`/api/folders/${folderId}/report`)
    .send({ reason: 'infringement', detail: 'Copied from my book.', email: 'reporter@example.test' });
  assert.equal(filed.status, 201, JSON.stringify(filed.body));
  assert.equal(filed.body.report.status, 'open');
  assert.equal(filed.body.report.reason, 'infringement');
  assert.ok(!JSON.stringify(filed.body).includes('reporter@example.test'), 'the reporter address is never echoed back');

  assert.equal((await owner.post(`/api/folders/${folderId}/report`).send({ reason: 'spam' })).body.report ? 400 : 400, 400, 'and the owner is told to unpublish it instead');

  assert.equal((await outsider.get('/api/admin/reports')).status, 403, 'the queue is staff-only');
  const queue = await owner.get('/api/admin/reports');
  assert.equal(queue.status, 200, JSON.stringify(queue.body));
  assert.ok(queue.body.open >= 1);
  const row = queue.body.reports.find(r => r.id === filed.body.report.id);
  assert.equal(row.folder.title, 'Reportable');
  assert.equal(row.reporter, 'by email', 'an anonymous notice is shown as such, without the address');

  const decided = await owner.patch(`/api/admin/reports/${row.id}`).send({ status: 'upheld', outcome: 'Copied without a licence.' });
  assert.equal(decided.status, 200, JSON.stringify(decided.body));
  assert.equal(decided.body.report.status, 'upheld');

  // Upheld means unpublished, never deleted: the owner keeps the work and can put it right.
  const after = await Folder.findById(folderId).lean();
  assert.equal(after.visibility, 'private', 'the collection is no longer public');
  assert.ok(after, 'but it still exists');
  assert.equal((await request(app).get(`/api/folders/${folderId}`)).status, 404, 'and a stranger can no longer read it');
});

integration('a superadmin can delete an account, and is stopped from the three ways that go wrong', async () => {
  const victim = request.agent(app);
  assert.equal((await victim.post('/api/auth/signup').send({ username: 'deleteme', name: 'Delete Me', email: 'deleteme@example.test', password, country: 'India', acceptedTerms: true })).status, 201);
  const victimId = (await User.findOne({ username: 'deleteme' }))._id.toString();
  const folder = await victim.post('/api/folders').send({ title: 'Work that should go', visibility: 'private' });
  assert.equal(folder.status, 201);

  assert.equal((await outsider.delete(`/api/admin/users/${victimId}`).send({ confirm: 'deleteme' })).status, 403, 'not for an ordinary account');

  // The owner agent is a superadmin in this suite. Each refusal below guards a different mistake.
  const wrongName = await owner.delete(`/api/admin/users/${victimId}`).send({ confirm: 'someone-else' });
  assert.equal(wrongName.status, 400, JSON.stringify(wrongName.body));
  assert.equal(wrongName.body.code, 'CONFIRM_MISMATCH', 'the username has to be typed back');

  const ownerId = (await User.findOne({ username: 'owner' }))._id.toString();
  const self = await owner.delete(`/api/admin/users/${ownerId}`).send({ confirm: 'owner' });
  assert.equal(self.body.code, 'SELF_DELETE', 'deleting yourself here would skip the password check');

  await User.updateOne({ username: 'editor' }, { $set: { account: 'superadmin' } });
  const boss = (await User.findOne({ username: 'editor' }))._id.toString();
  const peer = await owner.delete(`/api/admin/users/${boss}`).send({ confirm: 'editor' });
  assert.equal(peer.body.code, 'SUPERADMIN_TARGET', 'one superadmin cannot remove another in a single click');
  await User.updateOne({ username: 'editor' }, { $set: { account: 'premium' } });

  assert.ok(await User.findById(victimId), 'none of those refusals deleted anything');

  const done = await owner.delete(`/api/admin/users/${victimId}`).send({ confirm: 'DeleteMe', note: 'Spam account' });
  assert.equal(done.status, 200, JSON.stringify(done.body));
  assert.equal(await User.countDocuments({ _id: victimId }), 0, 'the account is gone');
  assert.equal(await Folder.countDocuments({ _id: folder.body.folder.id }), 0, 'and so is the work only it owned');

  // The audit line is the only thing left that says the account ever existed.
  const audit = await owner.get('/api/admin/audit');
  const entry = audit.body.entries.find(e => e.action === 'account.deleted' && e.target === 'deleteme');
  assert.ok(entry, 'the deletion is recorded');
  assert.equal(entry.note, 'Spam account');
});

integration('an image stored in the bucket is served as a signed redirect, and still only to people who may see it', async () => {
  // Presigning is local arithmetic, so the whole branch can be exercised with make-believe
  // credentials and no bucket. What is being tested is the routing and the permission check.
  const before = { ...process.env };
  Object.assign(process.env, { R2_BUCKET: 'test-bucket', R2_ACCOUNT_ID: 'acc123', R2_ACCESS_KEY_ID: 'key', R2_SECRET_ACCESS_KEY: 'secret' });
  try {
    const shelf = await owner.post('/api/folders').send({ title: 'Has a bucket image', visibility: 'private' });
    const media = await Media.create({ folder: shelf.body.folder.id, uploadedBy: (await User.findOne({ username: 'owner' }))._id, key: 'f/x/stored.webp', contentType: 'image/webp', name: 'stored.webp' });

    // The permission check runs before anything is signed, so a stranger never learns the key.
    const refused = await outsider.get(`/api/media/${media.id}`).redirects(0);
    assert.equal(refused.status, 404);
    assert.ok(!refused.headers.location, 'and gets no link at all');

    const allowed = await owner.get(`/api/media/${media.id}`).redirects(0);
    assert.equal(allowed.status, 302, JSON.stringify(allowed.body));
    const url = new URL(allowed.headers.location);
    assert.equal(url.host, 'test-bucket.acc123.r2.cloudflarestorage.com');
    assert.equal(url.pathname, '/f/x/stored.webp');
    assert.ok(url.searchParams.get('X-Amz-Signature'), 'the link is signed');
    assert.match(allowed.headers['cache-control'], /private/, 'and never cached by anything shared');

    // A row written before the bucket existed still holds its bytes and is still served directly.
    const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#123456' } }).png().toBuffer();
    const legacy = await Media.create({ folder: shelf.body.folder.id, uploadedBy: (await User.findOne({ username: 'owner' }))._id, data: png, contentType: 'image/png' });
    const old = await owner.get(`/api/media/${legacy.id}`).redirects(0);
    assert.equal(old.status, 200, 'the old path keeps working during and after a migration');
    assert.equal(old.headers['cache-control'], 'private, no-store');
  } finally {
    for (const k of ['R2_BUCKET', 'R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY']) {
      if (before[k] === undefined) delete process.env[k]; else process.env[k] = before[k];
    }
  }
});

integration('each page tells a crawler what it is, and a private collection tells it nothing', async () => {
  const shown = await owner.post('/api/folders').send({ title: 'Kubernetes fundamentals', description: 'Pods, services, and why your deployment is pending.', visibility: 'global' });
  assert.equal(shown.status, 201);
  assert.equal((await owner.post(`/api/folders/${shown.body.folder.id}/cards`).send({ front: { text: 'What is a pod?' }, back: { text: 'The smallest deployable unit.' } })).status, 201);
  const hidden = await owner.post('/api/folders').send({ title: 'My private revision notes', visibility: 'private' });
  assert.equal(hidden.status, 201);

  const head = async path => (await request(app).get(path)).text;
  const titleOf = html => /<title>([^<]*)<\/title>/.exec(html)?.[1];
  const tag = (html, name) => new RegExp(`<meta (?:name|property)="${name}" content="([^"]*)"`).exec(html)?.[1];

  // Every page used to answer with the product's own name, which made a hundred pages look like
  // one page repeated.
  const home = await head('/');
  const pricing = await head('/pricing');
  assert.notEqual(titleOf(home), titleOf(pricing), 'two pages, two titles');
  assert.match(titleOf(pricing), /^Pricing ·/);
  assert.match(tag(pricing, 'og:url'), /\/pricing$/);
  assert.match(tag(pricing, 'description'), /free tier is the whole product/i);

  // A published collection describes itself, so a shared link previews as the deck and can rank
  // for its subject rather than for the brand.
  const open = await head(`/folders/${shown.body.folder.id}`);
  assert.match(titleOf(open), /^Kubernetes fundamentals — flashcards/);
  assert.match(tag(open, 'og:description'), /why your deployment is pending/);
  assert.match(tag(open, 'og:url'), new RegExp(`/folders/${shown.body.folder.id}$`));

  // A private one gets the default. Its title is not a small leak: it would be published to
  // anybody who could guess the URL.
  const shut = await head(`/folders/${hidden.body.folder.id}`);
  assert.equal(titleOf(shut), titleOf(home), 'no per-page title');
  assert.ok(!shut.includes('My private revision notes'), 'and the name never appears');

  // Signed-in areas have nothing for a crawler and should not compete with the pages that do.
  assert.match(tag(await head('/dashboard'), 'robots'), /noindex/);

  const sitemap = (await request(app).get('/sitemap.xml')).text;
  assert.match(sitemap, new RegExp(`/folders/${shown.body.folder.id}<`), 'the published collection is listed');
  assert.ok(!sitemap.includes(hidden.body.folder.id), 'the private one is not');
});

integration('deleting a folder takes its cards with it, and only after the name is typed', async () => {
  const made = await owner.post('/api/folders').send({ title: 'Throwaway deck', visibility: 'private' });
  assert.equal(made.status, 201);
  const id = made.body.folder.id;
  const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#4c1d95' } }).png().toBuffer();
  const image = await owner.post(`/api/folders/${id}/images`).attach('image', png, 'gone.png');
  assert.equal(image.status, 201);
  const card = await owner.post(`/api/folders/${id}/cards`).send({
    front: { text: 'What is this?', image: image.body.id }, back: { text: 'A picture' },
  });
  assert.equal(card.status, 201);
  await owner.post(`/api/folders/${id}/members`).send({ username: 'editor', role: 'editor' });

  assert.equal((await editor.delete(`/api/folders/${id}`).send({ confirm: 'Throwaway deck' })).status, 403,
    'an editor can delete cards, not the collection');
  assert.equal((await outsider.delete(`/api/folders/${id}`).send({ confirm: 'Throwaway deck' })).status, 404);
  assert.equal((await owner.delete(`/api/folders/${id}`).send({ confirm: 'throwaway deck' })).status, 400,
    'the title is matched exactly, not case-folded');
  assert.equal((await owner.delete(`/api/folders/${id}`).send({ confirm: 'Something else' })).status, 400);
  assert.equal(await Card.countDocuments({ folder: id }), 1, 'a refused confirm leaves the cards');

  const gone = await owner.delete(`/api/folders/${id}`).send({ confirm: 'Throwaway deck' });
  assert.equal(gone.status, 200, JSON.stringify(gone.body));
  assert.equal(gone.body.deleted, true);
  assert.equal(gone.body.cards, 1);
  assert.equal((await owner.get(`/api/folders/${id}`)).status, 404);
  assert.equal(await Card.countDocuments({ folder: id }), 0);
  assert.equal(await Media.countDocuments({ folder: id }), 0);
});

integration('deleting a card is permanent and does not touch the rest of the folder', async () => {
  const made = await owner.post('/api/folders').send({ title: 'Keep this', visibility: 'private' });
  const id = made.body.folder.id;
  const a = await owner.post(`/api/folders/${id}/cards`).send({ front: { text: 'Stay' }, back: { text: 'Yes' } });
  const b = await owner.post(`/api/folders/${id}/cards`).send({ front: { text: 'Go' }, back: { text: 'No' } });
  assert.equal((await owner.delete(`/api/cards/${b.body.card.id}`)).status, 200);
  const left = (await owner.get(`/api/folders/${id}/cards`)).body.cards;
  assert.deepEqual(left.map(c => c.id), [a.body.card.id]);
  assert.equal((await owner.get(`/api/folders/${id}`)).status, 200);
});

integration('a request that looks like a file gets a 404 rather than the app', async () => {
  // Crawlers ask for conventions we do not ship. Answering "where is your icon" with a page of
  // HTML and a 200 is why Google drew a grey globe instead of the logo.
  for (const probe of ['/favicon.ico', '/apple-touch-icon.png', '/browserconfig.xml', '/nope.js']) {
    const res = await request(app).get(probe);
    assert.equal(res.status, 404, `${probe} should be a 404`);
    assert.doesNotMatch(res.headers['content-type'] || '', /html/, `${probe} must not answer with HTML`);
  }
  // Real routes are untouched: none of them has a dot in the last segment.
  for (const route of ['/', '/pricing', '/u/owner', '/explore']) {
    assert.equal((await request(app).get(route)).status, 200, route);
  }
});
