import { Media } from '../models/index.js';
import * as storage from './storage.js';
import { ingest } from './images.js';

export { ingest };

/**
 * Turning a processed image into a stored one, and taking stored ones away again.
 *
 * Split from `images.js` because the two halves answer different questions: that one decides
 * whether bytes are safe, this one decides where they go and whether they need to go anywhere at
 * all. Keeping them apart is what lets an assistant fetch a URL, check it, and only then take out
 * a transaction — a network round trip inside one would hold locks for as long as a stranger's
 * server felt like taking to answer.
 */

/**
 * Store an image, unless this collection already has it.
 *
 * The duplicate check is the main defence against a bucket filling up with the same picture. An
 * assistant working through a chapter will put one diagram on every card that references it, and
 * without this each card pays for its own copy of identical bytes — storage, a write, and a
 * separate resize for every width later requested. Recognising it costs one indexed lookup.
 *
 * Matching on the hash of the *processed* output rather than the source URL is what makes it
 * work in practice: the same illustration served from two addresses, or re-fetched after a query
 * string changed, is one image once it has been through the encoder.
 *
 * The bucket write happens inside the caller's transaction and cannot be rolled back with it, so
 * a transaction that aborts after this point leaves an unreferenced object behind. That is the
 * existing trade everywhere images are stored: an orphaned object costs a fraction of a penny,
 * and the alternative — writing the row first and the bytes after — risks a row pointing at
 * nothing, which is a broken image on somebody's card.
 */
export async function persist(image, { folder, user, name = '', sourceUrl = '', session = null }) {
  const found = await Media.findOne({ folder, sha256: image.sha256 }).select('_id').session(session).lean();
  if (found) return { media: found, reused: true };

  const key = storage.isConfigured() ? storage.newKey(folder) : '';
  if (key) await storage.put(key, image.data, 'image/webp');
  const [media] = await Media.create([{
    folder,
    uploadedBy: user,
    name: String(name || '').slice(0, 150),
    width: image.width,
    height: image.height,
    bytes: image.bytes,
    sha256: image.sha256,
    sourceUrl: sourceUrl.slice(0, 500),
    // Without a bucket configured the bytes live in the database, exactly as they used to. A
    // fresh clone and the test suites have no credentials and are meant to keep working.
    ...(key ? { key } : { data: image.data }),
  }], { session });
  return { media, reused: false };
}

/** The convenience form for a person choosing a file: check the bytes, then store them. */
export const store = async (buffer, options) => persist(await ingest(buffer), options);

/**
 * Every bucket key belonging to these images, read now rather than recorded earlier.
 *
 * Resized copies are generated the first time a browser asks for a width, which can be months
 * after the image was stored. Anything that remembered the keys at upload time would miss them
 * and leave them in the bucket forever, which is the usual way an "images are deleted" claim
 * turns out to be half true.
 */
export async function keysFor(ids) {
  if (!ids?.length) return [];
  const rows = await Media.find({ _id: { $in: ids } }).select('key variants').lean();
  return rows.flatMap(row => storage.allKeysFor(row.key, row.variants));
}

/**
 * Delete the rows, then the objects — in that order, and the objects outside any transaction.
 *
 * A bucket delete is not transactional. Doing it inside one means a transaction that later aborts
 * has already destroyed the bytes its rollback promises to keep, and that loses somebody's
 * picture. Doing it after the commit can only leave an object behind, which is recoverable.
 */
export async function purge(ids, { session = null } = {}) {
  if (!ids?.length) return { rows: 0, keys: [] };
  const keys = await keysFor(ids);
  const { deletedCount } = await Media.deleteMany({ _id: { $in: ids } }, { session });
  return { rows: deletedCount, keys };
}
