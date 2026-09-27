import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { BRAND, storageKeys } from './shared/brand.js';

/** index.html cannot import modules, so the %BRAND_*% placeholders in it are filled from the same
 *  config the app uses. Renaming the product stays a one-line change. */
const brandHtml = () => ({
  name: 'brand-html',
  transformIndexHtml: html => html
    .replace(/%BRAND_TITLE%/g, BRAND.title)
    .replace(/%BRAND_SHORT_NAME%/g, BRAND.name)
    .replace(/%BRAND_DESCRIPTION%/g, BRAND.description)
    .replace(/%BRAND_THEME_KEYS%/g, storageKeys('theme').join(',')),
});

/** The home-screen icons, which nothing in the HTML references but an install needs to hand. */
const manifestIcons = ['/icons/icon-192.png', '/icons/icon-512.png', '/icons/icon-maskable-512.png'];

/**
 * What a phone needs before it will offer to install the app: a manifest describing it, and a
 * service worker that can serve it with no connection.
 *
 * The manifest is generated rather than committed for the same reason index.html is templated —
 * it spells out the product name three times, and the rule in this codebase is that only
 * shared/brand.js does that.
 */
const pwa = () => {
  const manifest = () => JSON.stringify({
    id: '/',
    name: BRAND.title,
    short_name: BRAND.name,
    description: BRAND.description,
    start_url: '/',
    scope: '/',
    // minimal-ui is offered first for the browsers that support it: it keeps a reload affordance,
    // which matters for an app whose content lives on a server.
    display_override: ['minimal-ui', 'standalone'],
    display: 'standalone',
    // The splash screen behind the icon, so it matches the page rather than flashing white first.
    background_color: '#f5f3fa',
    theme_color: '#5a45e0',
    categories: ['education', 'productivity'],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      // Android crops this one to the launcher's shape, so it is drawn with room to lose.
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      { name: 'My library', url: '/' },
      { name: 'My progress', url: '/progress' },
    ],
  }, null, 2);

  return {
    name: 'pwa',
    // Dev has no service worker, but it should still be installable enough to check the manifest.
    configureServer(server) {
      server.middlewares.use('/manifest.webmanifest', (_req, res) => {
        res.setHeader('Content-Type', 'application/manifest+json');
        res.end(manifest());
      });
    },
    // writeBundle rather than generateBundle, because the list has to describe files that exist.
    // The bundle object at generate time includes chunks Vite goes on to merge or rename, and a
    // precache list naming one of those would 404 and take the whole install down with it.
    async writeBundle({ dir }) {
      const at = file => new URL(file, `file://${dir}/`);
      await writeFile(at('manifest.webmanifest'), manifest());
      // Whatever the built HTML asks for is by definition what a first paint needs, so the shell is
      // read back out of it rather than assembled by hand: no list to keep in step with the build.
      // Everything else — the maths renderer, the web fonts, several megabytes between them — is
      // cached the first time it is actually used instead of being made to slow down every install.
      const html = await readFile(at('index.html'), 'utf8');
      const referenced = [...html.matchAll(/(?:src|href)="(\/[^"]*)"/g)].map(m => m[1]);
      const shell = [...new Set(['/index.html', ...referenced, ...manifestIcons])].sort();
      for (const path of shell) {
        // A precache entry that cannot be fetched fails the install, and it fails it in a service
        // worker on someone's phone rather than here. Much better to break the build.
        if (!existsSync(at(path.slice(1)))) throw new Error(`pwa: ${path} is precached but was not built`);
      }
      // A cache named after the contents of the build, which is what makes a deploy replace the old
      // one instead of sitting behind it.
      const prefix = `${BRAND.slug}-shell-`;
      const version = createHash('sha256').update(shell.join('\n')).digest('hex').slice(0, 12);
      const worker = (await readFile(new URL('./client/sw.js', import.meta.url), 'utf8'))
        .replace(/%CACHE%/g, prefix + version)
        .replace(/%CACHE_PREFIX%/g, prefix)
        .replace(/%PRECACHE%/g, JSON.stringify(shell));
      await writeFile(at('sw.js'), worker);
    },
  };
};

export default defineConfig({
  plugins: [react(), brandHtml(), pwa()],
  server: { host: '0.0.0.0', port: 4173, strictPort: true, allowedHosts: ['terminal.local'], proxy: { '/api': 'http://127.0.0.1:4000', '/socket.io': { target: 'http://127.0.0.1:4000', ws: true } } },
  build: { outDir: 'dist', sourcemap: false }
});
