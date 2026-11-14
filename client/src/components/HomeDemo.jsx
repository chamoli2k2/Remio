import { useEffect, useRef, useState } from 'react';
import { BRAND } from '../../../shared/brand.js';
import { LibraryBig, NotebookPen, FolderOpen, ChartNoAxesCombined, Swords, GraduationCap, Users, Compass, Plus, Search, Bell, Share2, RotateCcw, Play, Layers, Flame, Check, ArrowLeft } from 'lucide-react';

/**
 * A faithful, scaled-down copy of the real workspace (sidebar, top bar, library, folder and study
 * pages) that plays three short scenes with a moving pointer: make a folder, add cards, study them.
 *
 * Everything on screen is a pure function of one frame counter, so retiming a scene means editing
 * numbers, not choreographing state. The canvas is laid out at a fixed size and scaled to fit, which
 * keeps the pointer coordinates valid at every screen width. It pauses off screen, and under reduced
 * motion it shows a finished frame instead of moving.
 */
const FRAME_MS = 50;
const W = 1000, H = 590, SIDE = 190;
const SWATCHES = ['violet', 'blue', 'orange', 'green', 'pink', 'slate'];
const WORDS = ['Learn.', 'Revise.', 'Know.'];
const FOLDERS = [['Spanish verbs', 'violet', 42], ['World capitals', 'blue', 120], ['Chemistry basics', 'orange', 64]];
const CARDS = [['What does the mitochondria do?', 'Turns food into usable energy (ATP).'], ['What is osmosis?', 'Water moving across a membrane.'], ['Which organelle holds DNA?', 'The nucleus.']];

const typed = (text, f, start, cps = 1.3) => text.slice(0, Math.max(0, Math.min(text.length, Math.floor((f - start) * cps))));
const SCENES = [
  { id: 'folder', label: 'Create a folder', frames: 150, cursor: [[0, 560, 330], [6, 95, 78], [30, 560, 250], [64, 549, 318], [90, 700, 380], [112, 820, 250]] },
  { id: 'cards', label: 'Add cards', frames: 215, cursor: [[0, 600, 300], [4, 930, 92], [22, 600, 200], [58, 600, 292], [96, 715, 365], [112, 930, 92], [140, 600, 200], [160, 715, 365], [186, 820, 300]] },
  { id: 'study', label: 'Study', frames: 190, cursor: [[0, 600, 420], [4, 595, 255], [28, 650, 440], [60, 595, 255], [78, 760, 440], [112, 595, 255], [128, 650, 440], [160, 820, 330]] },
];

function Sidebar({ folders }) {
  const nav = [['WORKSPACE', [[LibraryBig, 'My library', true], [NotebookPen, 'Notes'], [FolderOpen, 'Projects']]], ['STUDY', [[ChartNoAxesCombined, 'My progress'], [Swords, 'Live quiz']]], ['PEOPLE', [[GraduationCap, 'Classrooms'], [Users, 'Shared with me'], [Compass, 'Explore']]]];
  return (
    <aside className="am-side">
      <div className="am-brand"><img src="/favicon.svg" alt="" width="22" height="22" /><b>{BRAND.name}<i>.</i></b></div>
      <div className="am-create"><span><Plus size={13} /></span> Create a folder</div>
      {nav.map(([cap, items]) => (
        <div className="am-group" key={cap}>
          <small>{cap}</small>
          {items.map(([Icon, label, on]) => <div key={label} className={`am-link ${on ? 'is-on' : ''}`}><Icon size={14} />{label}</div>)}
        </div>
      ))}
      <div className="am-group"><small>YOUR FOLDERS</small>
        {folders.map(([t, c], i) => <div key={t} className={`am-flink ${i === 0 && folders.length > 3 ? 'is-new' : ''}`}><i className={`am-dot ${c}`} />{t}</div>)}
      </div>
      <div className="am-account"><i>AS</i><span><b>Aria Sharma</b><small>@aria</small></span></div>
    </aside>
  );
}

