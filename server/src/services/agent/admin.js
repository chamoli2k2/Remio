import mongoose from 'mongoose';
import { AgentToken, AgentBatch, User } from '../../models/index.js';
import { setting, record } from '../settingsService.js';
import { assert } from '../../utils/errors.js';
import { presentGrant } from './tokens.js';

/**
 * The staff view of connected assistants: who has one, how much they are writing, and the button
 * that cuts one off.
 *
 * Read across every account, so nothing here returns a secret or a card's text — the grant's own
 * label, its scopes and its timestamps are enough to decide whether something looks wrong, and
 * anything more would be staff reading people's libraries to answer a question about traffic.
 */

const escapeRegex = value => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const startOfToday = () => { const d = new Date(); d.setUTCHours(0, 0, 0, 0); return d; };

async function totals() {
  const today = startOfToday();
  const week = new Date(Date.now() - 7 * 86_400_000);
  const [active, people, [todayRow], [weekRow]] = await Promise.all([
    AgentToken.countDocuments({ revokedAt: null }),
    AgentToken.distinct('user', { revokedAt: null }).then(ids => ids.length),
    AgentBatch.aggregate([
      { $match: { createdAt: { $gte: today }, undoneAt: null } },
      { $group: { _id: null, cards: { $sum: '$cardCount' }, images: { $sum: '$imageCount' } } },
    ]),
    AgentBatch.aggregate([
      { $match: { createdAt: { $gte: week } } },
      { $group: { _id: null, cards: { $sum: { $cond: [{ $eq: ['$undoneAt', null] }, '$cardCount', 0] } }, batches: { $sum: 1 }, undone: { $sum: { $cond: [{ $ne: ['$undoneAt', null] }, 1, 0] } } } },
    ]),
  ]);
  return {
    active, people,
    cardsToday: todayRow?.cards || 0, imagesToday: todayRow?.images || 0,
    cardsWeek: weekRow?.cards || 0, batchesWeek: weekRow?.batches || 0, undoneWeek: weekRow?.undone || 0,
  };
}

/** Matched by username or display name, which is what an admin will have been told. */
async function usersMatching(q) {
  const term = String(q || '').trim().slice(0, 60);
  if (!term) return null;
  const pattern = { $regex: escapeRegex(term), $options: 'i' };
  const rows = await User.find({ $or: [{ username: pattern }, { name: pattern }] }).select('_id').limit(200).lean();
  return rows.map(r => r._id);
}

export async function overview({ page = 1, pageSize = 15, q = '' } = {}) {
  const size = Math.min(Math.max(Number(pageSize) || 15, 5), 50);
  const filter = { revokedAt: null };
  const users = await usersMatching(q);
  if (users) filter.user = { $in: users };

  const total = await AgentToken.countDocuments(filter);
  const pages = Math.max(1, Math.ceil(total / size));
  const current = Math.min(Math.max(Math.floor(Number(page)) || 1, 1), pages);
  const [grants, recent, summary] = await Promise.all([
    AgentToken.find(filter).sort({ lastUsedAt: -1, createdAt: -1 }).skip((current - 1) * size).limit(size)
      .populate('user', 'username name'),
    AgentBatch.find({}).sort({ createdAt: -1 }).limit(10)
      .select('user tokenName folderTitle cardCount imageCount createdAt undoneAt').populate('user', 'username').lean(),
    totals(),
  ]);

  return {
    enabled: setting('agent.enabled'),
    limits: {
      cardsPerDay: setting('agent.cardsPerDay'), imagesPerDay: setting('agent.imagesPerDay'),
      grantsPerUser: setting('agent.grantsPerUser'), tokenDays: setting('agent.tokenDays'),
    },
    totals: summary,
    connections: grants.map(g => ({
      ...presentGrant(g),
      user: g.user ? { id: String(g.user._id), username: g.user.username, name: g.user.name } : null,
    })),
    page: current, pages, total,
    recent: recent.map(b => ({
      id: String(b._id), user: b.user?.username || 'deleted user', assistant: b.tokenName || 'Assistant',
      collection: b.folderTitle || 'a collection', cards: b.cardCount || 0, images: b.imageCount || 0,
      at: b.createdAt, undone: !!b.undoneAt,
    })),
  };
}

/**
 * Disconnect somebody else's assistant.
 *
 * The same tombstone their own Disconnect button leaves, so the batches it wrote stay reviewable
 * and undoable by them. Recorded, because cutting off a person's connection is an action on their
 * account and the reason belongs somewhere they can be told about.
 */
export async function revoke(actor, id, note = '') {
  assert(mongoose.isValidObjectId(id), 404, 'That connection was not found.');
  const grant = await AgentToken.findOneAndUpdate(
    { _id: id, revokedAt: null },
    { $set: { revokedAt: new Date() }, $unset: { accessHash: '', refreshHash: '' } },
    { new: true },
  ).populate('user', 'username');
  assert(grant, 404, 'That connection was not found, or it had already been disconnected.');
  await record(actor, 'agent.revoked', { target: `@${grant.user?.username || 'unknown'} · ${grant.name}`, note });
  return presentGrant(grant);
}
