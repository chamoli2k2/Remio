import { useRef, useState } from 'react';
import { Pencil } from 'lucide-react';
import RichText from './RichText';
import Img from './Img';
import DrawingView from './DrawingView';
import { EMBED_WIDTH, clampWidth, segmentsOf } from '../../../shared/notes.js';

const PRESETS = [25, 50, 75, 100];

/**
 * One picture or drawing in a page, which can be made narrower by dragging its handle, with the
 * arrow keys, or from the preset buttons.
 *
 * The width is a share of the page, so it holds on a phone as much as on a wide screen. While the
 * handle is held the figure follows the pointer from local state; the page is only told once, on
 * release, so dragging does not save the note on every pixel.
 */
function Figure({ index, part, basePath, onResize, onEditDrawing, eager }) {
  const ref = useRef(null);
  const [live, setLive] = useState(null);
  const width = live ?? part.width;
  const shown = width ?? EMBED_WIDTH.max;
  const commit = value => {
    setLive(null);
    const next = clampWidth(value);
    if (next !== (part.width ?? EMBED_WIDTH.max)) onResize(index, next);
  };

  function drag(event) {
    event.preventDefault();
    const handle = event.currentTarget;
    const figure = ref.current;
    const lane = figure.parentElement.getBoundingClientRect().width;
    if (!lane) return;
    const startX = event.clientX, startWidth = figure.getBoundingClientRect().width;
    let current = part.width ?? EMBED_WIDTH.max;
    handle.setPointerCapture(event.pointerId);
    const move = e => { current = clampWidth(((startWidth + e.clientX - startX) / lane) * 100); setLive(current); };
    const stop = () => {
      handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', stop); handle.removeEventListener('pointercancel', stop);
      commit(current);
    };
    handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', stop); handle.addEventListener('pointercancel', stop);
  }
  const keys = e => {
    const step = e.shiftKey ? 20 : EMBED_WIDTH.step;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); commit(shown + step); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); commit(shown - step); }
    else if (e.key === 'Home') { e.preventDefault(); commit(EMBED_WIDTH.min); }
    else if (e.key === 'End') { e.preventDefault(); commit(EMBED_WIDTH.max); }
  };

  const drawing = part.kind === 'drawing';
  return <figure ref={ref} className={`note-figure ${drawing ? 'is-drawing' : ''} ${width ? 'is-sized' : ''} ${onResize ? 'is-resizable' : ''}`} style={width ? { width: `${width}%` } : undefined}>
    {drawing
      ? <DrawingView basePath={basePath} id={part.id} label={part.caption || 'Drawing'}/>
      : <Img id={part.id} alt={part.caption || 'Picture'} eager={eager} sizes="(max-width: 760px) 92vw, 720px"/>}
    {onResize && <>
      <div className="note-figure-tools" role="group" aria-label="Size">
        {PRESETS.map(p => <button type="button" key={p} aria-pressed={shown === p} onClick={() => commit(p)}>{p}%</button>)}
      </div>
      <span className="note-figure-handle" role="slider" tabIndex={0} aria-label="Drag to resize" aria-orientation="horizontal"
        aria-valuemin={EMBED_WIDTH.min} aria-valuemax={EMBED_WIDTH.max} aria-valuenow={shown} aria-valuetext={`${shown}% of the page width`}
        onPointerDown={drag} onKeyDown={keys}/>
    </>}
    {drawing && onEditDrawing && <button type="button" className="button secondary small note-figure-edit" onClick={() => onEditDrawing(part.id)}><Pencil size={14}/> Edit drawing</button>}
    {part.caption && <figcaption>{part.caption}</figcaption>}
  </figure>;
}

/**
 * The page as a reader sees it: Markdown, with pictures and drawings where their lines sit.
 *
 * `onResize` is only given to someone who can edit; without it the figures are plain. `eager` is
 * for the print sheet, where an image that is still lazy when the dialog opens prints as a blank.
 */
export default function NotePreview({ body, basePath, onEditDrawing, onResize = null, eager = false }) {
  const parts = segmentsOf(body);
  if (!parts.length) return <p className="preview-empty">Nothing on this page yet.</p>;
  let embed = -1;
  return <div className="note-preview">{parts.map((p, i) => {
    if (p.kind === 'text') return <RichText key={i} text={p.text}/>;
    embed += 1;
    return <Figure key={`${p.id}-${i}`} index={embed} part={p} basePath={basePath} onResize={onResize} onEditDrawing={onEditDrawing} eager={eager}/>;
  })}</div>;
}