function Top({ title }) {
  return <div className="am-top"><span>{title}</span><div className="am-search"><Search size={11} /> Folders or people…</div><Bell size={13} /><i className="am-avatar">AS</i></div>;
}

function FolderCard({ t, c, i, fresh }) {
  return (
    <div className={`am-fcard ${fresh ? 'is-new' : ''}`}>
      <div className={`am-cover ${c}`}><span className="am-ficon"><Layers size={16} /></span><em>{WORDS[i % 3]}</em></div>
      <div className="am-fbody"><b>{t}</b><small>A new collection of things worth remembering.</small></div>
    </div>
  );
}

function Library({ f, created, color, title }) {
  const items = created ? [[title, color, 0, true], ...FOLDERS.map(([t, c], i) => [t, c, i + 1])] : FOLDERS.map(([t, c], i) => [t, c, i]);
  return (
    <div className="am-page">
      <div className="am-head"><div><small>YOUR PERSONAL LEARNING SPACE</small><h4>My library</h4></div><span className="am-btn"><Plus size={12} /> New folder</span></div>
      <div className="am-banner"><div><small>A LITTLE PROGRESS, EVERY DAY</small><b>Keep your curiosity in good company.</b><p>{created ? 292 : 289} cards are ready when you are.</p></div><span className="am-white">Start a study session</span></div>
      <div className="am-sec"><b>Your collections</b><i>{items.length}</i></div>
      <div className="am-fgrid">{items.map(([t, c, i, fresh]) => <FolderCard key={t} t={t} c={c} i={i} fresh={fresh} />)}</div>
      {f >= 24 && f < 104 && <div className="am-scrim" />}
      {f >= 24 && f < 104 && (
        <div className="am-modal am-modal-folder" style={{ left: 415, top: 150, width: 360, height: 270 }}>
          <h5>Create a folder</h5>
          <label style={{ top: 58 }}>Title</label>
          <div className={`am-input ${f < 66 ? 'is-focus' : ''}`} style={{ top: 82, height: 32 }}>{typed(title, f, 34, 0.5)}{f < 66 && <u />}</div>
          <label style={{ top: 130 }}>Colour</label>
          <div className="am-swatches" style={{ top: 154 }}>{SWATCHES.map((s) => <i key={s} className={`${s} ${s === color ? 'is-on' : ''}`} />)}</div>
          <span className="am-ghost" style={{ top: 210, left: 190, width: 70 }}>Cancel</span>
          <span className={`am-btn ${f >= 100 ? 'is-press' : ''}`} style={{ top: 210, left: 270, width: 100 }}>Create folder</span>
        </div>
      )}
    </div>
  );
}

