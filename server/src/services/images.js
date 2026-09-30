import crypto from 'node:crypto';
import sharp from 'sharp';
import { assert } from '../utils/errors.js';

/**
 * The one place bytes become a stored image.
 *
 * Every route that accepts a picture — a person choosing a file, an assistant naming a URL — comes
 * through here, because the defence against a malicious image is the processing itself and a
 * second copy of that processing is a second chance to get it wrong.
 *
 * What makes it safe is that nothing is passed through. The bytes are decoded and re-encoded as
 * WebP, which means the file that lands in the bucket was written by us from a pixel buffer, not
 * by whoever uploaded it. That single property defeats most of the category at once:
 *
 *  - A polyglot file with HTML or JavaScript hidden after the image data loses the trailing bytes,
 *    because they are not pixels and never reach the encoder.
 *  - EXIF is dropped, taking GPS coordinates and camera serial numbers with it. `rotate()` is
 *    called first so the orientation tag is honoured before the tag is discarded, rather than
 *    leaving the picture sideways.
 *  - A decompression bomb — a small file declaring enormous dimensions — is refused by
 *    `limitInputPixels` before any allocation, and the resize bounds cap what is kept anyway.
 *
 * What re-encoding does *not* protect is the decoder itself, which is why the format is checked
 * against an allowlist before any of it runs. See below.
 */

/**
 * The formats whose decoders we are willing to expose.
 *
 * Notably absent is SVG, which libvips will happily accept: it is not a picture but a document,
 * parsed by an XML library, with its own facilities for pulling in external entities and for
 * expanding into far more memory than it occupies on disk. Rasterising it does produce a safe
 * WebP, so the *output* was never the problem — the risk is entirely in the parse, and the only
 * reliable way to avoid a parser is to not run it.
 *
 * This is also what the interface has always promised. The upload error has said "JPG, PNG, or
 * WebP" for as long as it has existed; until now that was a description of the common cases rather
 * than a rule, and anything libvips could read got in.
 */
const ALLOWED = new Set(['jpeg', 'png', 'webp']);
const REFUSAL = 'Use a JPG, PNG, or WebP image.';

/** Beyond this many pixels a file is a bomb rather than a photograph, whatever it claims to be. */
const MAX_PIXELS = 25_000_000;
/** The longest edge kept. A card or a cover is never displayed larger than this. */
const MAX_EDGE = 1600;
/** What may be written to the bucket, after everything above has had its say. */
export const MAX_STORED_BYTES = 3 * 1024 * 1024;

/**
 * Decode, check, re-encode, and describe.
 *
 * The metadata read is a separate decode of the header on purpose, and it happens *first*: the
 * format has to be known before a transform pipeline is built over it, or the allowlist would be
 * enforced after the decoder it is meant to keep us out of had already run.
 *
 * `failOn: 'error'` rather than sharp's default of tolerating truncated and malformed input. A
 * half-decoded image is not something to store and serve; it is a sign the bytes are not what they
 * say they are.
 */
export async function ingest(buffer, { maxBytes = MAX_STORED_BYTES } = {}) {
  assert(Buffer.isBuffer(buffer) && buffer.length, 400, 'That image is empty.');

  let format;
  try { ({ format } = await sharp(buffer, { limitInputPixels: MAX_PIXELS, failOn: 'error' }).metadata()); }
  catch { assert(false, 400, REFUSAL); }
  assert(ALLOWED.has(format), 400, REFUSAL);

  let data, info;
  try {
    ({ data, info } = await sharp(buffer, { limitInputPixels: MAX_PIXELS, failOn: 'error' })
      .rotate()
      .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer({ resolveWithObject: true }));
  } catch { assert(false, 400, REFUSAL); }

  assert(data.length <= maxBytes, 413, 'That image is too large even after processing.');

  return {
    data,
    // The dimensions of the result, not of the input, so no resized copy wider than the picture
    // itself is ever offered to a browser.
    width: info.width,
    height: info.height,
    bytes: data.length,
    /**
     * A fingerprint of the *output*, which is what makes it useful for recognising a duplicate.
     * Two different JPEGs of the same photograph hash differently as input and identically here
     * only if they truly encode to the same WebP — and that is the thing worth storing once.
     */
    sha256: crypto.createHash('sha256').update(data).digest('hex'),
    sourceFormat: format,
  };
}
