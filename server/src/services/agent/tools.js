import mongoose from 'mongoose';
import { Folder, Card, AgentBatch, Progress, Revision } from '../../models/index.js';
import { accessFolder, mutateFolder, recordEvent } from '../accessService.js';
import { teamIdsFor } from '../teamAccess.js';
import { assert, toAppError } from '../../utils/errors.js';
import { agentCardSchema, agentCollectionSchema, agentImageUrl, cardSchema } from '../../middleware/validate.js';
import { stripCloze } from '../../../../shared/cloze.js';
import { AGENT_LIMITS, CONDITIONAL_SCOPES } from '../../../../shared/agent.js';
import { requireQuota, requireImageQuota, requireScope, usageToday } from './tokens.js';
import { fetchImage } from '../fetchImage.js';
import * as media from '../mediaService.js';
import * as storage from '../storage.js';

/**
 * What a connected assistant can actually do.
 *
 * Five tools, all additive. Nothing here deletes, nothing edits what already exists, and nothing
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
 *
 * `set_collection_cover` is the one tool that changes something already there, and it is fenced
 * in accordingly: private collections only, the previous cover recorded so undo puts it back.
 * Letting it touch a published collection would hand an injected instruction the ability to put
 * a picture of its choosing on a public page under this person's name, which is precisely the
 * outcome `create_collection` refusing to publish exists to prevent.
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
 * Fetch and check every distinct picture a batch asked for.
 *
 * Distinct by URL first, which is free and is the common case — one diagram cited by eight cards
 * is downloaded once. The hash check in `mediaService.persist` catches the rest, where the same
 * image arrives from two different addresses.
 *
 * Downloads run together because they are almost all waiting, but the decoding is deliberately
 * one at a time. Each `ingest` can hold a decoded bitmap of tens of megabytes, and eight of those
 * at once is the difference between a slow request and an instance that runs out of memory.
 *
 * A URL that fails does not fail the batch. The caller is a model that will offer a different
 * link if told which one was bad, and losing forty good cards to one dead image would be a poor
 * trade; the failures are reported back alongside what did work.
 */
async function fetchAll(urls) {
  const downloaded = await Promise.all(urls.map(async url => {
    try { return { url, body: (await fetchImage(url)).body }; }
    catch (e) { return { url, error: toAppError(e).message }; }
  }));
  const images = new Map(), failures = [];
  for (const row of downloaded) {
    if (row.error) { failures.push({ url: row.url, reason: row.error }); continue; }
    try { images.set(row.url, await media.ingest(row.body)); }
    catch (e) { failures.push({ url: row.url, reason: toAppError(e).message }); }
  }
  return { images, failures };
}

/** A filename for the media row, taken from the URL. Cosmetic — it is what the app shows in a picker. */
const nameFromUrl = url => {
  try { return decodeURIComponent(new URL(url).pathname.split('/').pop() || '').slice(0, 150); }
  catch { return ''; }
};

