import crypto from 'node:crypto';
import { S3Client, PutObjectCommand, GetObjectCommand, CopyObjectCommand, DeleteObjectsCommand } from '@aws-sdk/client-s3';
import { IMAGE_WIDTHS } from '../../../shared/images.js';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { AppError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

/**
 * Where uploaded images live.
 *
 * They used to live in MongoDB as Buffer fields, which works and does not scale: a 512 MB database
 * fills with a few hundred screenshots, every read pulls the bytes through the Node process, and
 * copying a public folder duplicated the bytes rather than pointing at them.
 *
 * This is the whole of the object-storage surface. Everywhere else in the app keeps talking about
 * a media row; only this file knows there is a bucket, which is what makes the fallback below
 * possible and what would make swapping R2 for something else a change to one file.
 *
 * Unconfigured is a supported state, not an error. With no credentials the app stores bytes in the
 * database exactly as it always did, so the test suites, a fresh clone, and any deployment that
 * has not set this up keep working with nothing to configure.
 */
const bucket = () => process.env.R2_BUCKET || '';
// Accepts either form: the endpoint written out, or the account id it is derived from.
const endpoint = () => process.env.R2_ENDPOINT || (process.env.R2_ACCOUNT_ID ? `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com` : '');
const keyId = () => process.env.R2_ACCESS_KEY_ID || '';
const secret = () => process.env.R2_SECRET_ACCESS_KEY || '';

export const isConfigured = () => !!(bucket() && endpoint() && keyId() && secret());

/**
 * Built once and reused. The client holds connection pools, so constructing one per request would
 * trade the whole point of moving the bytes out of the process for a new handshake every time.
 * Rebuilt if the configuration changes underneath it, which only happens in tests.
 */
let client = null, builtFor = '';
function s3() {
  const signature = `${endpoint()}|${keyId()}|${bucket()}`;
  if (!client || builtFor !== signature) {
    client = new S3Client({
      // R2 ignores the region but the SDK insists on one.
      region: 'auto',
      endpoint: endpoint(),
      credentials: { accessKeyId: keyId(), secretAccessKey: secret() },
    });
    builtFor = signature;
  }
  return client;
}

const EXTENSIONS = { 'image/webp': 'webp', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif' };

/**
 * A key that reveals nothing and cannot collide.
 *
 * Random rather than derived from the media id, because a presigned URL leaks its key in the
 * address bar and a guessable one would let somebody walk the bucket. The folder prefix is there
 * for the humans reading a bucket listing, not for lookups.
 */
export const newKey = (folderId, contentType = 'image/webp') =>
  `f/${folderId}/${crypto.randomUUID()}.${EXTENSIONS[contentType] || 'bin'}`;

/**
 * Where a resized copy of `key` lives.
 *
 * Derived from the original rather than random, because unlike the original this one is looked up:
 * the request says "that image, 640 wide" and this has to answer without a search. Prefixed by
 * width so a bucket listing groups them, and so deleting one size is a prefix delete.
 *
 * It leaks the original key to anyone holding a resized link, which is deliberate — they already
 * have the picture. The randomness in the original is there to stop the bucket being walked from
 * nothing, and a derived key gives away only an image its holder can already see.
 */
export const variantKey = (key, width) => `d/${width}/${key}`;

/**
 * Every key belonging to an original, for deleting it and its resized copies together.
 *
 * Nothing for an image that was never stored in the bucket, rather than a key built around an
 * empty string: `d/320/` is not an object anybody wrote, and asking to delete it would make a
 * successful cleanup look partly failed.
 */
export const allKeysFor = (key, variants = []) =>
  (key ? [key, ...variants.filter(w => IMAGE_WIDTHS.includes(w)).map(w => variantKey(key, w))] : []);

/** Reads an object back. Only used to resize an original that was uploaded before this existed. */
export async function get(key) {
  try {
    const out = await s3().send(new GetObjectCommand({ Bucket: bucket(), Key: key }));
    return Buffer.from(await out.Body.transformToByteArray());
  } catch (cause) { throw fail('read an image', cause); }
}

const fail = (action, cause) => {
  logger.error(`object storage could not ${action}`, { error: cause?.message });
  return new AppError(502, 'We could not store that image just now. Please try again.', 'STORAGE_UNAVAILABLE', { cause });
};

export async function put(key, body, contentType = 'image/webp') {
  try {
    await s3().send(new PutObjectCommand({
      Bucket: bucket(), Key: key, Body: body, ContentType: contentType,
      // Immutable: a key is random and its bytes never change, so anything holding it may keep it.
      CacheControl: 'private, max-age=31536000, immutable',
    }));
  } catch (cause) { throw fail('store an image', cause); }
}

/** Server-side copy: the bytes never travel to us and back, and cost no egress. */
export async function copy(fromKey, toKey) {
  try {
    await s3().send(new CopyObjectCommand({ Bucket: bucket(), CopySource: `${bucket()}/${fromKey}`, Key: toKey }));
  } catch (cause) { throw fail('copy an image', cause); }
}

/**
 * Deleting is best-effort on purpose.
 *
 * It is called after the database rows are already gone, so throwing here would report a failure
 * for a deletion that in every way that matters succeeded. A leftover object costs a fraction of a
 * penny and can be swept up; a delete that appears to have failed sends somebody looking for data
 * that is not there.
 */
export async function remove(keys) {
  const list = keys.filter(Boolean);
  if (!list.length || !isConfigured()) return { removed: 0 };
  try {
    // One request per thousand, which is the API's limit.
    for (let i = 0; i < list.length; i += 1000) {
      await s3().send(new DeleteObjectsCommand({
        Bucket: bucket(), Delete: { Objects: list.slice(i, i + 1000).map(Key => ({ Key })), Quiet: true },
      }));
    }
    return { removed: list.length };
  } catch (error) {
    logger.error('some stored images could not be deleted', { error: error.message, count: list.length });
    return { removed: 0, error: error.message };
  }
}

/**
 * How long a signed link stays good for, and how long the browser may reuse the redirect to it.
 *
 * The cache window is deliberately shorter than the signature. A browser that cached the redirect
 * for as long as the link is valid would, at the boundary, follow one that had just expired.
 */
export const SIGNED_SECONDS = 600;
export const REDIRECT_CACHE_SECONDS = 240;

/**
 * The same two numbers for an image in a published collection, where the brevity above buys
 * nothing.
 *
 * A short signature protects a private image: the link is one viewer's, and it stops being useful
 * quickly if it escapes. For a collection anyone may read, there is nothing to protect — the link
 * only reaches a picture already on a public page — so it lasts long enough that a browser stops
 * asking for it. That turns a repeat visit from one redirect per image into none.
 *
 * Six days, not seven: signature v4 refuses anything beyond a week, and the cache window has to
 * stay inside the signature so a cached redirect cannot outlive the link it points at.
 */
export const PUBLIC_SIGNED_SECONDS = 6 * 24 * 60 * 60;
export const PUBLIC_REDIRECT_CACHE_SECONDS = 5 * 24 * 60 * 60;

export const signedUrl = (key, seconds = SIGNED_SECONDS) =>
  getSignedUrl(s3(), new GetObjectCommand({ Bucket: bucket(), Key: key }), { expiresIn: seconds });

/** Said once at boot, because a half-configured bucket fails at the first upload rather than here. */
export function configWarnings() {
  if (isConfigured()) return [];
  const some = [bucket(), endpoint(), keyId(), secret()].some(Boolean);
  return some ? ['Object storage is partly configured, so images will be stored in the database. Set R2_BUCKET, R2_ACCOUNT_ID (or R2_ENDPOINT), R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY.'] : [];
}
