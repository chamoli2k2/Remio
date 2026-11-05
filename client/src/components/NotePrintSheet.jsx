import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import NotePreview from './NotePreview';
import { BRAND } from '../../../shared/brand.js';

/**
 * Pages laid out for paper, printed through the browser so that "Save as PDF" gives real, selectable
 * text, maths and pictures rather than a screenshot.
 *
 * The sheet is built inside the app, not in a separate window, because the pictures and drawings
 * come through the same session and cache as everything else. It sits off-screen but laid out at
 * the width of a printed line, so drawings paint at the size they will print. When everything has
 * loaded, the rest of the app is hidden by a print-only rule and the dialog opens.
 *
 * The tab's title becomes the file name for the duration, since that is what browsers suggest, and
 * the theme is forced light so nobody gets a PDF with a dark page.
 */

const WAIT = 15_000;

/** Resolves once every picture has arrived and every drawing has painted, or after a while regardless. */
function settled(root) {
  return new Promise(resolve => {
    const started = Date.now();
    const ready = () => {
      const images = [...root.querySelectorAll('img')].every(i => i.complete);
      const boards = [...root.querySelectorAll('.drawing-view')].every(d => d.classList.contains('is-missing') || d.querySelector('canvas'));
      return images && boards;
    };
    const tick = () => (ready() || Date.now() - started > WAIT ? setTimeout(resolve, 150) : setTimeout(tick, 100));
    tick();
  });
}

const stamp = value => { try { return new Date(value).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); } catch { return ''; } };

export default function NotePrintSheet({ job, onDone }) {
  useEffect(() => {
    let cancelled = false, printing = false;
    const html = document.documentElement;
    const before = { title: document.title, theme: html.dataset.theme };
    const restore = () => {
      document.body.classList.remove('is-printing');
      document.title = before.title;
      if (before.theme === undefined) delete html.dataset.theme; else html.dataset.theme = before.theme;
    };
    const finish = () => { window.removeEventListener('afterprint', finish); restore(); onDone(); };
    (async () => {
      await settled(document.querySelector('.note-print-root'));
      if (cancelled) return;
      printing = true;
      html.dataset.theme = 'light';
      document.title = job.filename;
      document.body.classList.add('is-printing');
      window.addEventListener('afterprint', finish);
      // Let the light theme and the print layout settle before the browser takes its snapshot.
      requestAnimationFrame(() => requestAnimationFrame(() => { if (!cancelled) window.print(); }));
    })();
    return () => { cancelled = true; window.removeEventListener('afterprint', finish); if (printing) restore(); };
  }, [job]); // eslint-disable-line react-hooks/exhaustive-deps

  const many = job.pages.length > 1;
  return createPortal(<div className="note-print-root" aria-hidden="true">
    {many && <header className="print-cover">
      <h1>{job.heading}</h1>
      <p>{job.pages.length} pages{job.truncated ? ' (the first part of a longer notebook)' : ''} · {BRAND.name}</p>
    </header>}
    {job.pages.map(page => <section className="print-page" key={page.id}>
      {many ? <h2>{page.title || 'Untitled page'}</h2> : <h1>{page.title || 'Untitled page'}</h1>}
      {(page.tags?.length > 0 || page.updatedAt) && <p className="print-meta">
        {page.tags?.map(t => <span key={t}>#{t}</span>)}{page.updatedAt && <em>Updated {stamp(page.updatedAt)}</em>}
      </p>}
      <NotePreview body={page.body} basePath={job.basePath} eager/>
    </section>)}
  </div>, document.body);
}

/** `const [sheet, print] = useNotePrint()`: render `sheet` once, call `print(job)` to start. */
export function useNotePrint() {
  const [job, setJob] = useState(null);
  return [job && <NotePrintSheet job={job} onDone={() => setJob(null)}/>, setJob];
}

/** A file name that is safe on every system, from whatever the page or notebook is called. */
export const fileNameFor = title => `${String(title || 'Untitled').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Untitled'}`;
