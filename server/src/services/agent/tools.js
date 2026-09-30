import mongoose from 'mongoose';
import { Folder, Card, AgentBatch, Progress, Revision } from '../../models/index.js';
import { accessFolder, mutateFolder, recordEvent } from '../accessService.js';
import { teamIdsFor } from '../teamAccess.js';
import { assert, toAppError } from '../../utils/errors.js';
import { agentCardSchema, agentCollectionSchema } from '../../middleware/validate.js';
import { stripCloze } from '../../../../shared/cloze.js';
import { AGENT_LIMITS } from '../../../../shared/agent.js';
import { requireQuota, usageToday } from './tokens.js';

/**
 * What a connected assistant can actually do.
 *
 * Four tools, all additive. Nothing here deletes, nothing edits what already exists, and nothing
 * publishes — which is the entire security design, because an assistant summarising a PDF is
 * reading text an attacker may have written, and no instruction we give the model reliably
 * survives an instruction hidden in the document. Rather than trying to win that argument, the
 * tools are shaped so that losing it is survivable: the worst outcome is unwanted cards in a new
 * private collection, and there is a button that removes them.
 *
 * Every write also goes through `mutateFolder`, exactly as a human edit does, so permissions,
 * the write-epoch guard, the activity feed and the live collaboration events all behave
 * identically whether a person or a model made the change. An assistant is a user with a narrower
 * key, not a side door.
 */

const oid = id => new mongoose.Types.ObjectId(String(id));
/** Untrusted text going into a regular expression. Without this, a model quoting "C++ (a*)" is a denial of service. */
const escapeRx = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const preview = text => stripCloze(String(text || '')).replace(/\s+/g, ' ').trim().slice(0, 120);

/** Every collection this user may add cards to: their own, ones shared with them as editor, and their teams'. */
async function writableFilter(user) {
  const teams = await teamIdsFor(user);
  const or = [{ owner: user.id }, { members: { $elemMatch: { user: user.id, role: 'editor' } } }];
  if (teams.length) or.push({ team: { $in: teams } });
  return { archived: false, $or: or };
}

/**
 * list_collections — where could this go?
 *
 * Returned deliberately thin. A tool result is spent context, and an assistant deciding which
 * collection to write into needs a title, a size and an id; the cover image, the member list and
 * the tag cloud would cost tokens to say nothing it can act on.
 */
export async function listCollections(user, { query = '' } = {}) {
  const filter = await writableFilter(user);
  if (query.trim()) filter.title = { $regex: escapeRx(query.trim()), $options: 'i' };
  const folders = await Folder.find(filter).sort({ updatedAt: -1 }).limit(AGENT_LIMITS.collectionsPerPage).lean();
  const counts = folders.length
    ? await Card.aggregate([{ $match: { folder: { $in: folders.map(f => f._id) } } }, { $group: { _id: '$folder', n: { $sum: 1 } } }])
    : [];
  const byId = new Map(counts.map(c => [String(c._id), c.n]));
  return {
    collections: folders.map(f => ({
      id: String(f._id),
      title: f.title,
      description: f.description || undefined,
      cards: byId.get(String(f._id)) || 0,
      visibility: f.visibility,
    })),
  };
}

/**
 * search_cards — has this already been written?
 *
 * Exists for one reason: an assistant asked to "add cards from chapter 4" across three sessions
 * will happily write the same twenty cards three times. Giving it a way to look first is cheaper
 * than any amount of deduplication afterwards, and it is a read-only tool, so it costs nothing in
 * risk to offer.
 */
export async function searchCards(user, { query, collectionId = null }) {
  assert(String(query || '').trim().length >= 2, 400, 'Give search text of at least two characters.');
  const filter = await writableFilter(user);
  if (collectionId) {
    // Checked through the ordinary permission path rather than by trusting the filter above, so a
    // collection the user can read but not write is still searchable and one they cannot is not.
    const folder = await accessFolder(collectionId, user);
    filter._id = folder._id;
  }
  const ids = (await Folder.find(filter).select('_id title').lean());
  if (!ids.length) return { matches: [] };
  const titles = new Map(ids.map(f => [String(f._id), f.title]));
  const rx = { $regex: escapeRx(query.trim()), $options: 'i' };
  const cards = await Card.find({ folder: { $in: ids.map(f => f._id) }, $or: [{ 'front.text': rx }, { 'back.text': rx }] })
    .select('front.text back.text folder').limit(AGENT_LIMITS.searchResults).lean();
  return {
    matches: cards.map(c => ({
      id: String(c._id),
      collection: titles.get(String(c.folder)) || '',
      front: preview(c.front?.text),
      back: preview(c.back?.text),
    })),
  };
}

/**
 * create_collection — always private, always owned by the person.
 *
 * `visibility` is not a parameter and cannot be passed. Publishing puts something under this
 * user's name on a page strangers read, and that is a decision a person makes deliberately, not
 * one a model makes because a PDF suggested it. Making it private here and requiring a human click
 * to publish costs the honest case one click and costs the injected case everything.
 */
export async function createCollection(user, input) {
  const body = agentCollectionSchema.parse(input);
  const folder = await Folder.create({ ...body, visibility: 'private', owner: user.id });
  return { id: folder.id, title: folder.title, visibility: folder.visibility, cards: 0 };
}

/**
 * Validate the whole batch before writing any of it, naming the card that is wrong.
 *
 * Per-card rather than all-or-nothing reporting, because the recipient of the error is a model
 * that will try again: "card 7: add text or an image to the back" produces a fixed card 7, and a
 * bare "validation failed" produces another guess.
 */
