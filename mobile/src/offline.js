import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';
import { api } from './api';
import { uuid } from './uuid';
import { isPending, pendingUri, uploadStaged } from './upload';
import { embedLine, NOTE_LIMITS } from '../../shared/notes.js';
import { BRAND } from '../../shared/brand.js';

/**
 * Working without a connection.
 *
 * Two halves that work together:
 *
 * 1. A read cache. Every list or page the app has fetched is kept on the phone, so the library,
 *    a folder's cards and a notebook open with no signal, showing what was last seen.
 * 2. A write queue. Creating, editing and deleting cards (and creating or editing a note page) is
 *    written to the phone first and sent to the server when it can be reached. Screens show the
 *    queued changes laid over the server's data, so a card made on a train is already in its folder.
 *
 * Safety. Every create carries a key the server remembers (`Idempotency-Key`), so a send that is
 * repeated after a lost reply returns the same card instead of a second one. Edits carry the
 * version they started from; if somebody changed the card in between, the server refuses and the
 * edit waits in "needs attention" for the person to keep or discard, never silently overwriting.
 * Changes are sent strictly in the order they were made, and the queue belongs to one account.
 */

const MAX_CACHE = 120, SETTLE_MS = 8000;
const CACHEABLE = [/^\/folders$/, /^\/folders\/[^/?]+$/, /^\/folders\/[^/?]+\/cards$/, /^\/stats$/, /^\/notebooks$/, /^\/notebooks\/[^/?]+$/, /^\/notes\/[^/?]+$/];
const opsKey = u => `${BRAND.slug}.ops.${u}`, indexKey = u => `${BRAND.slug}.cacheindex.${u}`, cacheKey = (u, p) => `${BRAND.slug}.cache.${u}.${p}`;

let user = null, ops = [], failed = [], index = [], offline = false, timer = null, running = null, backoff = 0;
const waiters = new Map(), listeners = new Set();
const emit = event => listeners.forEach(fn => fn(event));
export const subscribe = fn => { listeners.add(fn); return () => listeners.delete(fn); };
const persist = () => (user ? AsyncStorage.setItem(opsKey(user), JSON.stringify({ ops, failed })).catch(() => {}) : Promise.resolve());
const status = extra => emit({ pending: ops.length, failed: failed.length, offline, ...extra });

export const isLocal = id => String(id).startsWith('local:');
const localId = op => `local:${op.id}`;
const opFor = id => ops.find(o => localId(o) === id);

export const pendingChanges = () => ops.length;
export const needsAttention = () => failed.length;
export const isOffline = () => offline;
export const queued = () => ops.map(o => ({ ...o }));
export const problems = () => failed.map(o => ({ ...o }));

function setOffline(value) { if (offline !== value) { offline = value; status(); } }

/** Called when the signed-in person changes. The queue and the cache are kept per account. */
export async function bindUser(id) {
  if (id === user) return;
  clearTimeout(timer);
  user = id; ops = []; failed = []; index = []; backoff = 0;
  if (!user) { status(); return; }
  try {
    const saved = JSON.parse((await AsyncStorage.getItem(opsKey(user))) || '{}');
    // Anything that was mid-send when the app closed is sent again; creates are safe to repeat.
    ops = (Array.isArray(saved.ops) ? saved.ops : []).map(o => ({ ...o, inflight: false }));
    failed = Array.isArray(saved.failed) ? saved.failed : [];
    index = JSON.parse((await AsyncStorage.getItem(indexKey(user))) || '[]');
  } catch { ops = []; failed = []; index = []; }
  status({ invalidate: ['*'] });
  if (ops.length) schedule(0);
}

/** Forget what was cached for the account on this phone (signing out). Waiting changes stay for next time. */
export async function wipeCache() {
  if (!user) return;
  const paths = index; index = [];
  await Promise.all([...paths.map(p => AsyncStorage.removeItem(cacheKey(user, p))), AsyncStorage.removeItem(indexKey(user))]).catch(() => {});
}

/** Everything, including waiting changes: deleting the account. */
export async function discardAll() {
  if (!user) return;
  await wipeCache();
  await AsyncStorage.removeItem(opsKey(user)).catch(() => {});
  ops = []; failed = []; status();
}

async function cachePut(path, data) {
  if (!user) return;
  try {
    await AsyncStorage.setItem(cacheKey(user, path), JSON.stringify(data));
    index = [path, ...index.filter(p => p !== path)];
    for (const old of index.splice(MAX_CACHE)) AsyncStorage.removeItem(cacheKey(user, old)).catch(() => {});
    AsyncStorage.setItem(indexKey(user), JSON.stringify(index)).catch(() => {});
  } catch { /* storage full or unavailable: the app simply works online only for this one */ }
}

