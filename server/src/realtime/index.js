import { Server } from 'socket.io';
import { Session, User, Card, CardDoc } from '../models/index.js';
import { hashToken } from '../middleware/auth.js';
import { accessFolder } from '../services/accessService.js';
import { requireFolderPremium } from '../services/teamAccess.js';
import { onEvent } from './bus.js';
import { PresenceStore } from './presence.js';
import { DocStore } from './docs.js';
import { RoomStore } from './rooms.js';
import { notifications, presentNotification } from '../services/notificationService.js';
import { toAppError, GENERIC } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { sessionCookieNames } from '../../../shared/brand.js';
/**
 * Sockets answer with `{ ok, error }` instead of HTTP statuses, so failures run through the same
 * classifier and only exposed messages are sent back. `translate` lets a handler keep the wording
 * the UI already expects for a given status.
 */
const reply = (event, ack, translate) => error => {
  const app = toAppError(error);
  if (app.status >= 500) logger.error(app.cause?.message || app.message, { event, stack: (app.cause || error)?.stack });
  ack({ ok: false, error: translate?.(app) || (app.expose ? app.message : GENERIC), code: app.code });
};
const parseCookies = header => Object.fromEntries((header || '').split(';').map(p => p.trim().split('=')).filter(([k]) => k).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));
const same = (origin, host) => { try { return !!origin && new URL(origin).host === host; } catch { return false; } };
export const presence = new PresenceStore();
export const docs = new DocStore({
  load: async cardId => { const d = await CardDoc.findOne({ card: cardId }).select('+state'); return d ? { state: d.state, updatedAt: d.updatedAt } : null; },
  save: (cardId, state) => CardDoc.updateOne({ card: cardId }, { $set: { state } }, { upsert: true })
});
export const rooms = new RoomStore();
/** Attaches the realtime layer to the HTTP server. Sockets only observe; every mutation still goes through HTTP + transactions. */
export function attachRealtime(httpServer, origins) {
  const io = new Server(httpServer, {
    cors: { origin: true, credentials: true },
    allowRequest: (req, cb) => { const o = req.headers.origin; cb(null, !o || origins.includes(o) || same(o, req.headers.host)); },
    maxHttpBufferSize: 256 * 1024, pingInterval: 20000, pingTimeout: 25000
  });
  // Authenticate from the same HttpOnly session cookie the API uses. Anonymous sockets may watch public folders.
  io.use(async (socket, next) => {
    try { const cookies = parseCookies(socket.handshake.headers.cookie); const token = sessionCookieNames.map(n => cookies[n]).find(Boolean); if (token) { const s = await Session.findOne({ tokenHash: hashToken(token), expiresAt: { $gt: new Date() } }); if (s) socket.data.user = await User.findById(s.user); } next(); } catch (e) { next(e); }
  });
  const room = id => `folder:${id}`, docRoom = id => `doc:${id}`, quizRoom = code => `quiz:${code}`;
  const broadcastPresence = folderId => io.to(room(folderId)).emit('presence', folderId, presence.list(folderId));
  // Channel: push a stored notification to every tab the recipient has open.
  notifications.subscribe(function realtimeChannel(event) {
    if (!event.stored) return;
    io.to(`user:${event.to}`).emit('notification', presentNotification(event.stored, event.actor));
  });
  io.on('connection', socket => {
    socket.data.docs = new Map();
    if (socket.data.user) socket.join(`user:${socket.data.user.id}`);
    socket.on('folder:join', async (folderId, ack = () => {}) => {
      try { const folder = await accessFolder(folderId, socket.data.user); socket.join(room(folderId)); if (socket.data.user) { presence.join(folderId, socket.id, socket.data.user); broadcastPresence(folderId); } ack({ ok: true, presence: presence.list(folderId), version: folder.version }); }
      catch (e) { reply('folder:join', ack, a => a.status === 404 ? 'Folder not found.' : 'No access.')(e); }
    });
    socket.on('folder:leave', folderId => { socket.leave(room(folderId)); presence.leave(folderId, socket.id); broadcastPresence(folderId); });
    socket.on('card:editing', (folderId, cardId) => { if (presence.setEditing(folderId, socket.id, cardId)) broadcastPresence(folderId); });
    socket.on('doc:join', async (cardId, ack = () => {}) => {
      try {
        const card = await Card.findById(cardId); if (!card) throw new Error('Card not found.');
        await accessFolder(card.folder, socket.data.user, 'editor');
        const doc = await docs.acquire(cardId, card); socket.data.docs.set(cardId, String(card.folder)); socket.join(docRoom(cardId));
        socket.to(docRoom(cardId)).emit('doc:peer-joined', cardId); // existing peers re-announce awareness for the newcomer
        ack({ ok: true, state: Buffer.from(docs.state(cardId) || new Uint8Array()) , version: card.version });
      } catch (e) { reply('doc:join', ack, a => a.status === 403 ? 'You need editor access to co-edit.' : 'Card not found.')(e); }
    });
    socket.on('doc:update', (cardId, update) => { if (!socket.data.docs.has(cardId) || !update) return; if (docs.apply(cardId, update)) socket.to(docRoom(cardId)).emit('doc:update', cardId, update); });
    socket.on('doc:awareness', (cardId, update) => { if (socket.data.docs.has(cardId) && update) socket.to(docRoom(cardId)).emit('doc:awareness', cardId, update); });
    const leaveDoc = async cardId => { if (!socket.data.docs.has(cardId)) return; socket.data.docs.delete(cardId); socket.leave(docRoom(cardId)); socket.to(docRoom(cardId)).emit('doc:peer-left', cardId, socket.id); await docs.release(cardId); };
    socket.on('doc:leave', leaveDoc);
    // Live quiz rooms. Only signed-in users can play (players need a name and a stable id); the host needs read access to the folder.
    socket.data.rooms = new Set();
    const signedIn = ack => { if (socket.data.user) return true; ack({ ok: false, error: 'Sign in to play.' }); return false; };
    const enterRoom = code => { socket.data.rooms.add(code); socket.join(quizRoom(code)); };
    socket.on('room:create', async (folderId, options = {}, ack = () => {}) => {
      if (!signedIn(ack)) return;
      try {
        const folder = await accessFolder(folderId, socket.data.user);
        // A teacher can run a quiz on their class's own folders without a personal subscription.
        await requireFolderPremium(socket.data.user, folder, 'Hosting a live quiz');
        const cards = await Card.find({ folder: folder.id }).select('front back').lean();
        const room = rooms.create({ folder, host: socket.data.user, cards: cards.map(c => ({ ...c, id: c._id })), count: options?.count, seconds: options?.seconds });
        enterRoom(room.code); ack({ ok: true, code: room.code, room: rooms.snapshot(room.code, socket.data.user.id) });
      } catch (e) { reply('room:create', ack, a => a.status === 400 || a.status === 402 ? a.message : a.status === 404 ? 'Folder not found.' : 'No access.')(e); }
    });
    socket.on('room:join', (code, ack = () => {}) => {
      if (!signedIn(ack)) return;
      try { const room = rooms.join(code, socket.data.user); enterRoom(room.code); ack({ ok: true, code: room.code, room: rooms.snapshot(room.code, socket.data.user.id) }); }
      catch (e) { reply('room:join', ack)(e); }
    });
    const leaveRoom = code => { if (!socket.data.rooms.has(code)) return; socket.data.rooms.delete(code); socket.leave(quizRoom(code)); rooms.leave(code, socket.data.user?.id); };
    socket.on('room:leave', leaveRoom);
    const hostAction = (event, fn) => (code, ack = () => {}) => { if (!socket.data.rooms.has(code)) return; try { fn(code); ack({ ok: true }); } catch (e) { reply(event, ack)(e); } };
    socket.on('room:start', hostAction('room:start', code => rooms.start(code, socket.data.user.id)));
    socket.on('room:next', hostAction('room:next', code => rooms.next(code, socket.data.user.id)));
    socket.on('room:answer', (code, choice) => { if (socket.data.rooms.has(code)) rooms.answer(code, socket.data.user.id, choice); });
    socket.on('disconnect', async () => { for (const f of presence.drop(socket.id)) broadcastPresence(f); for (const cardId of [...socket.data.docs.keys()]) await leaveDoc(cardId); for (const code of [...socket.data.rooms]) leaveRoom(code); });
  });
  // Room state is broadcast whole on every change; each socket gets a view with its own answer and without the answer key mid-question.
  rooms.onChange(room => { for (const socketId of io.sockets.adapter.rooms.get(quizRoom(room.code)) || []) { const s = io.sockets.sockets.get(socketId); if (s) s.emit('room:state', rooms.snapshot(room.code, s.data.user?.id)); } });
  // Committed domain events fan out to everyone watching the folder. Membership changes re-check every watcher's access.
  onEvent(async event => {
    io.to(room(event.folderId)).emit('folder:event', event);
    if (event.type !== 'folder.members.changed' && event.type !== 'folder.updated' && event.type !== 'folder.deleted') return;
    for (const socketId of [...(io.sockets.adapter.rooms.get(room(event.folderId)) || [])]) {
      const socket = io.sockets.sockets.get(socketId); if (!socket) continue;
      try { await accessFolder(event.folderId, socket.data.user); } catch {
        socket.leave(room(event.folderId)); presence.leave(event.folderId, socket.id);
        for (const [cardId, folderId] of [...socket.data.docs]) if (folderId === event.folderId) { socket.data.docs.delete(cardId); socket.leave(docRoom(cardId)); await docs.release(cardId); }
        socket.emit('folder:revoked', event.folderId);
      }
    }
    broadcastPresence(event.folderId);
  });
  return io;
}
