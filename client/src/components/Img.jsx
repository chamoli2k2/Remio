import { imageUrl } from '../services/api';
import { srcSet } from '../../../shared/images.js';

/**
 * Every uploaded image in the app.
 *
 * It exists because three attributes are easy to leave off an `<img>` and expensive to omit, and
 * leaving them off forty times is how a page ends up slow in ways no profiler points at:
 *
 *  - `loading="lazy"`, so a grid of covers fetches the ones on screen instead of opening a
 *    connection for every card in a fifty-card collection at once.
 *  - `decoding="async"`, so decoding a large image happens off the main thread rather than
 *    blocking the frame it arrives in.
 *  - `srcset` and `sizes`, so the browser asks for a width suited to the slot. Without them a
 *    1600px upload is downloaded in full to be painted 117px tall, which is most of the bytes on
 *    a page like Explore.
 *
 * `eager` is for the one image that is the largest thing above the fold — lazy-loading that one
 * delays the very measurement it would otherwise improve, because the browser cannot begin
 * fetching it until layout says it is visible.
 *
 * Dimensions are worth passing whenever the slot's shape is known. They let the browser reserve
 * the right box before any bytes arrive, which is the difference between a page that settles and
 * one that jumps as each image lands. The jumping is measured as layout shift and counts against
 * the site in search results, so this is an SEO attribute as much as a visual one.
 */
export default function Img({ id, src, alt = '', sizes, width, height, max, eager = false, className = '', ...rest }) {
  const url = src || imageUrl(id);
  if (!url) return null;
  // A plain `src` is an asset shipped with the build at a fixed size; only uploads have variants.
  const set = id && !src ? srcSet(w => `${imageUrl(id)}?w=${w}`, { max }) : '';
  return <img
    className={className}
    src={url}
    {...(set ? { srcSet: set, sizes: sizes || '100vw' } : {})}
    alt={alt}
    width={width}
    height={height}
    loading={eager ? 'eager' : 'lazy'}
    // Tells the browser this one is worth fetching before the images below it, which only means
    // anything for the image we have said is eager.
    fetchPriority={eager ? 'high' : undefined}
    decoding="async"
    {...rest}
  />;
}
