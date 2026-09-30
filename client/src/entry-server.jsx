import { prerenderToNodeStream } from 'react-dom/static';
import { StaticRouter } from 'react-router-dom';
import { JSDOM } from 'jsdom';
import { useSanitizer } from './services/purify';
import { AppProvider } from './hooks/useApp';
import { createStore } from './services/store';
import App from './App';

/**
 * Rendering the app to HTML.
 *
 * Built separately from the browser bundle and loaded by the Express server, which is the only
 * thing that imports this file. It exists so a page arrives with its content already in it: the
 * app's own pages are fetched in effects, and effects do not run on a server, so without this a
 * crawler is handed a loading spinner and has to execute JavaScript to find out what the page says.
 *
 * `prerenderToNodeStream` rather than `renderToString`, because every page in this app is behind
 * `React.lazy`. renderToString cannot wait for a promise — it would emit the Suspense fallback and
 * stop — whereas this waits for the whole tree to settle and hands back finished HTML.
 */

/**
 * One DOM for the life of the process, for the sanitiser to parse in.
 *
 * Card text is Markdown turned into HTML and then sanitised, and sanitising needs somewhere to
 * build a document. Without this, DOMPurify reports itself unsupported and returns its input
 * untouched, which would put whatever a user wrote into the page verbatim. See services/purify:
 * it refuses to sanitise rather than let that happen, so this line is what makes cards renderable
 * here at all.
 *
 * Built once because constructing a DOM costs tens of milliseconds and nothing here is retained
 * between renders — it is a parser, not state.
 */
const sanitizerWindow = new JSDOM('').window;
useSanitizer(purify => purify(sanitizerWindow));

const collect = stream => new Promise((resolve, reject) => {
  let html = '';
  stream.setEncoding('utf8');
  stream.on('data', chunk => { html += chunk; });
  stream.on('end', () => resolve(html));
  stream.on('error', reject);
});

/**
 * Renders `url` and returns the markup along with the data it took to produce it.
 *
 * The returned data is the point as much as the HTML. It goes into the page as JSON, and the
 * browser adopts it as its cache, so the app hydrates into a view it can already draw. Without it
 * the page would render twice: once from the server's HTML and again a moment later when the
 * browser's own requests came back.
 *
 * `user` is always null in practice — only signed-out requests are rendered here — but it is a
 * parameter rather than a constant because the provider distinguishes "nobody is signed in" from
 * "we have not looked yet", and being explicit is what stops it showing the boot screen.
 */
export async function render({ url, config, data = {}, user = null }) {
  const store = createStore();
  store.hydrate(data);

  const errors = [];
  const { prelude } = await prerenderToNodeStream(
    <StaticRouter location={url}>
      <AppProvider store={store} initialUser={user} initialConfig={config}>
        <App/>
      </AppProvider>
    </StaticRouter>,
    // Collected rather than thrown. A component that fails on the server should cost this page its
    // pre-rendering, not its existence, and the caller decides that by looking at what came back.
    // Returns nothing on purpose: React treats a returned value as a digest string for the error.
    { onError: error => { errors.push(error); } },
  );

  return { html: await collect(prelude), data: store.dehydrate(), errors };
}
