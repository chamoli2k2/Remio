import mongoose from 'mongoose';
import { Card, Progress, Review } from '../models/index.js';
import { accessFolder } from './accessService.js';
import { AppError } from '../utils/errors.js';
import { schedule as fsrsSchedule, preview, DEFAULT_RETENTION } from './fsrs.js';
import { loadProfile, saveProfile, applyReview } from './gameService.js';
// Scheduling is FSRS (see fsrs.js). This wrapper keeps the original signature so callers and tests stay unchanged.
export const schedule = (previous, rating, now = new Date(), options) => fsrsSchedule(previous, rating, now, options);
export const previewSchedule = (previous, retention = DEFAULT_RETENTION, now = new Date()) => preview(previous, now, { retention });

export const MAX_BATCH = 100;
// A review queued on a device that then went offline is still honoured when it syncs, as long as it
// is no older than this. Older ones are scheduled as if answered now.
const BACKDATE_MS = 7 * 86400000;
const ATTEMPTS = 3;

const failed = (requestId, status, code, error, extra) => ({ requestId, ok: false, status, code, error, ...extra });

/**
 * Apply answered cards, in order, in one transaction.
 *
 * The study page answers cards on the device and sends them in batches, so a learner never waits on
 * the network between cards. Every review carries its own request id and the card version it was
 * answered against, which makes a batch safe to resend: a review already applied returns its stored
 * result, and one answered against a version that has since moved on is refused for that card alone.
 * One bad review never sinks the others; each gets its own result.
 *
 * Reviews only write the learner's own progress, so access is checked with a read of the folder,
 * and the folder's write lock that edits take is not touched: a public folder studied by many people
 * at once would otherwise make all of them queue behind each other.
 */
export async function reviewCards(user, items, now = new Date()) {
  const cardIds = [...new Set(items.map(i => i.cardId))];
  const cards = new Map((await Card.find({ _id: { $in: cardIds } })).map(c => [c.id, c]));
  const folders = new Map();
  await Promise.all([...new Set([...cards.values()].map(c => String(c.folder)))].map(async id => {
    folders.set(id, await accessFolder(id, user, 'viewer').then(() => true, () => false));
  }));
  const retention = user.desiredRetention || DEFAULT_RETENTION;

  for (let attempt = 1; ; attempt++) {
    try {
      return await mongoose.connection.transaction(session => applyAll(user, items, { cards, folders, retention, now }, session));
    } catch (e) {
      // Two devices syncing the same new card at once both try to insert its first progress or
      // review row; the loser's retry then finds the winner's and answers from it.
      if (e?.code !== 11000 || attempt >= ATTEMPTS) throw e;
    }
  }
}

async function applyAll(user, items, { cards, folders, retention, now }, session) {
  const requestIds = items.map(i => i.requestId);
  const priors = new Map((await Review.find({ user: user.id, requestId: { $in: requestIds } }).session(session)).map(r => [r.requestId, r]));
  const progress = new Map((await Progress.find({ user: user.id, card: { $in: [...cards.keys()] } }).session(session)).map(p => [String(p.card), p]));
  const profile = await loadProfile(user, session);
  const touched = new Set(), reviews = [], results = [], seen = new Map();
  const countDeepRoots = async days => {
    const others = await Progress.countDocuments({ user: user.id, stability: { $gte: days }, card: { $nin: [...touched] } }).session(session);
    return others + [...touched].filter(id => progress.get(id).stability >= days).length;
  };

  for (const item of items) {
    const prior = priors.get(item.requestId) || seen.get(item.requestId);
    if (prior) {
      results.push(String(prior.card) === item.cardId && prior.rating === item.rating
        ? { requestId: item.requestId, ok: true, progress: prior.result, game: prior.game ?? null }
        : failed(item.requestId, 409, 'CONFLICT', 'Review key already used for a different review.'));
      continue;
    }
    const card = cards.get(item.cardId);
    if (!card) { results.push(failed(item.requestId, 404, 'NOT_FOUND', 'Card not found.')); continue; }
    if (!folders.get(String(card.folder))) { results.push(failed(item.requestId, 404, 'NOT_FOUND', 'Folder not found or access has been removed.')); continue; }

    let p = progress.get(item.cardId);
    if ((p?.version ?? 0) !== item.version) {
      results.push(failed(item.requestId, 409, 'VERSION_CONFLICT', 'This card was reviewed on another device. Refresh the session.', { progress: p ? withPreview(p, retention, now) : null }));
      continue;
    }
    if (!p) { p = new Progress({ user: user.id, card: card.id }); progress.set(item.cardId, p); }

    const before = p.toObject();
    const claimed = item.reviewedAt ? new Date(item.reviewedAt) : now;
    const last = before.lastReviewedAt ? new Date(before.lastReviewedAt).getTime() : 0;
    const at = new Date(Math.max(last, now - BACKDATE_MS, Math.min(now.getTime(), claimed.getTime())));
    Object.assign(p, schedule(before, item.rating, at, { retention })); p.version++;
    touched.add(item.cardId);

    const result = withPreview(p, retention, at);
    const mode = item.mode || 'classic';
    const game = await applyReview(profile, { user, card, before, after: p, rating: item.rating, mode, reply: item.reply, echo: !!item.echo, localHour: item.localHour, board: item.board, now, at, countDeepRoots });
    const review = { user: user.id, card: card.id, requestId: item.requestId, rating: item.rating, mode, result, game, elapsedDays: result.elapsedDays, folder: card.folder, createdAt: at, updatedAt: now };
    reviews.push(review); seen.set(item.requestId, review);
    results.push({ requestId: item.requestId, ok: true, progress: result, game });
  }

  if (touched.size) await Progress.bulkSave([...touched].map(id => progress.get(id)), { session });
  if (reviews.length) await Review.insertMany(reviews, { session });
  if (reviews.length) await saveProfile(profile, session);
  return results;
}

const withPreview = (p, retention, at) => ({ ...p.toJSON(), preview: previewSchedule(p.toObject(), retention, at) });

/** One review, answered with its result or the error that stopped it. */
export async function reviewCard(user, body) {
  const [result] = await reviewCards(user, [body]);
  if (!result.ok) throw new AppError(result.status, result.error, result.code);
  return { progress: result.progress, game: result.game };
}