function parseCards(input) {
  assert(Array.isArray(input) && input.length, 400, 'Send at least one card.');
  assert(input.length <= AGENT_LIMITS.cardsPerCall, 400,
    `Send at most ${AGENT_LIMITS.cardsPerCall} cards in one call. Split a longer set across several calls.`);
  const cards = [], problems = [];
  input.forEach((raw, i) => {
    try { cards.push(agentCardSchema.parse(raw)); }
    catch (e) { problems.push(`card ${i + 1}: ${toAppError(e).message}`); }
  });
  assert(!problems.length, 400, problems.slice(0, 5).join('; '));
  return cards;
}

/**
 * add_cards — the only tool that writes anything substantial, and the only one that needs a batch.
 *
 * Idempotency is not optional here. An MCP client that does not hear back in time retries, and a
 * call that actually succeeded would then be replayed into a duplicate set of cards. The request
 * id is unique per user in the database, so the retry either finds the finished batch and is
 * handed the original answer, or loses the race on the index and is handed it a moment later.
 */
export async function addCards(user, grant, { collectionId, cards: input, requestId }) {
  const cards = parseCards(input);

  const done = await AgentBatch.findOne({ user: user.id, requestId });
  if (done) return { ...done.result, replayed: true };

  await requireQuota(user.id, cards.length);

  let created;
  try {
    created = await mutateFolder(collectionId, user, 'editor', async (folder, session) => {
      assert(!folder.archived, 409, 'That collection is archived. Restore it before adding cards.');
      const docs = cards.map(c => ({ ...c, folder: folder.id, createdBy: user.id, updatedBy: user.id }));
      const rows = await Card.insertMany(docs, { session });
      const result = { collectionId: folder.id, collection: folder.title, added: rows.length };
      // In the same transaction as the cards it describes. A batch written afterwards could be
      // lost to a crash in between, leaving cards nobody can undo and a retry that duplicates them.
      const [batch] = await AgentBatch.create([{
        user: user.id, token: grant?._id ?? null, tokenName: grant?.name || '',
        folder: folder.id, folderTitle: folder.title,
        cards: rows.map(r => r._id), cardCount: rows.length,
        requestId, result,
      }], { session });
      await recordEvent(folder, user, 'cards.imported', `${rows.length} cards added by ${batch.tokenName || 'an assistant'}`, session, folder.id, { count: rows.length });
      return result;
    });
  } catch (e) {
    // Lost the race against a concurrent retry of the same request id. The winner's batch is the
    // answer to both, so read it back rather than reporting a conflict the caller cannot act on.
    if (e?.code === 11000 || e?.cause?.code === 11000) {
      const winner = await AgentBatch.findOne({ user: user.id, requestId });
      if (winner) return { ...winner.result, replayed: true };
    }
    throw e;
  }

  const { left } = await usageToday(user.id);
  return { ...created, remainingToday: left };
}

/**
 * The batches this account's assistants have written, for the review screen.
 *
 * Undone ones are kept and shown, because "I already threw that away" is a useful thing for the
 * screen to be able to say, and because the record of what an assistant did should not disappear
 * when the evidence does.
 */
export async function listBatches(user, { limit = 30 } = {}) {
  const batches = await AgentBatch.find({ user: user.id }).sort({ createdAt: -1 }).limit(Math.min(limit, 100)).lean();
  const live = batches.filter(b => !b.undoneAt).map(b => b.folder);
  const exists = new Set((await Folder.find({ _id: { $in: live } }).select('_id').lean()).map(f => String(f._id)));
  return batches.map(b => ({
    id: String(b._id),
    collectionId: exists.has(String(b.folder)) ? String(b.folder) : null,
    collection: b.folderTitle,
    by: b.tokenName || 'An assistant',
    cardCount: b.cardCount,
    createdAt: b.createdAt,
    undoneAt: b.undoneAt,
  }));
}

/**
 * Undo — remove exactly the cards this batch added, and nothing else.
 *
 * Scoped to the recorded ids rather than to "everything in the collection since", so cards the
 * person wrote themselves afterwards survive, and so undoing an older batch does not take a newer
 * one with it. Cards already deleted by hand simply do not match, which is the right outcome.
 *
 * Only the account's owner can do this, and only through the app with a session — an assistant
 * cannot call it. A delete tool would hand an injected instruction the one capability this whole
 * design exists to withhold.
 */
export async function undoBatch(user, id) {
  assert(mongoose.isValidObjectId(id), 404, 'That batch was not found.');
  const batch = await AgentBatch.findOne({ _id: id, user: user.id });
  assert(batch, 404, 'That batch was not found.');
  assert(!batch.undoneAt, 409, 'That batch has already been undone.');

  const folder = await Folder.findById(batch.folder);
  // The collection may have been deleted in the meantime, which undoes the batch more thoroughly
  // than we could. Mark it and move on rather than failing.
  if (!folder) {
    batch.undoneAt = new Date(); await batch.save();
    return { removed: 0, collection: batch.folderTitle };
  }

  const removed = await mutateFolder(batch.folder, user, 'editor', async (f, session) => {
    const ids = batch.cards.map(oid);
    const { deletedCount } = await Card.deleteMany({ _id: { $in: ids }, folder: f._id }, { session });
    await Revision.deleteMany({ card: { $in: ids } }, { session });
    await Progress.deleteMany({ card: { $in: ids } }, { session });
    await AgentBatch.updateOne({ _id: batch._id }, { $set: { undoneAt: new Date() } }, { session });
    await recordEvent(f, user, 'cards.imported', `${deletedCount} assistant cards removed`, session, f.id, { count: deletedCount });
    return deletedCount;
  });
  return { removed, collection: folder.title };
}
