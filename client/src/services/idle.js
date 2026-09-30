/**
 * Runs `fn` once the browser has nothing more important to do.
 *
 * For work worth doing before it is needed but never worth delaying a paint for: fetching the
 * editor for somebody who is allowed to edit, warming the data behind a link under the cursor.
 * Returns a cancel function, so an effect can drop the work if the reason for it goes away before
 * it runs.
 *
 * requestIdleCallback is still missing in Safari, where a short timeout is a fair stand-in. The
 * point is to yield the current frame rather than to measure spare capacity precisely.
 */
export function whenIdle(fn, timeout = 2000) {
  if (typeof window === 'undefined') return () => {};
  if (typeof requestIdleCallback === 'function') {
    const handle = requestIdleCallback(fn, { timeout });
    return () => cancelIdleCallback(handle);
  }
  const handle = setTimeout(fn, 200);
  return () => clearTimeout(handle);
}
