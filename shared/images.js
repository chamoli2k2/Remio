/**
 * The widths an image is served at.
 *
 * A short, fixed ladder rather than any width a caller asks for. Two reasons, and the second is
 * the important one:
 *
 *  - Every distinct width is a separate object stored in the bucket forever. An open-ended `?w=`
 *    lets anyone fill it by walking the numbers, which costs storage and CPU on a request nobody
 *    made in good faith.
 *  - A handful of sizes is all a browser can use anyway. It picks the smallest entry wide enough
 *    for the slot at the current pixel density, so the gaps between these numbers are the only
 *    precision that has any effect on what gets downloaded.
 *
 * Uploads are capped at 1600px on the long edge, so 1280 is the widest worth offering; above that
 * the original is already the right answer.
 */
export const IMAGE_WIDTHS = [320, 640, 960, 1280];

export const isImageWidth = w => IMAGE_WIDTHS.includes(w);

/** Parses a `?w=` value, returning null for anything not on the ladder. */
export function imageWidth(value) {
  const w = Number(value);
  return Number.isInteger(w) && isImageWidth(w) ? w : null;
}

/**
 * A `srcset` for one image, given whatever turns a media id into a URL.
 *
 * `max` is the image's own width when that is known: offering a browser a 1280px version of a
 * 400px original wastes a request to be handed the same pixels back, upscaled.
 */
export function srcSet(url, { max = 0 } = {}) {
  const widths = IMAGE_WIDTHS.filter(w => !max || w <= max);
  if (!widths.length) return '';
  return widths.map(w => `${url(w)} ${w}w`).join(', ');
}
