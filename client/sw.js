// The service worker for the installed app. The two placeholders below are filled in at build time
// from the files the build actually produced, so this is never served as written; see the pwa
// plugin in vite.config.js. It is registered only from a production build, because in development
// Vite serves unbundled modules and a cache in front of them would fight hot reloading.
//
// What this buys: the app opens instantly and keeps opening with no connection, which is the whole
// difference between a bookmark and something that feels installed. What it deliberately does not
// do is cache anything you are signed into. Study data, folders, and cards all come from /api on
// every request, so nothing here can show one account's material to another, and signing out cannot
// leave a readable copy behind.
const CACHE = '%CACHE%';
const PRECACHE = %PRECACHE%;

/** Hashed filenames, so the content behind one can never change. Anything else can. */
const immutable = pathname => pathname.startsWith('/assets/');

self.addEventListener('install', event => {
  // index.html is fetched on its own and allowed to fail the install, because it is the one file
  // that offline depends on: without it a page load has nothing to fall back to. The rest is
  // requested together and forgiven, so a single unlucky asset cannot leave the app uninstallable.
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.add('/index.html');
    await Promise.all(PRECACHE.filter(path => path !== '/index.html').map(path => cache.add(path).catch(() => {})));
  })());
});

self.addEventListener('activate', event => {
  // Every build gets its own cache name, so this is what stops old builds accumulating. It only
  // runs once no tab is still using the previous worker, which is why the previous build's assets
  // are safe to delete here: nothing is left that could ask for them.
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(n => n !== CACHE && n.startsWith('%CACHE_PREFIX%')).map(n => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // The API and the realtime socket are never cached: one is per-account and the other is a
  // long-lived connection that a cache would break outright.
  if (url.pathname.startsWith('/api') || url.pathname.startsWith('/socket.io')) return;

  if (request.mode === 'navigate') return event.respondWith(shell(request));
  // Hashed assets are cached whether or not they were precached, which is how the maths renderer
  // and the web fonts end up available offline without being made part of every install.
  if (immutable(url.pathname) || PRECACHE.includes(url.pathname)) event.respondWith(asset(event, url.pathname));
});

/**
 * Network first for page loads, because a cached copy of the HTML is a cached copy of which script
 * files to load, and serving a stale one after a deploy asks the browser for assets that no longer
 * exist. Online you always get the current app; offline you get the last one that worked, which
 * then finds everything it needs in the same cache.
 */
async function shell(request) {
  try {
    return await fetch(request);
  } catch {
    const cache = await caches.open(CACHE);
    return (await cache.match('/index.html')) || Response.error();
  }
}

async function asset(event, pathname) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(pathname);
  if (hit && immutable(pathname)) return hit;
  // Everything else keeps its name between builds, so a cached copy is served for speed and
  // replaced in the background rather than trusted indefinitely.
  const fresh = fetch(event.request).then(response => {
    if (response.ok) cache.put(pathname, response.clone());
    return response;
  });
  if (!hit) return fresh;
  event.waitUntil(fresh.catch(() => {}));
  return hit;
}
