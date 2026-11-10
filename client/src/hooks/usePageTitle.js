import { useEffect } from 'react';
import { BRAND } from '../../../shared/brand.js';

/**
 * What the browser tab says while someone is signed in.
 *
 * Two layers. The shell names the section from the address (Notes, Settings, My progress), and a
 * page that has loaded something with a name of its own (a folder, a notebook, a classroom)
 * replaces that with the name. The server still writes the title of every public page into the
 * HTML for crawlers and link previews, so this only ever changes what the signed-in person sees.
 *
 * The name goes first and the product last, because a tab squeezes its text from the right and
 * the part worth reading should be the part that survives.
 */
const SECTIONS = [
  [/^\/$/, 'My library'], [/^\/shared/, 'Shared with me'], [/^\/explore/, 'Explore'], [/^\/archive/, 'Archived folders'],
  [/^\/notes\/c\//, 'Collection'], [/^\/notes\//, 'Notebook'], [/^\/notes/, 'Notes'],
  [/^\/projects\/./, 'Project'], [/^\/projects/, 'Projects'], [/^\/friends/, 'Friends'],
  [/^\/teams\/join/, 'Join a classroom'], [/^\/teams\/[^/]+\/checkout/, 'Checkout'], [/^\/teams\/[^/]+\/progress/, 'Class progress'],
  [/^\/teams\/./, 'Classroom'], [/^\/teams/, 'Classrooms'],
  [/^\/folders\/[^/]+\/study/, 'Study'], [/^\/folders\//, 'Folder'],
  [/^\/u\//, 'Profile'], [/^\/settings/, 'Settings'], [/^\/progress/, 'My progress'], [/^\/premium/, 'Premium'],
  [/^\/dashboard/, 'Dashboard'], [/^\/rooms/, 'Live quiz'], [/^\/pricing/, 'Pricing'], [/^\/contact/, 'Contact'],
  [/^\/terms/, 'Terms'], [/^\/privacy/, 'Privacy'], [/^\/refunds/, 'Refunds'], [/^\/delete-account/, 'Delete your account'],
];

/** The name the page on screen gave itself, if it has one. Cleared when that page goes away. */
let specific = null;

const compose = name => (name ? `${name} · ${BRAND.name}` : BRAND.title);
const tidy = value => String(value).replace(/\s+/g, ' ').trim().slice(0, 70);
const sectionOf = pathname => SECTIONS.find(([pattern]) => pattern.test(pathname))?.[1] || '';

/** For a page that knows the name of what it shows. Pass nothing while that is still loading. */
export function usePageTitle(name) {
  useEffect(() => {
    const value = name ? tidy(name) : '';
    if (!value) return undefined;
    specific = value;
    document.title = compose(value);
    return () => { if (specific === value) specific = null; };
  }, [name]);
}

/**
 * For the shell, once. Effects run children first, so by the time this runs a page that had its
 * name ready has already said so, and the section name only fills in when nothing more specific
 * is on screen.
 */
export function useSectionTitle(pathname) {
  useEffect(() => { if (!specific) document.title = compose(sectionOf(pathname)); }, [pathname]);
}