async function cacheGet(path) {
  if (!user) return null;
  try { const raw = await AsyncStorage.getItem(cacheKey(user, path)); return raw ? JSON.parse(raw) : null; } catch { return null; }
}

/* ------------------------------------------------------------------ queued changes laid over data */

const blankProgress = { version: 0, repetitions: 0, interval: 0, bookmarked: false, dueAt: null, state: 'new', retrievability: null, preview: null };
const cardFields = ({ front, back, hint, tags, source }) => ({ front, back, hint, tags, source });
const localCard = o => ({ id: localId(o), ...cardFields(o.body), version: 0, pending: true, progress: blankProgress });

function overlay(path, data) {
  let m;
  if ((m = path.match(/^\/folders\/([^/?]+)\/cards$/)) && data) {
    let cards = [...data.cards];
    for (const o of ops.filter(x => x.folderId === m[1])) {
      if (o.type === 'card.create' && !o.inflight) cards.push(localCard(o));
      else if (o.type === 'card.update') cards = cards.map(c => (c.id === o.cardId ? { ...c, ...cardFields(o.body), pending: true } : c));
      else if (o.type === 'card.delete') cards = cards.filter(c => c.id !== o.cardId);
    }
    return { ...data, cards };
  }
  if ((m = path.match(/^\/folders\/([^/?]+)$/)) && data?.folder) {
    const mine = ops.filter(x => x.folderId === m[1]);
    const delta = mine.filter(o => o.type === 'card.create' && !o.inflight).length - mine.filter(o => o.type === 'card.delete').length;
    return delta ? { ...data, folder: { ...data.folder, cardCount: Math.max(0, (data.folder.cardCount || 0) + delta) } } : data;
  }
  if ((m = path.match(/^\/notebooks\/([^/?]+)$/)) && data) {
    const fresh = ops.filter(o => o.type === 'note.create' && o.notebookId === m[1] && !o.inflight)
      .map(o => ({ id: localId(o), title: o.body.title || 'Untitled page', snippet: o.body.text.slice(0, 140), pending: true }));
    return fresh.length ? { ...data, notes: [...fresh, ...(data.notes || [])] } : data;
  }
  if ((m = path.match(/^\/notes\/([^/?]+)$/))) {
    if (isLocal(m[1])) {
      const o = opFor(m[1]);
      return o ? { note: { id: m[1], title: o.body.title, body: o.body.text, version: 0, pending: true, pendingPhotos: o.body.photos.filter(isPending) }, role: 'owner' } : null;
    }
    if (data?.note) {
      const edits = ops.filter(o => o.type === 'note.update' && o.noteId === m[1]);
      if (edits.length) { const last = edits[edits.length - 1]; return { ...data, note: { ...data.note, title: last.body.title, body: last.body.body, pending: true } }; }
    }
  }
  return data;
}

/**
 * GET a path, remembering the answer, and with queued changes laid on top. With no connection the
 * remembered answer is used (`stale: true`); only a path never seen before fails.
 */
export async function cachedApi(path) {
  if (!CACHEABLE.some(re => re.test(path))) return api(path);
  try {
    const data = await api(path);
    cachePut(path, data); setOffline(false);
    return overlay(path, data);
  } catch (e) {
    if (e.code !== 'NETWORK') throw e;
    setOffline(true);
    const data = overlay(path, await cacheGet(path));
    if (data) return { ...data, stale: true };
    throw e;
  }
}

/** One card, from a folder's list (remembered or live), or from the change that is still waiting to create it. */
export async function findCard(folderId, cardId) {
  if (isLocal(cardId)) { const o = opFor(cardId); return o ? localCard(o) : null; }
  const { cards } = await cachedApi(`/folders/${folderId}/cards`);
  return cards.find(c => c.id === cardId) || null;
}

/* ------------------------------------------------------------------------------- queueing changes */

const busy = () => Object.assign(new Error('This is still being sent. Try again in a moment.'), { code: 'BUSY' });

function settle(op) {
  return new Promise((resolve, reject) => {
    waiters.set(op.id, { resolve, reject, timer: setTimeout(() => finish(op.id, null, { status: 'queued' }), SETTLE_MS) });
    flush();
  });
}

function finish(id, error, value) {
  const w = waiters.get(id);
  if (!w) return false;
  waiters.delete(id); clearTimeout(w.timer);
  if (error) w.reject(error); else w.resolve(value);
  return true;
}

