import crypto from 'node:crypto';
import * as blobs from './blobStore.js';
import { accessFolder } from './accessService.js';
import { assert } from '../utils/errors.js';
import { DRAWING_ID, LIMITS } from '../../../shared/drawing.js';

/**
 * Drawings on cards, stored as documents in the blob store.
 *
 * The key is `drawings/<folder>/<id>.json`, so a drawing belongs to exactly one folder by where
 * it is kept rather than by a row saying so. Reading one checks access to the folder named in the
 * request and then looks only under that folder's prefix, which means a drawing id lifted from one
 * collection finds nothing when asked for through another. Deleting a folder's drawings, or copying
 * them with the folder, is an operation on the prefix and needs no index of what is there.
 *
 * Nothing is updated in place. A save writes a new id, and the card is pointed at it when the card
 * itself is saved — so a drawing someone abandoned without saving the card is the only thing that
 * can be left behind, and it goes when the folder does.
 */

const prefixFor = folderId => `drawings/${folderId}/`;
export const keyFor = (folderId, id) => `${prefixFor(folderId)}${id}.json`;

export async function save(folderId, user, doc) {
  const folder = await accessFolder(folderId, user, 'editor');
  assert(!folder.archived, 409, 'Restore this folder before adding drawings.');
  const body = JSON.stringify(doc);
  assert(Buffer.byteLength(body) <= LIMITS.bytes, 413, 'This drawing is too large to save. Try clearing part of it.', 'DRAWING_TOO_LARGE');
  const id = crypto.randomUUID();
  await blobs.put(keyFor(folder.id, id), body, 'application/json');
  return { id };
}

/** The document, with the folder it was read through, so the caller can decide how to cache it. */
export async function read(folderId, id, user) {
  assert(DRAWING_ID.test(id), 404, 'Drawing not found.');
  const folder = await accessFolder(folderId, user);
  const body = await blobs.get(keyFor(folder.id, id));
  assert(body, 404, 'Drawing not found.');
  return { folder, body };
}

/** Card sides may only point at drawings stored under their own folder. */
export async function verify(body, folderId) {
  for (const side of ['front', 'back']) {
    const id = body[side]?.drawing;
    if (id) assert(await blobs.exists(keyFor(folderId, id)), 400, 'That drawing does not belong to this folder.', 'DRAWING_NOT_FOUND');
  }
}

/** Every drawing id a set of card-like objects refers to: cards, revision snapshots, either side. */
export const idsIn = items => [...new Set(items.flatMap(c => [c?.front?.drawing, c?.back?.drawing]).filter(Boolean))];

export const remove = (folderId, ids) => blobs.remove(ids.map(id => keyFor(folderId, id)));

/** Copies keep their ids: the copy's cards point at the same id, now under the copy's prefix. */
export async function copyFolder(fromId, toId) {
  const keys = await blobs.list(prefixFor(fromId));
  for (const key of keys) await blobs.copy(key, `${prefixFor(toId)}${key.slice(prefixFor(fromId).length)}`);
  return keys.length;
}

export async function removeFolder(folderId) {
  try { return await blobs.remove(await blobs.list(prefixFor(folderId))); }
  catch { return { removed: 0 }; }
}