function Folder({ f, count, title, color }) {
  const open = (f >= 18 && f < 108) || (f >= 126 && f < 184);
  const second = f >= 126;
  const front = second ? typed(CARDS[1][0], f, 130, 0.9) : typed(CARDS[0][0], f, 28, 0.9);
  const back = second ? typed(CARDS[1][1], f, 150, 0.9) : typed(CARDS[0][1], f, 62, 0.9);
  const focusFront = second ? f < 150 : f < 62;
  return (
    <div className="am-page">
      <div className="am-back"><ArrowLeft size={11} /> Back to library</div>
      <div className="am-fhead">
        <span className={`am-bigicon ${color}`}><Layers size={20} /></span>
        <div><small>Private collection</small><h4>{title}</h4></div>
        <span className="am-ghost am-share"><Share2 size={11} /> Share</span>
        <span className={`am-btn am-addbtn ${(f >= 14 && f < 20) || (f >= 122 && f < 128) ? 'is-press' : ''}`}><Plus size={12} /> Add card</span>
      </div>
      <div className="am-strip"><span className="am-sicon"><Layers size={15} /></span><div><b>A little practice makes it stick.</b><small>Flip a few cards, or settle into a focused study session.</small></div><span className="am-white am-quick">Quick review</span><span className="am-btn am-due"><Play size={10} /> Study due cards <em>{count}</em></span></div>
      <div className="am-sec"><b>Flashcards</b><i>{count}</i></div>
      <div className="am-cgrid">
        {CARDS.slice(0, count).map(([q], i) => {
          const n = i + 1;
          return <div className={`am-card ${n === count ? 'is-new' : ''}`} key={q}><small>0{n} <span>/ QUESTION</span></small><p>{q}</p><footer><RotateCcw size={10} /> Flip</footer></div>;
        })}
        {count < 3 && <div className="am-card am-add"><Plus size={18} /><small>Add a flashcard</small></div>}
      </div>
      {open && <div className="am-scrim" />}
      {open && (
        <div className="am-modal" style={{ left: 405, top: 110, width: 380, height: 290 }}>
          <h5>Add a card</h5>
          <label style={{ top: 38 }}>Front</label>
          <div className={`am-input am-area ${focusFront ? 'is-focus' : ''}`} style={{ top: 60, height: 64 }}>{front}{focusFront && <u />}</div>
          <label style={{ top: 130 }}>Back</label>
          <div className={`am-input am-area ${!focusFront ? 'is-focus' : ''}`} style={{ top: 150, height: 64 }}>{back}{!focusFront && <u />}</div>
          <span className="am-ghost" style={{ top: 236, left: 190, width: 70 }}>Cancel</span>
          <span className={`am-btn ${(f >= 104 && f < 110) || (f >= 180 && f < 186) ? 'is-press' : ''}`} style={{ top: 236, left: 270, width: 90 }}>Add card</span>
        </div>
      )}
    </div>
  );
}

const FLIPS = [14, 66, 118], RATES = [40, 90, 140], RATING = ['good', 'easy', 'good'];
function Study({ f }) {
  const done = f >= 146;
  const idx = Math.min(2, RATES.filter((r) => f >= r + 6).length);
  const flipped = f >= FLIPS[idx] && !(f >= RATES[idx] + 6);
  const finished = RATES.filter((r) => f >= r).length;
  const hit = RATES.findIndex((r) => f >= r && f < r + 6);
  return (
    <div className="am-study">
      <div className="am-stop"><span><ArrowLeft size={11} /> Biology 101</span><div className="am-prog"><i style={{ width: `${(finished / 3) * 100}%` }} /></div><em>{Math.min(finished + 1, 3)} / 3</em></div>
      {!done ? (
        <>
          <div className="am-flip" key={idx}>
            <div className={`am-flip-in ${flipped ? 'is-flipped' : ''}`}>
              <div className="am-face"><small>QUESTION</small><p>{CARDS[idx][0]}</p><em>Click to reveal</em></div>
              <div className="am-face am-backface"><small>ANSWER</small><p>{CARDS[idx][1]}</p></div>
            </div>
          </div>
          <div className="am-rate">
            {[['again', '1m'], ['hard', '1d'], ['good', '3d'], ['easy', '7d']].map(([r, t]) => (
              <span key={r} className={`${r} ${hit >= 0 && RATING[hit] === r ? 'is-hit' : ''} ${flipped ? '' : 'is-idle'}`}>{r}<small>{t}</small></span>
            ))}
          </div>
        </>
      ) : (
        <div className="am-done"><span><Check size={22} /></span><h4>Session complete</h4><p>3 cards reviewed. They will come back right before you would forget them.</p><div><i><Flame size={12} /> 7 day streak</i><i>Next review tomorrow</i></div></div>
      )}
    </div>
  );
}

