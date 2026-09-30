import { api } from './api';

/**
 * Queries that more than one place needs to name.
 *
 * A cache key and the function that fills it have to agree, and when they are spelled out at each
 * call site they eventually stop agreeing. This one matters: a collection and its cards are stored
 * together under a single key, so anything filling that key has to fetch both. Prefetching it with
 * only the folder would leave an entry in the cache with no cards in it, and the page would then
 * render empty from a cache hit — a bug that looks like data loss and is very hard to see.
 *
 * Used by the signed-in folder page, the public one, and the tiles that prefetch on hover.
 */
export const folderQuery = id => [
  `/folders/${id}`,
  () => Promise.all([api(`/folders/${id}`), api(`/folders/${id}/cards`)]).then(([folder, cards]) => ({ ...folder, ...cards })),
];
