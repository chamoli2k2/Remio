import { accessFolder } from './accessService.js';
import { listCards } from './cardService.js';
import { listFolders, presentFolder } from './folderService.js';
import { publicProfile } from './socialService.js';

/**
 * What each server-rendered page needs, fetched before it is rendered.
 *
 * ── Why a map rather than rendering to discover it ─────────────────────────────────────────────
 *
 * The app fetches in effects, and effects do not run during a server render, so a render on its own
 * produces the loading state and nothing else. Something has to know in advance what a URL needs.
 * Rendering once to collect the requests and again to use them would cost two renders per page and
 * still miss anything fetched a level down, so the routes that are worth rendering say what they
 * need, here.
 *
 * The keys are the cache keys the browser would have used, because that is the whole trick: the
 * page arrives with the answers already in the cache, so the app hydrates into a view it can draw
 * immediately and asks for nothing to show what is already on screen.
 *
 * Services are called directly rather than over HTTP. The alternative — the server making requests
 * to itself — would double the work and put a socket in the middle of a function call.
 *
 * Everything is passed through JSON on the way out. The browser will only ever see the JSON form,
 * and a render against Mongoose documents would be comparing dates to date strings on hydration:
 * the class of mismatch that shows up as one stray re-render on one page and takes a day to find.
 */
const json = value => JSON.parse(JSON.stringify(value));

/** Collections anyone may read, which is the home page's shelf and the whole of Explore. */
const explore = async () => ({ '/folders?scope=explore': json({ folders: await listFolders(undefined, 'explore') }) });

/**
 * One collection and its cards, under the single key the folder page reads.
 *
 * Nothing is returned for a collection this visitor cannot see. `accessFolder` throws for a private
 * one, and that is not an error here — it means this page has nothing to pre-render, so the app
 * loads it in the browser and shows whatever it is entitled to.
 */
async function folder(id) {
  try {
    const record = await accessFolder(id, undefined);
    const [presented, cards] = await Promise.all([presentFolder(record, undefined), listCards(id, undefined)]);
    return { [`/folders/${id}`]: json({ folder: presented, cards }) };
  } catch { return {}; }
}

async function profile(username) {
  try { return { [`/users/${username}`]: json(await publicProfile(username, undefined)) }; }
  catch { return {}; }
}

/**
 * The routes rendered on the server, and what each needs.
 *
 * Only pages a signed-out visitor can reach, because those are the only ones a crawler sees and
 * the only ones worth the CPU. A page with no data still belongs here — being listed is what marks
 * a URL as one this server is willing to render, and the legal and pricing pages render from the
 * bundle alone.
 */
const ROUTES = [
  [/^\/$/, explore],
  [/^\/explore\/?$/, explore],
  [/^\/folders\/([a-f\d]{24})\/?$/i, (_p, id) => folder(id)],
  [/^\/u\/([\w]{3,24})\/?$/, (_p, name) => profile(name.toLowerCase())],
  [/^\/(pricing|terms|privacy|refunds|contact|login|signup)\/?$/, async () => ({})],
];

/** Whether this server renders `pathname` at all. */
export const isRenderable = pathname => ROUTES.some(([pattern]) => pattern.test(pathname));

/** The cache the browser should start with for `pathname`, or null if it is not a rendered route. */
export async function dataFor(pathname) {
  for (const [pattern, load] of ROUTES) {
    const match = pattern.exec(pathname);
    if (match) return load(pathname, match[1]);
  }
  return null;
}