/** The distinct image addresses a parsed batch names, refusing a call that asks for too many at once. */
function imageUrlsIn(parsed) {
  const urls = [...new Set(parsed.flatMap(p => [p.images.front, p.images.back]).filter(Boolean))];
  assert(urls.length <= AGENT_LIMITS.imagesPerCall, 400,
    `Send at most ${AGENT_LIMITS.imagesPerCall} different images in one call. Split the batch, or reuse the same image URL across cards — a repeat costs nothing.`);
  return urls;
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
  const parsed = parseCards(input);

  const done = await AgentBatch.findOne({ user: user.id, requestId });
  if (done) return { ...done.result, replayed: true };

  /**
   * Everything that could refuse this call runs before a single byte is fetched — including the
   * permission check on the collection, which would otherwise happen inside the transaction
   * below and so *after* the downloads.
   *
   * That ordering is the point. Without it, naming a collection this account cannot write to is
   * a way to make this server issue outbound requests to addresses of the caller's choosing and
   * then throw the results away, which is a proxy with the refusal at the wrong end.
   */
  const urls = imageUrlsIn(parsed);
  if (urls.length) {
    requireScope(grant, CONDITIONAL_SCOPES.add_cards.images);
    await accessFolder(collectionId, user, 'editor');
  }
  await requireQuota(user.id, parsed.length);
  await requireImageQuota(user.id, urls.length);

  const { images, failures } = urls.length ? await fetchAll(urls) : { images: new Map(), failures: [] };

  let created;
  try {
    created = await mutateFolder(collectionId, user, 'editor', async (folder, session) => {
      assert(!folder.archived, 409, 'That collection is archived. Restore it before adding cards.');

      const byUrl = new Map(), fresh = [];
      for (const [url, image] of images) {
        const { media: row, reused } = await media.persist(image, {
          folder: folder.id, user: user.id, sourceUrl: url, name: nameFromUrl(url), session,
        });
        byUrl.set(url, row._id);
        if (!reused) fresh.push(row._id);
      }

      /**
       * The finished cards are validated by `cardSchema` — the same schema the app's own card
       * endpoint uses — now that their images are real ids. This is where the promise that an
       * assistant cannot reach a shape we would refuse from a person is actually kept.
       *
       * A card left with nothing on it because its only content was an image that failed to
       * download is skipped rather than fatal, for the same reason the download failure was.
       */
      const docs = [], skipped = [];
      parsed.forEach(({ card, images: wanted }, i) => {
        const shaped = {
          ...card,
          front: { ...card.front, image: byUrl.get(wanted.front) ?? null },
          back: { ...card.back, image: byUrl.get(wanted.back) ?? null },
        };
        const check = cardSchema.safeParse(shaped);
        if (!check.success) { skipped.push(`card ${i + 1}: ${toAppError(check.error).message}`); return; }
        docs.push({ ...check.data, folder: folder.id, createdBy: user.id, updatedBy: user.id });
      });
      assert(docs.length, 400, failures.length
        ? `No cards could be added: ${failures.map(f => f.reason).slice(0, 2).join('; ')}`
        : skipped.slice(0, 3).join('; '));

      const rows = await Card.insertMany(docs, { session });
      const result = {
        collectionId: folder.id, collection: folder.title, added: rows.length,
        ...(fresh.length ? { imagesStored: fresh.length } : {}),
        ...(failures.length ? { imagesFailed: failures } : {}),
        ...(skipped.length ? { cardsSkipped: skipped } : {}),
      };
      // In the same transaction as the cards it describes. A batch written afterwards could be
      // lost to a crash in between, leaving cards nobody can undo and a retry that duplicates them.
      const [batch] = await AgentBatch.create([{
        user: user.id, token: grant?._id ?? null, tokenName: grant?.name || '',
        folder: folder.id, folderTitle: folder.title,
        cards: rows.map(r => r._id), cardCount: rows.length,
        media: fresh, imageCount: fresh.length,
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

  const { left, images: allowance } = await usageToday(user.id);
  return { ...created, remainingToday: left, ...(urls.length ? { imagesRemainingToday: allowance.left } : {}) };
}

/**
 * set_collection_cover — a picture for a private collection.
 *
 * Private only. A cover is the one piece of a collection a stranger sees before anything else, so
 * on a published one it is the most visible surface an assistant could be talked into changing;
 * refusing outright is simpler than any rule about which images are acceptable, and the person
 * can set a cover by hand on anything they have already chosen to publish.
 *
 * The previous cover is recorded rather than the change being one-way, so undoing this restores
 * what was there instead of leaving the collection pointing at an image about to be deleted.
 */
export async function setCollectionCover(user, grant, { collectionId, imageUrl, requestId }) {
  const url = agentImageUrl.parse(imageUrl);
  assert(url, 400, 'Give the https address of an image to use as the cover.');
  assert(String(requestId || '').trim(), 400, 'Send a requestId so a retry does not fetch this twice.');

  const done = await AgentBatch.findOne({ user: user.id, requestId });
  if (done) return { ...done.result, replayed: true };

  // The collection is checked before the fetch, so a cover aimed somewhere this account cannot
  // write is refused without making an outbound request at all.
  const target = await accessFolder(collectionId, user, 'editor');
  assert(target.visibility === 'private', 403,
    'That collection is published, so its cover can only be changed by hand. Assistants can set a cover on private collections.');

  await requireImageQuota(user.id, 1);
  const { body } = await fetchImage(url);
  const image = await media.ingest(body);

  try {
    return await mutateFolder(collectionId, user, 'editor', async (folder, session) => {
      // Re-checked inside the transaction: the collection may have been published between the
      // check above and here, and this is the read that is serialised against that change.
      assert(folder.visibility === 'private', 403, 'That collection is published, so its cover can only be changed by hand.');
      const { media: row, reused } = await media.persist(image, {
        folder: folder.id, user: user.id, sourceUrl: url, name: nameFromUrl(url), session,
      });
      const previous = folder.thumbnail ? String(folder.thumbnail) : '';
      await Folder.updateOne({ _id: folder._id }, { $set: { thumbnail: row._id } }, { session });
      const result = { collectionId: folder.id, collection: folder.title, cover: String(row._id), width: image.width, height: image.height };
      await AgentBatch.create([{
        user: user.id, token: grant?._id ?? null, tokenName: grant?.name || '',
        folder: folder.id, folderTitle: folder.title,
        media: reused ? [] : [row._id], imageCount: reused ? 0 : 1,
        coverMedia: row._id, previousCover: previous,
        requestId, result,
      }], { session });
      await recordEvent(folder, user, 'folder.updated', `Cover set by ${grant?.name || 'an assistant'}`, session);
      return result;
    });
  } catch (e) {
    if (e?.code === 11000 || e?.cause?.code === 11000) {
      const winner = await AgentBatch.findOne({ user: user.id, requestId });
      if (winner) return { ...winner.result, replayed: true };
    }
    throw e;
  }
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
    imageCount: b.imageCount || 0,
    cover: !!b.coverMedia,
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

  const mediaIds = (batch.media || []).map(oid);
  const { removed, orphaned, imagesRemoved } = await mutateFolder(batch.folder, user, 'editor', async (f, session) => {
    const ids = batch.cards.map(oid);
    const { deletedCount } = await Card.deleteMany({ _id: { $in: ids }, folder: f._id }, { session });
    await Revision.deleteMany({ card: { $in: ids } }, { session });
    await Progress.deleteMany({ card: { $in: ids } }, { session });

    /**
     * Put the cover back before the image it might be pointing at is deleted.
     *
     * `$unset` rather than setting an empty string when there was nothing before, because the
     * field is a reference and the collection's cover falls back to its icon and colour when it
     * is absent — which is what it looked like before this batch ran.
     */
    if (batch.coverMedia && String(f.thumbnail || '') === String(batch.coverMedia)) {
      await Folder.updateOne({ _id: f._id }, batch.previousCover
        ? { $set: { thumbnail: oid(batch.previousCover) } }
        : { $unset: { thumbnail: 1 } }, { session });
    }

    /**
     * Images are only removed once nothing points at them any more.
     *
     * The batch records what it created, but a card written by hand afterwards may have picked
     * the same picture out of the collection's images, and a cover may have been set from it.
     * Deleting on the strength of the batch record alone would break those. This asks the
     * question directly instead, which is a small query against a list that is at most eight
     * long and is the difference between reclaiming space and losing somebody's image.
     */
    const unused = [];
    for (const id of mediaIds) {
      const stillUsed = await Card.exists({ folder: f._id, $or: [{ 'front.image': id }, { 'back.image': id }] }).session(session)
        || await Folder.exists({ thumbnail: id }).session(session);
      if (!stillUsed) unused.push(id);
    }
    const purged = await media.purge(unused, { session });

    await AgentBatch.updateOne({ _id: batch._id }, { $set: { undoneAt: new Date() } }, { session });
    await recordEvent(f, user, 'cards.imported', `${deletedCount} assistant cards removed`, session, f.id, { count: deletedCount });
    return { removed: deletedCount, orphaned: purged.keys, imagesRemoved: purged.rows };
  });

  /**
   * The bucket is emptied after the transaction commits, never inside it.
   *
   * An object delete cannot be rolled back. Doing it inside a transaction that then aborts —
   * and this one is retried on a write conflict like any other — would destroy bytes the
   * rollback promises to have kept. Afterwards the worst case is an object nobody references,
   * which is a fraction of a penny and can be swept; `storage.remove` is best-effort for the
   * same reason and reports rather than throws.
   */
  if (orphaned.length) await storage.remove(orphaned);
  return { removed, collection: folder.title, imagesRemoved };
}
