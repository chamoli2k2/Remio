import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, RotateCw } from 'lucide-react';
import { useApp } from '../hooks/useApp';

/**
 * What iOS leaves out of a home-screen app.
 *
 * Safari gives a page swipe-from-the-edge to go back and pull-down to reload. Launched from the home
 * screen there is no browser chrome and neither gesture exists, so without this the only way back
 * from a folder is the menu. Both are rebuilt here, and only in that mode: in a browser tab the
 * browser's own gestures are better and must not be fought.
 *
 * Pinch and double-tap zoom are switched off in the same mode, because an installed app does not
 * zoom and a stray pinch otherwise leaves the whole layout scaled. In a browser tab zoom stays on.
 */
const EDGE_PX = 24, BACK_AT = 90, PULL_AT = 70, PULL_MAX = 96;
// Anything that owns its own horizontal or vertical drag, or that a swipe should not escape from.
const OWN_GESTURES = '.drawing-editor, [role="dialog"], .modal-overlay, input, textarea, select, [contenteditable="true"], .cm-editor, .sidebar.open, [data-no-gestures]';

export const isStandalone = () => typeof window !== 'undefined'
  && (window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true);

function scrolledAncestor(el) {
  for (let node = el; node && node !== document.body; node = node.parentElement) {
    if (node.scrollTop > 0 && /(auto|scroll)/.test(getComputedStyle(node).overflowY)) return true;
  }
  return false;
}

export default function StandaloneGestures() {
  const navigate = useNavigate();
  const { refresh } = useApp();
  const [on, setOn] = useState(false);
  const [back, setBack] = useState(0), [pull, setPull] = useState(0), [busy, setBusy] = useState(false);
  const latest = useRef({ navigate, refresh }); latest.current = { navigate, refresh };

  useEffect(() => {
    if (!isStandalone()) return;
    setOn(true);
    const root = document.documentElement;
    root.classList.add('is-standalone');
    const viewport = document.querySelector('meta[name="viewport"]');
    const original = viewport?.getAttribute('content');
    viewport?.setAttribute('content', 'width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover');
    // WebKit's own pinch events; cancelling them is what stops page zoom on iOS.
    const noZoom = e => e.preventDefault();
    document.addEventListener('gesturestart', noZoom);

    let track = null;
    const start = e => {
      if (e.touches.length !== 1 || e.target.closest?.(OWN_GESTURES)) { track = null; return; }
      const t = e.touches[0];
      const atTop = (document.scrollingElement?.scrollTop || 0) <= 0 && !scrolledAncestor(e.target);
      track = { x: t.clientX, y: t.clientY, at: Date.now(), edge: t.clientX <= EDGE_PX, top: atTop, mode: null };
    };
    const move = e => {
      if (!track) return;
      const t = e.touches[0], dx = t.clientX - track.x, dy = t.clientY - track.y;
      if (!track.mode) {
        if (track.edge && dx > 10 && dx > Math.abs(dy)) track.mode = 'back';
        else if (track.top && dy > 10 && dy > Math.abs(dx)) track.mode = 'pull';
        else if (Math.abs(dx) > 10 || Math.abs(dy) > 10) { track = null; return; }
        else return;
      }
      e.preventDefault();
      if (track.mode === 'back') setBack(Math.max(0, dx));
      else setPull(Math.min(PULL_MAX, Math.max(0, dy * 0.5)));
      track.dx = dx; track.dy = dy;
    };
    const end = () => {
      const done = track; track = null;
      setBack(0);
      if (!done?.mode) return;
      if (done.mode === 'back') {
        const fast = done.dx > 40 && done.dx / Math.max(1, Date.now() - done.at) > 0.5;
        if (done.dx >= BACK_AT || fast) {
          if ((window.history.state?.idx || 0) > 0) latest.current.navigate(-1);
          else if (window.location.pathname !== '/') latest.current.navigate('/', { replace: true });
        }
        return;
      }
      if (done.dy * 0.5 >= PULL_AT) {
        setBusy(true); setPull(PULL_AT);
        latest.current.refresh();
        setTimeout(() => { setBusy(false); setPull(0); }, 700);
      } else setPull(0);
    };
    document.addEventListener('touchstart', start, { passive: true });
    document.addEventListener('touchmove', move, { passive: false });
    document.addEventListener('touchend', end);
    document.addEventListener('touchcancel', end);
    return () => {
      root.classList.remove('is-standalone');
      if (original) viewport?.setAttribute('content', original);
      document.removeEventListener('gesturestart', noZoom);
      document.removeEventListener('touchstart', start);
      document.removeEventListener('touchmove', move);
      document.removeEventListener('touchend', end);
      document.removeEventListener('touchcancel', end);
    };
  }, []);

  if (!on) return null;
  const backShare = Math.min(1, back / BACK_AT), pullShare = Math.min(1, pull / PULL_AT);
  return <>
    <div className={`edge-back ${backShare >= 1 ? 'is-ready' : ''}`} aria-hidden="true" style={{ opacity: backShare, transform: `translate(${Math.min(back, BACK_AT) * 0.6 - 44}px, -50%)` }}><ChevronLeft size={20}/></div>
    <div className={`pull-refresh ${busy ? 'is-busy' : ''}`} aria-hidden="true" style={{ opacity: pullShare, transform: `translate(-50%, ${pull - 44}px)` }}><RotateCw size={17} style={busy ? undefined : { transform: `rotate(${pullShare * 270}deg)` }}/></div>
  </>;
}
