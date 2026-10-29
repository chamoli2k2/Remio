import { Card, Progress, Review } from '../models/index.js';
import { mutateFolder } from './accessService.js';
import { assert } from '../utils/errors.js';
import { schedule as fsrsSchedule, preview, DEFAULT_RETENTION } from './fsrs.js';
import { awardReview } from './gameService.js';
// Scheduling is FSRS (see fsrs.js). This wrapper keeps the original signature so callers and tests stay unchanged.
export const schedule = (previous, rating, now = new Date(), options) => fsrsSchedule(previous, rating, now, options);
export const previewSchedule = (previous, retention = DEFAULT_RETENTION, now = new Date()) => preview(previous, now, { retention });
export async function reviewCard(user, body) {
  const card = await Card.findById(body.cardId); assert(card, 404, 'Card not found.');
  return mutateFolder(card.folder, user, 'viewer', async (_folder, session) => {
    const prior = await Review.findOne({ user: user.id, requestId: body.requestId }).session(session);
    if (prior) { assert(String(prior.card) === body.cardId && prior.rating === body.rating, 409, 'Review key already used for a different review.'); return { progress: prior.result, game: prior.game ?? null }; }
    let progress = await Progress.findOne({ user: user.id, card: card.id }).session(session);
    assert((progress?.version ?? 0) === body.version, 409, 'This card was reviewed on another device. Refresh the session.', 'VERSION_CONFLICT');
    if (!progress) progress = new Progress({ user: user.id, card: card.id });
    const now = new Date(); const before = progress.toObject();
    Object.assign(progress, schedule(before, body.rating, now, { retention: user.desiredRetention || DEFAULT_RETENTION })); progress.version++;
    await progress.save({ session }); const result = { ...progress.toJSON(), preview: previewSchedule(progress.toObject(), user.desiredRetention || DEFAULT_RETENTION, now) };
    const mode = body.mode || 'classic';
    const game = await awardReview({ user, card, before, after: progress, rating: body.rating, mode, reply: body.reply, echo: !!body.echo, localHour: body.localHour, board: body.board, now }, session);
    await Review.create([{ user: user.id, card: card.id, requestId: body.requestId, rating: body.rating, mode, result, game, elapsedDays: result.elapsedDays, folder: card.folder }], { session });
    return { progress: result, game };
  });
}
