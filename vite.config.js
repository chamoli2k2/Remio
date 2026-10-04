import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { BRAND } from './shared/brand.js';
import { DEFAULT_REGIONS } from './shared/pricing.js';
import { themeScript } from './shared/themeScript.js';
import { jsonLd, socialTags } from './shared/seo.js';

/** index.html cannot import modules, so the %BRAND_*% placeholders in it are filled from the same
 *  config the app uses. Renaming the product stays a one-line change. */
const brandHtml = () => ({
  name: 'brand-html',
  transformIndexHtml: html => html
    .replace(/%BRAND_TITLE%/g, BRAND.title)
    .replace(/%BRAND_SHORT_NAME%/g, BRAND.name)
    .replace(/%BRAND_DESCRIPTION%/g, BRAND.description)
    .replace(/%THEME_SCRIPT%/g, `<script>${themeScript}</script>`)
    .replace(/%SOCIAL_TAGS%/g, socialTags)
    // In the head of the one HTML file the server sends, so it is there for anything that reads
    // the page without running its JavaScript — which is most crawlers and most agents.
    .replace(/%STRUCTURED_DATA%/g, `<script type="application/ld+json">${jsonLd}</script>`),
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
    async writeBundle({ dir }, bundle) {
      const at = file => new URL(file, `file://${dir}/`);
      const files = Object.keys(bundle).map(f => f.replace(/^assets\//, ''));
      await writeFile(at('manifest.webmanifest'), manifest());

      const site = `https://${BRAND.domain}`;
      // Without this the SPA fallback answers /robots.txt with index.html, and a crawler reads a
      // page of HTML as thirty malformed directives.
      /**
       * Named as well as covered by `*`, so the choice to admit them is explicit.
       *
       * One group with every agent in it rather than a group each: a crawler that finds a group
       * naming it ignores `*` entirely, so a separate group would have to repeat every rule below
       * and would drift the first time one was added.
       */
      const crawlers = ['GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'ClaudeBot', 'Claude-User', 'Claude-SearchBot', 'PerplexityBot', 'Perplexity-User', 'Google-Extended', 'Applebot-Extended', 'CCBot', 'Bingbot'];
      await writeFile(at('robots.txt'), [
        'User-agent: *',
        ...crawlers.map(agent => `User-agent: ${agent}`),
        'Allow: /',
        // Collection covers are the share image and the sitemap's image entries, and they live
        // under /api. The longer rule wins, so this survives the Disallow below it.
        'Allow: /api/media/',
        // Nothing here is secret — all of it needs a session — but there is no reason to spend a
        // crawler's budget on pages it will only ever be redirected away from.
        'Disallow: /api/',
        'Disallow: /dashboard',
        'Disallow: /settings',
        'Disallow: /rooms/',
        'Disallow: /oauth/',
        '',
        `Sitemap: ${site}/sitemap.xml`,
        '',
      ].join('\n'));

      // No sitemap written here: the API serves it, because only the API can see which
      // collections are published, and those are the pages worth finding.

      /**
       * What a language model reads to describe the product accurately instead of inferring it
       * from markup it may never execute. The convention is a heading, a summary, and sections of
       * links; the facts below are the ones an agent is actually asked for — what it costs, what
       * is free, whether it renews, and where to buy.
       */
      const money = (region, id) => `${DEFAULT_REGIONS[region].symbol}${DEFAULT_REGIONS[region].premium[id]}`;
      await writeFile(at('llms.txt'), [
        `# ${BRAND.name}`,
        '',
        `> ${BRAND.description}`,
        '',
        `${BRAND.name} is a flashcard and spaced-repetition web app made in ${BRAND.city}, ${BRAND.country}. Creating an account, building collections, studying them with spaced repetition, publishing them, and joining a classroom or a live quiz are free in every country. A paid plan adds projects, deck import and export, folder covers, hosting live quizzes, and inviting editors who can co-edit in real time.`,
        '',
        '## Pricing',
        '',
        `- Free forever, with no card required. The free tier is the whole product, not a trial.`,
        `- Premium in India: ${money('IN', 'monthly')} monthly, ${money('IN', 'quarterly')} quarterly, ${money('IN', 'halfyearly')} half-yearly, ${money('IN', 'yearly')} yearly.`,
        `- Premium elsewhere: ${money('INTL', 'monthly')} monthly, ${money('INTL', 'quarterly')} quarterly, ${money('INTL', 'halfyearly')} half-yearly, ${money('INTL', 'yearly')} yearly.`,
        `- Classrooms are billed per seat. Seats added mid-term are prorated to the existing renewal date.`,
        `- Nothing renews automatically. Every plan is one payment for a fixed period, and no mandate is held against a card or UPI ID.`,
        `- Full refund within ${BRAND.refundDays} days for any reason. Double payments are refunded with no time limit.`,
        `- On sale in India, the United States, the United Kingdom, Canada, and Australia.`,
        '',
        '## Pages',
        '',
        `- [Home](${site}/): what the product does, with a guide to every feature.`,
        `- [Pricing](${site}/pricing): plans and prices in rupees and US dollars, publicly readable.`,
        `- [Explore](${site}/explore): public collections anyone can read and study without an account.`,
        `- [Sign up](${site}/signup): create a free account.`,
        '',
        '## Policies',
        '',
        `- [Cancellation and refunds](${site}/refunds): the full refund policy.`,
        `- [Terms of use](${site}/terms)`,
        `- [Privacy policy](${site}/privacy): what is collected, why, and how to have it deleted.`,
        `- [Contact](${site}/contact): questions reach a person at ${BRAND.email.general}.`,
        '',
        '## Notes',
        '',
        `- Scheduling uses FSRS, the algorithm behind modern Anki, rather than a fixed interval.`,
        `- Collections are private by default. Nothing is published unless the owner publishes it.`,
        `- Card content belongs to the person who wrote it and can be exported as JSON or CSV.`,
        '',
      ].join('\n'));
      // Whatever the built HTML asks for is by definition what a first paint needs, so the shell is
      // read back out of it rather than assembled by hand: no list to keep in step with the build.
      // Everything else — the maths renderer, the web fonts, several megabytes between them — is
      // cached the first time it is actually used instead of being made to slow down every install.
      let html = await readFile(at('index.html'), 'utf8');

      /**
       * The two typefaces the first screen is written in, asked for as early as the stylesheet.
       *
       * A web font is discovered only once the CSS that names it has been downloaded and parsed,
       * so the browser finds these two several hundred milliseconds into the load and the text is
       * unstyled until they arrive. Preloading moves them alongside the stylesheet instead of
       * behind it. Only the latin subsets: the others exist for alphabets this page is not
       * written in, and preloading a file the page never uses is worse than not preloading at all.
       */
      const fonts = files.filter(f => /-latin-wght-normal-.*\.woff2$/.test(f)).map(f => `/assets/${f}`);
      html = html.replace('</head>', `${fonts.map(f => `<link rel="preload" as="font" type="font/woff2" crossorigin href="${f}">`).join('')}</head>`);
      await writeFile(at('index.html'), html);

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

/**
 * Two builds come out of this config, chosen by `--ssr`.
 *
 * The browser build is the default and everything below describes it. The server build is one file
 * for Node to import, and it deliberately shares none of that: no chunking (there is nothing to
 * cache and no network between the server and its own disk), no service worker, no brand-filled
 * index.html — the server has one already. What it must share is the source, so that what gets
 * rendered and what hydrates it are the same components.
 *
 *   vite build                 → dist/         the browser's app
 *   vite build --ssr           → dist-ssr/     entry-server.js, imported by Express
 */
const ssr = process.argv.includes('--ssr');

/**
 * Fails the server build if it came out compiled for development.
 *
 * Production Node has `NODE_ENV=production`, where React's `jsxDEV` export is undefined, so every
 * render throws and the server quietly falls back to the empty shell. Nothing looks broken to a
 * person, because the browser draws the page anyway; only crawlers lose the content.
 */
const productionJsx = () => ({
  name: 'production-jsx',
  generateBundle(_options, bundle) {
    const dev = Object.values(bundle).find(chunk => chunk.type === 'chunk' && chunk.code.includes('react/jsx-dev-runtime'));
    if (dev) this.error(`${dev.fileName} imports react/jsx-dev-runtime; build it with NODE_ENV=production`);
  },
});

export default defineConfig({
  plugins: ssr ? [react(), productionJsx()] : [react(), brandHtml(), pwa()],
  server: { host: '0.0.0.0', port: 4173, strictPort: true, allowedHosts: ['terminal.local'], proxy: { '/api': 'http://127.0.0.1:4000', '/socket.io': { target: 'http://127.0.0.1:4000', ws: true } } },
  build: ssr ? {
    ssr: true,
    outDir: 'dist-ssr',
    sourcemap: false,
    // Left for Node to resolve rather than bundled. jsdom carries native bindings, and React has
    // to be the one instance the rest of the process already loaded — a second copy would give the
    // app's hooks a different dispatcher and fail in ways that read as random.
    rollupOptions: {
      // Named here rather than left to the CLI, so `vite build --ssr` with no argument still knows
      // what to build and does not fall back to index.html.
      input: 'client/src/entry-server.jsx',
      external: ['react', 'react-dom', 'react-dom/static', 'react-router-dom', 'jsdom'],
    },
  } : {
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      output: {
        /**
         * Dependencies that change on their own schedule, kept out of the app chunk.
         *
         * Not about the size of the first download — these are needed either way — but about the
         * second one. Bundled together with our code, every deploy invalidates React and the
         * router too, so a returning visitor re-downloads a few hundred kilobytes that did not
         * change. Split out, they stay in the browser cache across releases.
         */
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (/[\\/]node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler)[\\/]/.test(id)) return 'react';
          if (id.includes('@radix-ui') || id.includes('sonner')) return 'ui-kit';
          return undefined;
        },
      },
    },
  }
});
