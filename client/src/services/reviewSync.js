import { api, isDemo } from './api';
import { invalidate } from './store';

/**
 * Answered cards, saved on the device and sent to the server in batches.
 *
 * Studying used to wait on a request after every card. Now a card is answered locally, the review
 * is written to an outbox in localStorage, and the outbox is sent a few seconds later, every
 * `BATCH_AT` reviews, when the tab is hidden or closed, and when the connection comes back. Nothing
 * is lost to a dropped connection or a closed tab: whatever was not acknowledged is sent next time.
 *
 * Each review has a request id, so sending one twice — a retry, two tabs, a keepalive that did land
 * — is harmless: the server answers the second time from what it stored. The outbox is read and
 * written straight from storage on every change rather than kept in memory, so two tabs studying
 * at once share one queue instead of overwriting each other's.
 */

const DELAY_MS = 3000, BATCH_AT = 10, MAX_PER_REQUEST = 50, MAX_BYTES = 60_000, MAX_QUEUED = 2000;
const keyOf = user => `remio:review-outbox:${user}`;
let user = null, timer = null, running = null, backoff = 0, memory = [], inMemory = false, lastExit = 0;
const listeners = new Set();
const versions = new Map();

function read() {
  if (!user) return [];
  if (inMemory) return memory;
  try { const items = JSON.parse(localStorage.getItem(keyOf(user)) || '[]'); return Array.isArray(items) ? items : []; } catch { return memory; }
}
function write(items) {
  memory = items;
  // Storage that is full or blocked keeps the queue for this tab only, rather than losing reviews.
  if (!inMemory) try { localStorage.setItem(keyOf(user), JSON.stringify(items)); } catch { inMemory = true; }
  emit({ pending: items.length });
}
const emit = event => listeners.forEach(fn => fn(event));

/** Called when the signed-in user changes. Reviews queued by someone else stay with them. */
export function bindUser(id) {
  if (id === user) return;
  user = id; memory = []; inMemory = false; versions.clear(); clearTimeout(timer);
  if (user && read().length) schedule(0);
}

/** Send what is queued before signing out, giving up after `ms` so a slow network never blocks it. */
export const flushSoon = (ms = 3000) => Promise.race([flush().catch(() => {}), new Promise(r => setTimeout(r, ms))]);

/** The account is gone; its queued reviews have nowhere to go. */
export function discard() {
  try { if (user) localStorage.removeItem(keyOf(user)); } catch { /* nothing stored */ }
  memory = []; clearTimeout(timer);
}

/** Hears `{ results }` as batches are acknowledged and `{ pending, offline }` as the queue changes. */
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export const pendingCount = () => read().length;
export const pendingCards = () => new Set(read().map(i => i.cardId));

/**
 * The version to answer a card against: the one the server last sent, moved on by any review of it
 * still in the outbox. Without this a card answered twice before a sync would conflict with itself.
 */
export function versionFor(card) {
  const queued = read().filter(i => i.cardId === card.id).reduce((v, i) => Math.max(v, i.version + 1), -1);
  return Math.max(card.progress?.version || 0, versions.get(card.id) ?? 0, queued);
}

export function enqueue(reviews) {
  if (!user || !reviews.length) return;
  const items = [...read(), ...reviews].slice(-MAX_QUEUED);
  write(items);
  schedule(items.length >= BATCH_AT ? 0 : DELAY_MS);
}

function schedule(ms) { clearTimeout(timer); timer = setTimeout(() => { flush(); }, ms); }

/** Up to `MAX_PER_REQUEST` reviews, oldest first, kept under the size a keepalive request allows. */
function nextBatch(items) {
  const batch = []; let bytes = 20;
  for (const it of items.slice(0, MAX_PER_REQUEST)) {
    const size = JSON.stringify(it).length + 1;
    if (batch.length && bytes + size > MAX_BYTES) break;
    batch.push(it); bytes += size;
  }
  return batch;
}
const strip = ({ cardId, rating, requestId, version, mode, reply, echo, localHour, board, reviewedAt }) => ({ cardId, rating, requestId, version, mode, localHour, reviewedAt, ...(reply != null ? { reply } : {}), ...(echo ? { echo } : {}), ...(board ? { board } : {}) });

/** Send everything queued. Resolves once the outbox is empty or the server cannot be reached. */
export function flush() {
  if (!user) return Promise.resolve();
  clearTimeout(timer);
  const run = () => {
    running ??= drain().finally(() => { running = null; });
    return running;
  };
  return typeof navigator !== 'undefined' && navigator.locks ? navigator.locks.request(`remio-review-sync:${user}`, run) : run();
}

async function drain() {
  const owner = user;
  for (let batch = nextBatch(read()); batch.length && owner === user; batch = nextBatch(read())) {
    let results;
    try {
      ({ results } = await api('/reviews/batch', { method: 'POST', body: { reviews: batch.map(strip) } }));
    } catch (e) {
      // Offline, a server hiccup or a rate limit: keep everything and try again later. Anything
      // else means the batch itself was refused, and resending it would be refused forever.
      const retry = e.code === 'NETWORK' || e.code === 'NOT_JSON' || e.status === 429 || e.status >= 500 || e.status === 401;
      if (!retry) { drop(batch); continue; }
      backoff = Math.min(60_000, backoff ? backoff * 2 : 5000);
      emit({ pending: read().length, offline: e.code === 'NETWORK' });
      if (e.status !== 401) schedule(backoff);
      return;
    }
    backoff = 0;
    for (const r of results) if (r.progress) versions.set(batch.find(b => b.requestId === r.requestId)?.cardId, r.progress.version);
    drop(batch);
    emit({ results: results.map(r => ({ ...r, cardId: batch.find(b => b.requestId === r.requestId)?.cardId })) });
    // Due counts, stats and the library are now out of date. A study session on screen is not: it
    // already moved past these cards, and reloading its cards mid-session would only cost time.
    invalidate(key => !key.startsWith('study:'));
  }
}
function drop(batch) { const sent = new Set(batch.map(b => b.requestId)); write(read().filter(i => !sent.has(i.requestId))); }

/**
 * The tab is going away. A normal request may be cut off, so hand what is queued to the browser as
 * a keepalive request it finishes on its own. The outbox is left as it is: if this one does land,
 * the next sync is answered from what it stored.
 */
function sendOnExit() {
  if (isDemo || !user || Date.now() - lastExit < 1000) return;
  const batch = nextBatch(read());
  if (!batch.length) return;
  lastExit = Date.now();
  const base = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
  try { fetch(`${base}/api/reviews/batch`, { method: 'POST', keepalive: true, credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reviews: batch.map(strip) }) }).catch(() => {}); } catch { /* nothing more can be done */ }
}

if (typeof window !== 'undefined' && !isDemo) {
  window.addEventListener('online', () => { backoff = 0; flush(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') sendOnExit(); else if (pendingCount()) flush(); });
  window.addEventListener('pagehide', sendOnExit);
  // Another tab queued or synced reviews.
  window.addEventListener('storage', e => { if (user && e.key === keyOf(user)) emit({ pending: read().length }); });
}