function add(op) {
  ops.push({ ...op, at: Date.now(), inflight: false });
  persist(); status({ invalidate: [op.folderId || op.notebookId || op.noteId] });
  return ops[ops.length - 1];
}

/**
 * Create a card (`cardId` null) or change one. Resolves `{ status: 'synced' | 'queued' }`; rejects
 * with the server's reason if it refused the change (a conflict has `code: 'VERSION_CONFLICT'`).
 */
export async function saveCard({ folderId, cardId, body, version }) {
  if (!cardId) return settle(add({ id: uuid(), type: 'card.create', folderId, body, key: uuid() }));
  if (isLocal(cardId)) {
    const op = opFor(cardId);
    if (!op) throw new Error('This card was already sent. Open it again from the folder.');
    if (op.inflight) throw busy();
    op.body = body; persist(); status({ invalidate: [folderId] });
    return settle(op);
  }
  const mine = ops.filter(o => o.type === 'card.update' && o.cardId === cardId), last = mine[mine.length - 1];
  if (last && !last.inflight) { last.body = body; persist(); status({ invalidate: [folderId] }); return settle(last); }
  return settle(add({ id: uuid(), type: 'card.update', folderId, cardId, body, version: last ? last.version + 1 : version }));
}

export async function removeCard({ folderId, cardId }) {
  if (isLocal(cardId)) {
    const op = opFor(cardId);
    if (op?.inflight) throw busy();
    ops = ops.filter(o => o !== op); persist(); status({ invalidate: [folderId] });
    return { status: 'synced' };
  }
  if (ops.some(o => o.cardId === cardId && o.inflight)) throw busy();
  ops = ops.filter(o => o.cardId !== cardId);
  return settle(add({ id: uuid(), type: 'card.delete', folderId, cardId }));
}

/** A new page: a title, some text and a few pictures. Pictures are sent when the page is. */
export async function createNote({ notebookId, title, text, photos = [] }) {
  return settle(add({ id: uuid(), type: 'note.create', notebookId, key: uuid(), body: { title: title.trim(), text, photos } }));
}

export async function saveNote({ noteId, version, title, body }) {
  if (isLocal(noteId)) {
    const op = opFor(noteId);
    if (!op) throw new Error('This page was already sent. Open it again from the notebook.');
    if (op.inflight) throw busy();
    op.body = { ...op.body, title: title.trim(), text: body }; persist(); status({ invalidate: [op.notebookId] });
    return settle(op);
  }
  const mine = ops.filter(o => o.type === 'note.update' && o.noteId === noteId), last = mine[mine.length - 1];
  if (last && !last.inflight) { last.body = { title, body }; persist(); status({ invalidate: [noteId] }); return settle(last); }
  return settle(add({ id: uuid(), type: 'note.update', noteId, version: last ? last.version + 1 : version, body: { title, body } }));
}

/** Throw away a page that has not been sent yet. */
export function discardLocalNote(noteId) {
  const op = opFor(noteId);
  if (!op || op.inflight) return false;
  ops = ops.filter(o => o !== op); persist(); status({ invalidate: [op.notebookId] });
  return true;
}

/* ----------------------------------------------------------------------------------- sending */

const retryable = e => e.code === 'NETWORK' || e.code === 'NOT_JSON' || e.status === 429 || e.status >= 500 || e.status === 401;

function schedule(ms) { clearTimeout(timer); timer = setTimeout(() => { flush(); }, ms); }

/** Send what is waiting, in order, stopping at the first thing that cannot be sent yet. */
export function flush() {
  if (!user) return Promise.resolve();
  clearTimeout(timer);
  running ??= drain().finally(() => { running = null; });
  return running;
}

export const flushSoon = (ms = 3000) => Promise.race([flush().catch(() => {}), new Promise(r => setTimeout(r, ms))]);

/** Upload any pictures still on the phone and put the ids in their place, remembering them so a retry does not repeat the upload. */
async function uploadPictures(op, endpoint, values) {
  const out = [];
  for (const value of values) {
    if (!isPending(value)) { out.push(value); continue; }
    try { out.push(await uploadStaged(endpoint, pendingUri(value))); }
    catch (e) {
      if (retryable(e)) throw e;
      out.push(null); op.lost = (op.lost || 0) + 1; // the picture was refused or its file is gone; the text still goes
    }
  }
  return out;
}

