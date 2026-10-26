import * as storage from './storage.js';
import { Blob } from '../models/index.js';

/**
 * A plain key–value store for documents the app writes whole and reads whole.
 *
 * Four operations — put, get, list by prefix, delete — and nothing that knows what a folder, a
 * card or a user is. That is the point: whatever holds the cards can change without anything
 * stored here having to move or be rewritten, because nothing here refers to it.
 *
 * In production the objects live in the bucket. Without one configured (a fresh clone, the test
 * suites) they live in a single collection keyed by the same string, which is the one place this
 * touches a database at all, and any key–value table — DynamoDB included — has exactly that
 * shape: a string key and some bytes.
 */

const bucket = () => storage.isConfigured();

export async function put(key, body, contentType = 'application/json') {
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body);
  if (bucket()) return storage.put(key, bytes, contentType);
  await Blob.updateOne({ _id: key }, { $set: { body: bytes, contentType, bytes: bytes.length } }, { upsert: true });
}

/** The bytes under `key`, or null. */
export async function get(key) {
  if (bucket()) return storage.find(key);
  const row = await Blob.findById(key).lean();
  return row ? Buffer.from(row.body.buffer ?? row.body) : null;
}

export async function exists(key) {
  if (bucket()) return storage.exists(key);
  return !!await Blob.exists({ _id: key });
}

export async function list(prefix) {
  if (bucket()) return storage.listKeys(prefix);
  const rows = await Blob.find({ _id: { $regex: `^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}` } }).select('_id').lean();
  return rows.map(r => r._id);
}

/** Best-effort, like every other storage delete: a leftover object costs far less than a false failure. */
export async function remove(keys) {
  const list = keys.filter(Boolean);
  if (!list.length) return { removed: 0 };
  if (bucket()) return storage.remove(list);
  const { deletedCount } = await Blob.deleteMany({ _id: { $in: list } });
  return { removed: deletedCount };
}

export async function copy(from, to) {
  if (bucket()) return storage.copy(from, to);
  const body = await get(from);
  if (body) await put(to, body);
}