function Cursor({ scene, f, still }) {
  const path = SCENES[scene].cursor;
  let k = path[0];
  for (const p of path) if (p[0] <= f) k = p;
  const click = path.some((p) => f >= p[0] + 12 && f < p[0] + 17);
  return (
    <div className={`am-cursor ${still ? 'is-hidden' : ''}`} style={{ transform: `translate(${k[1]}px, ${k[2]}px)` }} aria-hidden="true">
      <svg width="20" height="22" viewBox="0 0 20 22"><path d="M2 1.5v16l4.4-4 3 6.4 2.6-1.2-3-6.2h6.1z" fill="#17151f" stroke="#fff" strokeWidth="1.4" strokeLinejoin="round" /></svg>
      {click && <b />}
    </div>
  );
}

export default function HomeDemo() {
  const [scene, setScene] = useState(0);
  const [frame, setFrame] = useState(0);
  const [live, setLive] = useState(true);
  const [still, setStill] = useState(false);
  const [scale, setScale] = useState(0.9);
  const [compact, setCompact] = useState(false);
  const root = useRef(null), box = useRef(null);

  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) setStill(true);
    // A phone shows the workspace without its sidebar so the page itself stays readable.
    const fit = () => {
      if (!box.current) return;
      const w = box.current.clientWidth, narrow = w < 640;
      setCompact(narrow); setScale(w / (narrow ? W - SIDE : W));
    };
    fit();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(fit) : null;
    ro?.observe(box.current);
    const io = typeof IntersectionObserver !== 'undefined' ? new IntersectionObserver(([e]) => setLive(e.isIntersecting), { threshold: 0.15 }) : null;
    if (root.current) io?.observe(root.current);
    return () => { ro?.disconnect(); io?.disconnect(); };
  }, []);

  useEffect(() => {
    if (!live || still) return undefined;
    const t = setInterval(() => setFrame((x) => x + 1), FRAME_MS);
    return () => clearInterval(t);
  }, [live, still]);

  useEffect(() => {
    if (frame >= SCENES[scene].frames) { setScene((s) => (s + 1) % SCENES.length); setFrame(0); }
  }, [frame, scene]);

  const pick = (i) => { setScene(i); setFrame(0); };
  const s = still ? 1 : scene, f = still ? 150 : frame;
  const created = f >= 104;
  const folders = s === 0 && !created ? FOLDERS.map(([t, c]) => [t, c]) : [['Biology 101', 'green'], ...FOLDERS.map(([t, c]) => [t, c])];
  const count = s === 1 ? (f >= 184 ? 2 : f >= 108 ? 1 : 0) : 3;
  const title = typed('Biology 101', f, 34, 0.5);
  const page = s === 0 ? <Library f={f} created={created} color={f >= 76 ? 'green' : 'violet'} title={created ? 'Biology 101' : title} />
    : s === 1 ? <Folder f={f} count={count} title="Biology 101" color="green" />
      : <Study f={f} />;

  return (
    <div className="am" ref={root}>
      <div className="am-frame" ref={box} style={{ aspectRatio: `${compact ? W - SIDE : W} / ${H}` }} role="img" aria-label={`Animation of the ${BRAND.name} workspace: creating a folder, adding flashcards and studying them`}>
        <div className="am-canvas" style={{ transform: `translateX(${compact ? -SIDE * scale : 0}px) scale(${scale})` }}>
          <Sidebar folders={s === 0 && !created ? folders.slice(0, 3) : folders.slice(0, 3)} />
          <div className="am-main">
            <Top title={s === 0 ? 'Library' : s === 1 ? 'Library / Biology 101' : 'Study'} />
            <div className="am-body" key={s}>{page}</div>
          </div>
          <Cursor scene={s} f={f} still={still} />
        </div>
      </div>
      <div className="am-tabs" role="tablist" aria-label="Workspace demo scenes">
        {SCENES.map((sc, i) => (
          <button key={sc.id} type="button" role="tab" aria-selected={i === s} className={i === s ? 'is-on' : ''} onClick={() => pick(i)}>
            <span>0{i + 1}</span>{sc.label}
            {i === s && !still && <i style={{ transform: `scaleX(${Math.min(1, frame / sc.frames)})` }} />}
          </button>
        ))}
      </div>
    </div>
  );
}
