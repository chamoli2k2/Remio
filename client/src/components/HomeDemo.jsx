import { useEffect, useRef, useState } from 'react';
import { BRAND } from '../../../shared/brand.js';
import { Layers, Plus, Check, Flame, Brain, Search, BookOpen, Users, Settings, Sparkles } from 'lucide-react';

/**
 * A looping mock of the app: adding a card, then studying one. Everything on screen is derived from
 * a single frame counter, so the scenes are easy to retime and there is nothing to keep in sync.
 * It pauses off screen, and under reduced motion it shows one finished frame instead of moving.
 */
const FRAME_MS = 50;
const FRONT = 'What does the mitochondria do?';
const BACK = 'Turns food into usable energy (ATP).';
const EXISTING = [
  ['What is osmosis?', 'learning'],
  ['Define photosynthesis', 'review'],
  ['What is a gene?', 'new'],
];
const STUDY = [
  ['Which organelle makes ATP?', 'The mitochondria.'],
  ['What carries genetic code?', 'DNA.'],
  ['Where does photosynthesis happen?', 'In the chloroplast.'],
];
const SCENES = [
  { id: 'add', label: 'Add a card', frames: 150 },
  { id: 'study', label: 'Study', frames: 130 },
];

const typed = (text, frame, start, perFrame = 1) => text.slice(0, Math.max(0, Math.min(text.length, Math.floor((frame - start) * perFrame))));

function AddScene({ f }) {
  const front = typed(FRONT, f, 8, 1.1);
  const back = typed(BACK, f, 42, 1.1);
  const pressed = f >= 92 && f < 98;
  const added = f >= 98;
  return (
    <div className="demo-add">
      <div className="demo-composer">
        <div className="demo-composer-head"><Plus size={13} /> New card</div>
        <label className={`demo-field ${f >= 8 && f < 42 ? 'is-focus' : ''}`}>
          <span>Front</span>
          <p>{added ? '' : front}{!added && f >= 8 && f < 42 && <i className="demo-caret" />}</p>
        </label>
        <label className={`demo-field ${f >= 42 && f < 92 ? 'is-focus' : ''}`}>
          <span>Back</span>
          <p>{added ? '' : back}{!added && f >= 42 && f < 92 && <i className="demo-caret" />}</p>
        </label>
        <button type="button" tabIndex={-1} className={`demo-btn ${pressed ? 'is-pressed' : ''}`} aria-hidden="true"><Plus size={14} /> Add card</button>
      </div>
      <div className="demo-list">
        <div className="demo-list-head"><span>Biology 101</span><small>{EXISTING.length + (added ? 1 : 0)} cards</small></div>
        {added && (
          <div className="demo-row demo-row-new" key="new">
            <div><strong>{FRONT}</strong><small>{BACK}</small></div>
            <span className="demo-tag">new</span>
          </div>
        )}
        {EXISTING.map(([q, tag], i) => (
          <div className="demo-row" key={q} style={added ? { animationDelay: `${i * 40}ms` } : undefined}>
            <div><strong>{q}</strong><i className="demo-skel" /></div>
            <span className="demo-tag">{tag}</span>
          </div>
        ))}
      </div>
      <div className={`demo-toast ${f >= 100 && f < 140 ? 'is-on' : ''}`}><Check size={13} /> Card added</div>
    </div>
  );
}

function StudyScene({ f }) {
  const idx = Math.min(STUDY.length - 1, Math.floor(f / 44));
  const local = f - idx * 44;
  const flipped = local >= 16 && local < 44;
  const rated = local >= 30 ? (idx === 1 ? 'easy' : 'good') : null;
  const [q, a] = STUDY[idx];
  const done = idx + (local >= 40 ? 1 : 0);
  return (
    <div className="demo-study">
      <div className="demo-study-top">
        <span className="demo-chip"><Flame size={12} /> 6 day streak</span>
        <div className="demo-progress"><span style={{ width: `${(done / STUDY.length) * 100}%` }} /></div>
        <span className="demo-count">{Math.min(done + 1, STUDY.length)}/{STUDY.length}</span>
      </div>
      <div className="demo-flip" key={idx}>
        <div className={`demo-flip-inner ${flipped ? 'is-flipped' : ''}`}>
          <div className="demo-face"><small>QUESTION</small><p>{q}</p></div>
          <div className="demo-face demo-back"><small>ANSWER</small><p>{a}</p></div>
        </div>
      </div>
      <div className="demo-rate" aria-hidden="true">
        {['again', 'hard', 'good', 'easy'].map((r) => (
          <span key={r} className={`${r} ${rated === r ? 'is-hit' : ''} ${flipped ? '' : 'is-idle'}`}>{r}</span>
        ))}
      </div>
    </div>
  );
}

export default function HomeDemo() {
  const [scene, setScene] = useState(0);
  const [frame, setFrame] = useState(0);
  const [live, setLive] = useState(true);
  const [still, setStill] = useState(false);
  const root = useRef(null);

  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) setStill(true);
    if (typeof IntersectionObserver === 'undefined' || !root.current) return;
    const io = new IntersectionObserver(([e]) => setLive(e.isIntersecting), { threshold: 0.2 });
    io.observe(root.current);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!live || still) return;
    const t = setInterval(() => setFrame((f) => f + 1), FRAME_MS);
    return () => clearInterval(t);
  }, [live, still]);

  useEffect(() => {
    if (frame >= SCENES[scene].frames) { setScene((s) => (s + 1) % SCENES.length); setFrame(0); }
  }, [frame, scene]);

  const pick = (i) => { setScene(i); setFrame(0); };
  const f = still ? 120 : frame;
  const shownScene = still ? 0 : scene;

  return (
    <div className="demo" ref={root}>
      <div className="demo-glow" aria-hidden="true" />
      <div className="demo-window" role="img" aria-label={`Animation of adding a flashcard and then studying it in ${BRAND.name}`}>
        <div className="demo-chrome">
          <span /><span /><span />
          <div className="demo-url"><Search size={11} /> remio.in/folders/biology</div>
        </div>
        <div className="demo-app">
          <aside className="demo-side" aria-hidden="true">
            <div className="demo-logo"><Layers size={14} /></div>
            <span className="is-on"><BookOpen size={15} /></span>
            <span><Brain size={15} /></span>
            <span><Users size={15} /></span>
            <span><Sparkles size={15} /></span>
            <span className="demo-side-end"><Settings size={15} /></span>
          </aside>
          <div className="demo-main" key={shownScene}>
            {shownScene === 0 ? <AddScene f={f} /> : <StudyScene f={f} />}
          </div>
        </div>
      </div>
      <div className="demo-tabs" role="tablist" aria-label="Product demo scenes">
        {SCENES.map((s, i) => (
          <button key={s.id} type="button" role="tab" aria-selected={i === shownScene} className={i === shownScene ? 'is-on' : ''} onClick={() => pick(i)}>
            {s.label}
            {i === shownScene && !still && <i style={{ transform: `scaleX(${Math.min(1, frame / s.frames)})` }} />}
          </button>
        ))}
      </div>
    </div>
  );
}
