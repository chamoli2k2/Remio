import mongoose from 'mongoose';
import { ref, options } from './_shared.js';
const { Schema, model } = mongoose;
// `width` is the original's own width, so no resized copy wider than the picture is ever offered.
// `variants` records which widths have been generated, which is cheaper than asking the bucket: the
// row is already loaded to check permission, and a listing would be a second network call per image.
// Exactly one of `folder` and `notebook` is set: an image belongs to a collection or to a notebook,
// and permission to see it is read from whichever that is.
const media = new Schema({ folder: ref('Folder', false), notebook: ref('Notebook', false), uploadedBy: ref('User'), data: { type: Buffer, select: false }, key: { type: String, default: '' }, contentType: { type: String, default: 'image/webp' }, name: String, width: { type: Number, default: 0 }, height: { type: Number, default: 0 }, variants: { type: [Number], default: [] },
  // A fingerprint of the stored bytes, so the same picture arriving twice is recognised and
  // stored once. See `mediaService.store`.
  sha256: { type: String, default: '' },
  bytes: { type: Number, default: 0 },
  // Where it came from, when it was fetched rather than uploaded. Kept so a reported image can be
  // traced back to the address that supplied it, which an uploaded file does not need because the
  // account that chose the file is already recorded.
  sourceUrl: { type: String, default: '' },
}, options);
/**
 * Duplicate lookup, scoped to the collection rather than the account.
 *
 * Tempting to dedupe across everything a user owns and wrong to: permission to see an image is
 * derived from the collection it belongs to, so handing back a row from another collection would
 * either fail the access check or quietly widen it. Within a collection — an assistant putting
 * the same diagram on eight cards — is where the duplicates actually are.
 *
 * Not unique. Images stored before this field existed, and ones copied from a folder that had
 * them, can share the empty default, and a constraint would refuse the second of those for no
 * benefit — the lookup always searches for a real hash, which an empty string never matches.
 */
media.index({ folder: 1, sha256: 1 });
media.index({ notebook: 1, sha256: 1 }, { sparse: true });
export const Media = model('Media', media);