async function perform(op) {
  if (op.type === 'card.create' || op.type === 'card.update') {
    const [fi, bi] = await uploadPictures(op, `/folders/${op.folderId}/images`, [op.body.front.image, op.body.back.image]);
    op.body = { ...op.body, front: { ...op.body.front, image: fi }, back: { ...op.body.back, image: bi } };
    persist();
    if (op.type === 'card.create') return api(`/folders/${op.folderId}/cards`, { method: 'POST', body: op.body, headers: { 'Idempotency-Key': op.key } });
    return api(`/cards/${op.cardId}`, { method: 'PATCH', body: { ...op.body, version: op.version } });
  }
  if (op.type === 'card.delete') {
    try { return await api(`/cards/${op.cardId}`, { method: 'DELETE' }); } catch (e) { if (e.status === 404) return {}; throw e; }
  }
  if (op.type === 'note.create') {
    const ids = await uploadPictures(op, `/notebooks/${op.notebookId}/images`, op.body.photos);
    op.body = { ...op.body, photos: ids.filter(Boolean) };
    persist();
    const lines = op.body.photos.slice(0, NOTE_LIMITS.imagesPerNote).map(id => embedLine('media', id));
    const body = [op.body.text.trim(), ...lines].filter(Boolean).join('\n\n');
    return api(`/notebooks/${op.notebookId}/notes`, { method: 'POST', body: { title: op.body.title, body }, headers: { 'Idempotency-Key': op.key } });
  }
  if (op.type === 'note.update') return api(`/notes/${op.noteId}`, { method: 'PATCH', body: { version: op.version, ...op.body } });
  throw new Error('Unknown change');
}

async function drain() {
  const owner = user;
  while (owner === user && ops.length) {
    const op = ops[0];
    op.inflight = true;
    let result;
    try { result = await perform(op); }
    catch (e) {
      op.inflight = false;
      if (owner !== user) return;
      if (retryable(e)) {
        setOffline(e.code === 'NETWORK');
        backoff = Math.min(60_000, backoff ? backoff * 2 : 5000);
        finish(op.id, null, { status: 'queued' });
        if (e.status !== 401) schedule(backoff);
        return;
      }
      // Refused for good. Whoever is waiting on it is told; otherwise it is kept for the person to decide.
      ops = ops.filter(o => o !== op);
      if (!finish(op.id, e)) failed.push({ ...op, reason: e.code === 'VERSION_CONFLICT' ? 'conflict' : e.status === 404 ? 'gone' : 'refused', message: e.message });
      persist(); status({ invalidate: [op.folderId || op.notebookId || op.noteId] });
      continue;
    }
    if (owner !== user) return;
    ops = ops.filter(o => o !== op);
    backoff = 0; setOffline(false); persist();
    finish(op.id, null, { status: 'synced', result, lost: op.lost || 0 });
    status({ invalidate: [op.folderId || op.notebookId || op.noteId] });
  }
}

/* --------------------------------------------------------------------- changes that need a decision */

/** Send a refused change again: for a conflict, on top of the latest version ("keep mine"). */
export async function retryProblem(id) {
  const item = failed.find(o => o.id === id);
  if (!item) return;
  const { reason, message, ...op } = item;
  try {
    if (op.type === 'card.update') { const { cards } = await api(`/folders/${op.folderId}/cards`); const card = cards.find(c => c.id === op.cardId); if (!card) throw Object.assign(new Error('This card no longer exists.'), { status: 404 }); op.version = card.version; }
    if (op.type === 'note.update') { const { note } = await api(`/notes/${op.noteId}`); op.version = note.version; }
  } catch (e) { if (retryable(e)) throw e; failed = failed.map(o => (o.id === id ? { ...o, reason: 'gone', message: e.message } : o)); persist(); status(); return; }
  failed = failed.filter(o => o.id !== id);
  ops.push({ ...op, inflight: false }); persist(); status({ invalidate: ['*'] });
  flush();
}

export function discardProblem(id) {
  failed = failed.filter(o => o.id !== id); persist(); status({ invalidate: ['*'] });
}

/** Keep the whole library available offline: every folder's cards. Returns how many folders were saved. */
export async function saveForOffline(onProgress) {
  const { folders } = await cachedApi('/folders');
  const mine = folders.slice(0, 60);
  let done = 0;
  for (const f of mine) {
    await cachedApi(`/folders/${f.id}`); await cachedApi(`/folders/${f.id}/cards`);
    onProgress?.(++done, mine.length);
  }
  await cachedApi('/stats').catch(() => {});
  return mine.length;
}

// Coming back to the app is the moment to send what was written on the way.
AppState.addEventListener('change', state => { if (state === 'active' && ops.length) { backoff = 0; flush(); } });
