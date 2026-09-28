import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import mongoose from 'mongoose';
import request from 'supertest';
import { io as connect } from 'socket.io-client';
import * as Y from 'yjs';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { createApp } from '../src/app.js';
import { allModels, CardDoc, User } from '../src/models/index.js';
import { attachRealtime, presence, docs, rooms } from '../src/realtime/index.js';
import { BRAND } from '../../shared/brand.js';
const enabled = process.env.RUN_INTEGRATION === '1';
let mongo, server, io, url, owner, editor, outsider, folderId, cardId;
const password = 'Integration-only-password-2026';
const cookieOf = agent => agent.jar.getCookies({ path: '/', domain: '127.0.0.1', secure: false, script: false }).toValueString();
const client = (agent, origin = url) => connect(url, { transports: ['websocket'], forceNew: true, reconnection: false, extraHeaders: { cookie: agent ? cookieOf(agent) : '', origin } });
const emit = (socket, ...args) => new Promise(resolve => socket.emit(...args, resolve));
const once = (socket, event, filter = () => true, ms = 3000) => new Promise((resolve, reject) => { const t = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), ms); const h = (...a) => { if (filter(...a)) { clearTimeout(t); socket.off(event, h); resolve(a); } }; socket.on(event, h); });
const connected = socket => new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });
before(async () => {
  if (!enabled) return;
  if (!process.env.TEST_MONGODB_URI) mongo = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  await mongoose.connect(process.env.TEST_MONGODB_URI || mongo.getUri(), { dbName: `${BRAND.slug}_rt_${crypto.randomBytes(6).toString('hex')}` });
  await Promise.all(allModels.map(m => m.init()));
  server = http.createServer(createApp()); await new Promise(r => server.listen(0, '127.0.0.1', r)); url = `http://127.0.0.1:${server.address().port}`;
  io = attachRealtime(server, ['http://trusted.example']);
  [owner, editor, outsider] = [request.agent(url), request.agent(url), request.agent(url)];
  for (const [agent, username] of [[owner, 'owner'], [editor, 'editor'], [outsider, 'outsider']]) { const r = await agent.post('/api/auth/signup').send({ username, name: `${username} person`, email: `${username}@example.test`, password, country: 'India' }); assert.equal(r.status, 201, JSON.stringify(r.body)); }
  await User.updateMany({}, { $set: { account: 'premium' } });
  const f = await owner.post('/api/folders').send({ title: 'Live', visibility: 'private' }); folderId = f.body.folder.id;
  const c = await owner.post(`/api/folders/${folderId}/cards`).send({ front: { text: 'Hello' }, back: { text: 'World' } }); cardId = c.body.card.id;
  await owner.post(`/api/folders/${folderId}/members`).send({ username: 'editor', role: 'editor' });
});
after(async () => { if (io) await new Promise(r => io.close(r)); if (server) { server.closeAllConnections(); await new Promise(r => server.close(r)); } if (mongoose.connection.readyState) { await mongoose.connection.dropDatabase(); await mongoose.disconnect(); } if (mongo) await mongo.stop(); });
const integration = (name, fn) => test(name, { skip: !enabled }, fn);
integration('handshake rejects untrusted cross-origin connections and accepts same-origin ones', async () => {
  const bad = client(owner, 'http://evil.example'); await assert.rejects(connected(bad), /xhr poll error|websocket error/i); bad.disconnect();
  const ok = client(owner); await connected(ok); ok.disconnect();
});
integration('joining a folder room enforces the same access rules as HTTP and shows presence', async () => {
  const [o, e, x, anon] = [client(owner), client(editor), client(outsider), client(null)]; await Promise.all([o, e, x, anon].map(connected));
  assert.deepEqual(await emit(x, 'folder:join', folderId), { ok: false, error: 'Folder not found.', code: 'NOT_FOUND' });
  assert.equal((await emit(anon, 'folder:join', folderId)).ok, false, 'anonymous cannot watch a private folder');
  const joined = await emit(o, 'folder:join', folderId); assert.equal(joined.ok, true); assert.equal(joined.presence.length, 1);
  const [, list] = await Promise.all([emit(e, 'folder:join', folderId), once(o, 'presence', (id, l) => id === folderId && l.length === 2)]).then(([, [, l]]) => [null, l]);
  assert.deepEqual(list.map(p => p.user.username).sort(), ['editor', 'owner']);
  e.emit('card:editing', folderId, cardId); const [, editing] = await once(o, 'presence', (id, l) => l.some(p => p.editing === cardId)); assert.equal(editing.find(p => p.user.username === 'editor').editing, cardId);
  e.disconnect(); await once(o, 'presence', (id, l) => l.length === 1);
  for (const s of [o, x, anon]) s.disconnect();
});
integration('committed writes are pushed to the room after the transaction commits, with the new version', async () => {
  const o = client(owner); await connected(o); await emit(o, 'folder:join', folderId);
  const card = (await owner.get(`/api/folders/${folderId}/cards`)).body.cards[0];
  const [res, [event]] = await Promise.all([editor.patch(`/api/cards/${cardId}`).send({ front: { text: 'Hello there' }, back: { text: 'World' }, version: card.version }), once(o, 'folder:event', e => e.type === 'card.updated')]);
  assert.equal(res.status, 200); assert.equal(event.folderId, folderId); assert.equal(event.aggregateId, cardId); assert.equal(event.version, res.body.card.version); assert.equal(event.actor.username, 'editor'); assert.equal(event.detail, 'Hello there');
  // A rejected write (stale version) commits nothing, so nothing is broadcast.
  let leaked = false; o.on('folder:event', () => { leaked = true; });
  assert.equal((await editor.patch(`/api/cards/${cardId}`).send({ front: { text: 'Stale' }, back: { text: 'World' }, version: card.version })).status, 409);
  await new Promise(r => setTimeout(r, 150)); assert.equal(leaked, false); o.disconnect();
});
integration('two editors co-edit a card through the shared CRDT document with cursors relayed; viewers are refused', async () => {
  await owner.post(`/api/folders/${folderId}/members`).send({ username: 'outsider', role: 'viewer' });
  const [a, b, v] = [client(owner), client(editor), client(outsider)]; await Promise.all([a, b, v].map(connected));
  assert.equal((await emit(v, 'doc:join', cardId)).error, 'You need editor access to co-edit.');
  const ja = await emit(a, 'doc:join', cardId); assert.equal(ja.ok, true);
  const da = new Y.Doc(); Y.applyUpdate(da, new Uint8Array(ja.state)); assert.equal(da.getText('front').toString(), 'Hello there', 'seeded from the authoritative card text');
  const [jb] = await Promise.all([emit(b, 'doc:join', cardId), once(a, 'doc:peer-joined')]); const db = new Y.Doc(); Y.applyUpdate(db, new Uint8Array(jb.state));
  da.on('update', u => a.emit('doc:update', cardId, u)); db.on('update', u => b.emit('doc:update', cardId, u));
  a.on('doc:update', (id, u) => Y.applyUpdate(da, new Uint8Array(u), 'remote')); b.on('doc:update', (id, u) => Y.applyUpdate(db, new Uint8Array(u), 'remote'));
  const gotB = once(b, 'doc:update'), gotA = once(a, 'doc:update');
  da.getText('front').insert(11, '!'); db.getText('front').insert(0, 'Oh. '); await Promise.all([gotA, gotB]); await new Promise(r => setTimeout(r, 50));
  assert.equal(da.getText('front').toString(), 'Oh. Hello there!'); assert.equal(db.getText('front').toString(), da.getText('front').toString()); assert.equal(docs.text(cardId, 'front'), 'Oh. Hello there!');
  const awareness = new Uint8Array([1, 2, 3]); const [, relayed] = await Promise.all([a.emit('doc:awareness', cardId, awareness), once(b, 'doc:awareness')]).then(([, [, u]]) => [null, u]); assert.deepEqual(new Uint8Array(relayed), awareness);
  // Saving through HTTP writes the merged text into the versioned Card, so history and conflict detection still apply.
  const card = (await owner.get(`/api/folders/${folderId}/cards`)).body.cards[0];
  const saved = await owner.patch(`/api/cards/${cardId}`).send({ front: { text: da.getText('front').toString() }, back: { text: 'World' }, version: card.version }); assert.equal(saved.status, 200); assert.equal(saved.body.card.front.text, 'Oh. Hello there!');
  a.disconnect(); await new Promise(r => setTimeout(r, 30)); assert.ok(docs.docs.has(cardId), 'doc stays open while an editor remains'); b.disconnect();
  for (let i = 0; i < 40 && docs.docs.has(cardId); i++) await new Promise(r => setTimeout(r, 25));
  assert.equal(docs.docs.has(cardId), false, 'evicted when the last editor leaves'); assert.ok(await CardDoc.findOne({ card: cardId }), 'CRDT state persisted'); v.disconnect();
});
integration('revoking a member ejects their sockets from the room and their open documents', async () => {
  const e = client(editor); await connected(e); assert.equal((await emit(e, 'folder:join', folderId)).ok, true); assert.equal((await emit(e, 'doc:join', cardId)).ok, true);
  const [[revokedId]] = await Promise.all([once(e, 'folder:revoked'), owner.post(`/api/folders/${folderId}/members`).send({ username: 'editor', role: 'remove' })]);
  assert.equal(revokedId, folderId); assert.equal(presence.list(folderId).some(p => p.user.username === 'editor'), false);
  for (let i = 0; i < 40 && docs.docs.has(cardId); i++) await new Promise(r => setTimeout(r, 25)); assert.equal(docs.docs.has(cardId), false);
  let leaked = false; e.on('folder:event', () => { leaked = true; }); await owner.post(`/api/folders/${folderId}/cards`).send({ front: { text: 'Secret' }, back: { text: 'x' } }); await new Promise(r => setTimeout(r, 150)); assert.equal(leaked, false); e.disconnect();
});
integration('a live quiz room: host needs folder access, players need to be signed in, answers are scored and the key is withheld until reveal', async () => {
  // The folder has two cards by now ("Oh. Hello there!"/"World" and "Secret"/"x"), the minimum for a quiz.
  const [h, p, x, anon] = [client(owner), client(outsider), client(editor), client(null)]; await Promise.all([h, p, x, anon].map(connected));
  assert.equal((await emit(anon, 'room:create', folderId, {})).error, 'Sign in to play.');
  assert.equal((await emit(x, 'room:create', folderId, {})).error, 'Folder not found.', 'the removed editor cannot host from this folder (private folders 404 for strangers)');
  const created = await emit(h, 'room:create', folderId, { count: 2, seconds: 5 }); assert.equal(created.ok, true, JSON.stringify(created)); const code = created.code;
  assert.match(code, /^[A-Z0-9]{6}$/); assert.equal(created.room.phase, 'lobby'); assert.equal(created.room.total, 2);
  assert.equal((await emit(anon, 'room:join', code)).error, 'Sign in to play.'); assert.match((await emit(p, 'room:join', 'NOPE00')).error, /Room not found/);
  const [joined, [hostView]] = await Promise.all([emit(p, 'room:join', code.toLowerCase()), once(h, 'room:state', r => r.players.length === 2)]);
  assert.equal(joined.ok, true); assert.deepEqual(hostView.players.map(pl => pl.username).sort(), ['outsider', 'owner']); assert.equal(hostView.players.find(pl => pl.isHost).username, 'owner');
  assert.equal((await emit(p, 'room:start', code)).error, 'Only the host can do that.');
  const [, [q]] = await Promise.all([emit(h, 'room:start', code), once(p, 'room:state', r => r.phase === 'question')]);
  assert.equal(q.question.correct, null, 'answer key hidden while the question is open'); assert.equal(q.question.options.length, 2); assert.ok(q.deadline > Date.now());
  const key = rooms.get(code).questions[0].correct;
  p.emit('room:answer', code, key); const [mine] = await once(p, 'room:state', r => r.myAnswer); assert.equal(mine.myAnswer.correct, null, 'not even your own verdict leaks early');
  const [, [revealed]] = await Promise.all([h.emit('room:answer', code, (key + 1) % 2), once(p, 'room:state', r => r.phase === 'reveal')]);
  assert.equal(revealed.question.correct, key); assert.equal(revealed.myAnswer.correct, true); assert.ok(revealed.myAnswer.points >= 500); assert.equal(revealed.players[0].username, 'outsider'); assert.equal(revealed.results[revealed.hostId].correct, false);
  await emit(h, 'room:next', code); await emit(h, 'room:next', code); // reveal -> question 2; a second "next" is ignored while a question is open
  assert.equal(rooms.get(code).phase, 'question'); assert.equal(rooms.get(code).index, 1);
  rooms.reveal(code); const [, [done]] = await Promise.all([emit(h, 'room:next', code), once(p, 'room:state', r => r.phase === 'finished')]); assert.equal(done.players.length, 2);
  h.disconnect(); p.disconnect(); for (let i = 0; i < 40 && rooms.get(code); i++) await new Promise(r => setTimeout(r, 25)); assert.equal(rooms.get(code), undefined, 'room closed when the last player left');
  x.disconnect(); anon.disconnect();
});
