import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';
import { api } from './api';
import { BRAND } from '../../shared/brand.js';

/**
 * Answered cards, kept on the phone and sent to the server in batches.
 *
 * A card is answered instantly and the review goes into a queue stored on the device, then to the
 * server a few seconds later, every `BATCH_AT` answers, and whenever the app comes back to the
 * front. Studying on a train with no signal loses nothing: whatever the server has not
 * acknowledged is sent next time. Every review carries a request id, so sending one twice (a
 * retry, an app killed mid-request) is harmless — the server answers the repeat from what it
 * stored. This mirrors the website's own outbox so both behave the same.
 */

const DELAY_MS = 3000, BATCH_AT = 10, PER_REQUEST = 50, MAX_QUEUED = 2000;
const keyOf = user => `${BRAND.slug}.outbox.${user}`;
let user = null, queue = [], timer = null, running = null, backoff = 0;
const versions = new Map();
const listeners = new Set();
const emit = event => listeners.forEach(fn => fn(event));

const persist = () => (user ? AsyncStorage.setItem(keyOf(user), JSON.stringify(queue)).catch(() => {}) : Promise.resolve());

/** Called when the signed-in person changes. Reviews queued by someone else stay with them. */
export async function bindUser(id) {
  if (id === user) return;
  user = id; queue = []; versions.clear(); clearTimeout(timer);
  if (!user) return;
  try { const raw = JSON.parse((await AsyncStorage.getItem(keyOf(user))) || '[]'); queue = Array.isArray(raw) ? raw : []; } catch { queue = []; }
  emit({ pending: queue.length });
  if (queue.length) schedule(0);
}

export const discardQueue = async () => { if (user) await AsyncStorage.removeItem(keyOf(user)).catch(() => {}); queue = []; clearTimeout(timer); };
export const subscribe = fn => { listeners.add(fn); return () => listeners.delete(fn); };
export const pendingCount = () => queue.length;
export const pendingCards = () => new Set(queue.map(i => i.cardId));

/** Send what is queued, giving up after `ms` so a slow network never blocks signing out. */
export const flushSoon = (ms = 3000) => Promise.race([flush().catch(() => {}), new Promise(r => setTimeout(r, ms))]);

/**
 * The version to answer a card against: the one the server last sent, moved on by any review of it
 * still queued. Without this a card answered twice before a sync would conflict with itself.
 */
export function versionFor(card) {
  const queued = queue.filter(i => i.cardId === card.id).reduce((v, i) => Math.max(v, i.version + 1), -1);
  return Math.max(card.progress?.version || 0, versions.get(card.id) ?? 0, queued);
}

export function enqueue(reviews) {
  if (!user || !reviews.length) return;
  queue = [...queue, ...reviews].slice(-MAX_QUEUED);
  persist(); emit({ pending: queue.length });
  schedule(queue.length >= BATCH_AT ? 0 : DELAY_MS);
}

function schedule(ms) { clearTimeout(timer); timer = setTimeout(() => { flush(); }, ms); }

const strip = ({ cardId, rating, requestId, version, mode, reply, localHour, reviewedAt }) => ({ cardId, rating, requestId, version, mode, localHour, reviewedAt, ...(reply != null ? { reply } : {}) });

export function flush() {
  if (!user) return Promise.resolve();
  clearTimeout(timer);
  running ??= drain().finally(() => { running = null; });
  return running;
}

async function drain() {
  const owner = user;
  for (let batch = queue.slice(0, PER_REQUEST); batch.length && owner === user; batch = queue.slice(0, PER_REQUEST)) {
    let results;
    try {
      ({ results } = await api('/reviews/batch', { method: 'POST', body: { reviews: batch.map(strip) } }));
    } catch (e) {
      // Offline, a server hiccup, a rate limit or an expired session: keep everything, try later.
      // Anything else means the batch itself was refused, and resending it would be refused forever.
      const retry = e.code === 'NETWORK' || e.code === 'NOT_JSON' || e.status === 429 || e.status >= 500 || e.status === 401;
      if (!retry) { drop(batch); continue; }
      backoff = Math.min(60_000, backoff ? backoff * 2 : 5000);
      emit({ pending: queue.length, offline: e.code === 'NETWORK' });
      if (e.status !== 401) schedule(backoff);
      return;
    }
    backoff = 0;
    for (const r of results) if (r.progress) versions.set(batch.find(b => b.requestId === r.requestId)?.cardId, r.progress.version);
    drop(batch);
    emit({ results, pending: queue.length });
  }
}

function drop(batch) {
  const sent = new Set(batch.map(b => b.requestId));
  queue = queue.filter(i => !sent.has(i.requestId));
  persist(); emit({ pending: queue.length });
}

// Coming back to the app is the moment to send what was answered on the way.
AppState.addEventListener('change', state => { if (state === 'active' && queue.length) { backoff = 0; flush(); } });
