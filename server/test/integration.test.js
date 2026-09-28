import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import request from 'supertest';
import sharp from 'sharp';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { connectDatabase } from '../src/config/database.js';
import { createApp } from '../src/app.js';
import { allModels, Review, User, Notification, Relationship, PremiumOrder, Team } from '../src/models/index.js';
import { premiumPrice, seatPrice } from '../../shared/pricing.js';
import { BRAND } from '../../shared/brand.js';
const enabled = process.env.RUN_INTEGRATION === '1';
let mongo, app, owner, editor, outsider, folderId, cardId;
const password = 'Integration-only-password-2026';
before(async () => {
  if (!enabled) return;
  // The UPI-transfer flow is retired in the product but still has to work for the old orders an
  // admin can be asked to settle, so these tests keep exercising it.
  process.env.MANUAL_PAYMENT = 'on';
  const dbName = `${BRAND.slug}_test_${crypto.randomBytes(6).toString('hex')}`;
  if (!process.env.TEST_MONGODB_URI) mongo = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  await mongoose.connect(process.env.TEST_MONGODB_URI || mongo.getUri(), { dbName });
  await Promise.all(allModels.map(m => m.init())); app = createApp();
  [owner, editor, outsider] = [request.agent(app), request.agent(app), request.agent(app)];
  for (const [agent, username] of [[owner, 'owner'], [editor, 'editor'], [outsider, 'outsider']]) { const r = await agent.post('/api/auth/signup').send({ username, name: username, email: `${username}@example.test`, password, country: 'India' }); assert.equal(r.status, 201, JSON.stringify(r.body)); }
  // Paying needs a confirmed address; these tests are about what happens after that, not about it.
  await User.updateMany({}, { $set: { account: 'premium', emailVerifiedAt: new Date() } });
  const f = await owner.post('/api/folders').send({ title: 'Concurrency', visibility: 'private' }); assert.equal(f.status, 201); folderId = f.body.folder.id;
  const c = await owner.post(`/api/folders/${folderId}/cards`).send({ front: { text: 'Q' }, back: { text: 'A' } }); assert.equal(c.status, 201); cardId = c.body.card.id;
});
after(async () => { if (mongoose.connection.readyState) { await mongoose.connection.dropDatabase(); await mongoose.disconnect(); } if (mongo) await mongo.stop(); delete process.env.MANUAL_PAYMENT; });
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
  const results = await Promise.all(['UniqueLearner', 'uniquelearner'].map((username, i) => request(app).post('/api/auth/signup').send({ username, name: 'Test', email: `unique${i}@example.test`, password, country: 'India' })));
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
  const png = await sharp({ create: { width: 16, height: 16, channels: 3, background: '#22aa66' } }).png().toBuffer();
  const order = () => outsider.post('/api/premium/order').field('name', 'Out Sider').field('phone', '+919999999999').field('country', 'India').field('address', '1 Demo Street');
  assert.equal((await order().field('plan', 'galactic').attach('proof', png, 'upi.png')).status, 400, 'an unknown plan is rejected');
  const buy = await order().field('plan', 'monthly').attach('proof', png, 'upi.png');
  assert.equal(buy.status, 201, JSON.stringify(buy.body));
  assert.equal(buy.body.order.plan, 'monthly');
  assert.equal(buy.body.order.currency, 'INR', 'an Indian account is billed in rupees');
  assert.equal(buy.body.order.amount, premiumPrice('monthly', { country: 'India' }) * 100);
  assert.equal((await outsider.get(`/api/premium/orders/${buy.body.order.id}/proof`)).status, 200);

  // The same plan, bought from abroad, is a different currency and a different number. The billing
  // country typed into the form is deliberately still India here: it is the account that prices the
  // order, so filling in a cheaper country must not buy a cheaper plan.
  await PremiumOrder.deleteMany({ user: (await User.findOne({ username: 'outsider' }))._id });
  await User.updateOne({ username: 'outsider' }, { $set: { country: 'United States', account: 'normal', premiumPlan: '', premiumExpiresAt: null } });
  const abroad = await order().field('plan', 'monthly').attach('proof', png, 'upi.png');
  assert.equal(abroad.status, 201, JSON.stringify(abroad.body));
  assert.equal(abroad.body.order.currency, 'USD');
  assert.equal(abroad.body.order.amount, premiumPrice('monthly', { country: 'United States' }) * 100, 'in cents');
  assert.notEqual(abroad.body.order.amount, buy.body.order.amount);
  // Somewhere we do not sell cannot buy at all, however the request is dressed up. The billing
  // country below still says India, which is exactly the loophole this closes.
  await PremiumOrder.deleteMany({ user: (await User.findOne({ username: 'outsider' }))._id });
  await User.updateOne({ username: 'outsider' }, { $set: { country: 'Nigeria', account: 'normal', premiumPlan: '', premiumExpiresAt: null } });
  const refused = await order().field('plan', 'monthly').attach('proof', png, 'upi.png');
  assert.equal(refused.status, 400, JSON.stringify(refused.body));
  assert.equal(refused.body.code, 'COUNTRY_UNSUPPORTED', JSON.stringify(refused.body));
  assert.equal(await PremiumOrder.countDocuments({ user: (await User.findOne({ username: 'outsider' }))._id }), 0, 'a refusal leaves no order behind');

  await User.updateOne({ username: 'outsider' }, { $set: { country: 'India' } });
  await order().field('plan', 'monthly').attach('proof', png, 'upi.png');
  assert.equal((await outsider.post('/api/premium/order').send({ plan: 'monthly', name: 'No Photo', phone: '+919999999999', country: 'India', address: '1 Demo Street' })).status, 400);
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
    const r = await agent.post('/api/auth/signup').send({ username, name: username, email: `${username}@example.test`, password, country: 'India' });
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
  const seatRate = seatPrice('team-monthly', { country: 'India' });
  assert.equal(quoted.body.amount, seatRate * 6);
  assert.equal(quoted.body.currency, 'INR', 'quoted in the owner\'s own currency');

  const png = await sharp({ create: { width: 16, height: 16, channels: 3, background: '#4455cc' } }).png().toBuffer();
  const buy = await teacher.post(`/api/teams/${teamId}/order`)
    .field('plan', 'team-monthly').field('seats', '6').field('name', 'Teach Er').field('email', 'teach@example.test')
    .field('phone', '+919999999999').field('country', 'India').field('address', '1 School Road').attach('proof', png, 'upi.png');
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
    const up = await agent.post('/api/auth/signup').send({ username, name: username, email: `${username}@example.test`, password, country: 'India' });
    assert.equal(up.status, 201, JSON.stringify(up.body));
    extras.push(agent);
  }
  for (const agent of extras.slice(0, 3)) assert.equal((await agent.post('/api/teams/join').send({ code })).status, 201);
  const full = await teacher.get(`/api/teams/${teamId}`);
  assert.equal(full.body.team.memberCount, 5);
  assert.equal(full.body.team.seatsLeft, 1);

  const racers = [extras[3], request.agent(app)];
  await racers[1].post('/api/auth/signup').send({ username: 'stu5', name: 'stu5', email: 'stu5@example.test', password, country: 'India' });
  const settled = await Promise.all(racers.map(a => a.post('/api/teams/join').send({ code })));
  const won = settled.filter(r => r.status === 201);
  assert.equal(won.length, 1, `exactly one racer takes the last seat, got ${settled.map(r => r.status).join()}`);
  assert.equal(settled.find(r => r.status !== 201).body.code, 'NO_SEATS');
  const after = await teacher.get(`/api/teams/${teamId}`);
  assert.equal(after.body.team.memberCount, 6, 'the roster never exceeds the seats that were paid for');
  assert.equal(after.body.team.seatsLeft, 0);

  // Extra seats bought right after paying cost full price, because no time has been used up yet.
  const perSeat = seatPrice('team-monthly', { country: 'India' });
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

  const duplicate = await request(app).post('/api/auth/signup').send({ username: 'owner', name: 'Clash', email: 'clash@example.test', password, country: 'India' });
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

