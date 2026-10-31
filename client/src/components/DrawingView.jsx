import { useEffect, useRef } from 'react';
import { PenLine } from 'lucide-react';
import { useQuery } from '../hooks/useApp';
import { paintPaper, paintInk, canvasRatio, PAGE, PAPER_COLORS } from '../../../shared/drawing.js';

/**
 * Paints a drawing onto a canvas at whatever size its box is, sharp on high-density screens.
 *
 * The same paint functions the editor uses, so what was drawn is what is shown. The ink goes onto
 * a layer of its own first and is then laid over the paper: an eraser stroke cuts through ink, and
 * drawn straight onto the paper it would cut a hole in the page too.
 */
export function useDrawingCanvas(canvasRef, doc) {
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !doc) return undefined;
    let ink = null;
    const paint = () => {
      const box = canvas.getBoundingClientRect();
      if (!box.width) return;
      const ratio = canvasRatio(box.width, box.width * (doc.h / doc.w), window.devicePixelRatio || 1);
      const scale = (box.width * ratio) / doc.w;
      canvas.width = Math.round(box.width * ratio);
      canvas.height = Math.round(box.width * ratio * (doc.h / doc.w));
      ink ||= document.createElement('canvas');
      ink.width = canvas.width; ink.height = canvas.height;
      const ctx = canvas.getContext('2d');
      paintPaper(ctx, doc, scale);
      paintInk(ink.getContext('2d'), doc, scale);
      ctx.drawImage(ink, 0, 0);
    };
    paint();
    const observer = new ResizeObserver(paint);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [canvasRef, doc]);
}

export default function DrawingView({ folderId, basePath = folderId ? `/folders/${folderId}` : null, id, doc: given, label = 'Drawing', className = '' }) {
  const ref = useRef(null);
  // A saved drawing never changes, so a cached copy is never stale.
  const { data, error } = useQuery(given || !id || !basePath ? null : `${basePath}/drawings/${id}`, null, { staleAfter: 0 });
  const doc = given || data;
  useDrawingCanvas(ref, doc);
  if (error) return <div className={`drawing-view is-missing ${className}`} role="img" aria-label={`${label} could not be loaded`}><PenLine size={18}/> Drawing unavailable</div>;
  // Drawings of more than a page scroll inside their box rather than making the card that tall.
  const tall = doc && doc.h > PAGE.height;
  return <div className={`drawing-view ${tall ? 'is-tall' : ''} ${className}`} style={{ aspectRatio: doc ? undefined : `${PAGE.width} / ${PAGE.height}`, background: PAPER_COLORS[doc?.theme] || undefined }}>
    {doc ? <canvas ref={ref} role="img" aria-label={label} style={{ aspectRatio: `${doc.w} / ${doc.h}` }}/> : <span className="drawing-loading" aria-label="Loading drawing"/>}
  </div>;
}
