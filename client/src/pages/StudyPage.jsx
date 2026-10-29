import { uuid } from '../services/uuid';
import AdSlot from '../components/AdSlot';
import { useState, useEffect, useRef, useMemo } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { X, ArrowRight, RotateCcw, Lightbulb, Check, ExternalLink, Flame, Trophy, Zap, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { useQuery, useApp } from '../hooks/useApp';
import { api } from '../services/api';
import Img from '../components/Img';
import DrawingView from '../components/DrawingView';
import { Button, Loading, ErrorState, Tag, FolderIcon, Empty } from '../components/ui';
import RichText, { sideOf, plainText } from '../components/RichText';
import { MODES, MODE_IDS } from '../../../shared/game.js';
import { answerPool, playable, boardFrom, pointsFor, recordBest, partsOf, SpeechRecognition } from '../components/study/modes';
import { ModeBar, ChoiceQuestion, TrueFalseQuestion, TypeQuestion, VoiceQuestion, MatchBoard } from '../components/study/StudyModes';
import { BadgeMedal, LevelBar, badgeById } from '../components/study/GameBits';

const MODE_KEY = 'remio:study-mode';
const savedMode = () => { try { const m = localStorage.getItem(MODE_KEY); return MODE_IDS.includes(m) ? m : 'classic'; } catch { return 'classic'; } };
const PRAISE = ['Spot on.', 'Nailed it.', 'Exactly right.', 'You knew that.', 'Sharp.'];
const FALLBACK = { mcq: 'choose from', truefalse: 'judge', type: 'type', voice: 'say', match: 'match' };

export default function StudyPage() {
  const { id } = useParams(); const [params, setParams] = useSearchParams(); const dueOnly = params.get('mode') === 'due'; const { refresh } = useApp();
  const { data, loading, error } = useQuery(`study:${id}:${dueOnly ? 'due' : 'all'}`, () => Promise.all([api(`/folders/${id}`), api(`/folders/${id}/cards`)]).then(([f, c]) => ({ ...f, cards: c.cards.filter(card => !dueOnly || !card.progress?.dueAt || new Date(card.progress.dueAt) <= new Date()) })));
  const [queue, setQueue] = useState(null), [index, setIndex] = useState(0), [flipped, setFlipped] = useState(false), [hint, setHint] = useState(false);
  const [busy, setBusy] = useState(false), [failure, setFailure] = useState(''), [ratings, setRatings] = useState([]);
  const [mode, setMode] = useState(() => { const p = params.get('play'); return MODE_IDS.includes(p) ? p : savedMode(); });
  const [graded, setGraded] = useState(null);
  const [session, setSession] = useState({ points: 0, xp: 0, combo: 0, level: null, badges: [], best: null });
  const [pop, setPop] = useState(null);
  const pending = useRef(null), inFlight = useRef(false);
  useEffect(() => { if (data && !queue) setQueue(data.cards); }, [data, queue]);

  const pool = useMemo(() => answerPool(data?.cards || []), [data]);
  const unavailable = useMemo(() => {
    const cards = data?.cards || [], out = {};
    for (const m of ['mcq', 'truefalse', 'match']) if (pool.length < 2) out[m] = 'Needs at least two cards with different answers.';
    if (!cards.some(c => partsOf(c)?.target)) out.type = 'No answer here is short enough to type.';
    out.voice = !SpeechRecognition ? 'This browser cannot listen. Try Chrome, Edge or Safari.' : out.type ? 'No answer here is short enough to say.' : undefined;
    if (!out.voice) delete out.voice;
    return out;
  }, [data, pool]);
  const activeMode = unavailable[mode] ? 'classic' : mode;
  const card = queue?.[index];
  const board = useMemo(() => (activeMode === 'match' && queue ? boardFrom(queue, index, pool) : []), [activeMode, queue, index, pool]);
  const style = !card ? null : activeMode === 'match' ? (board.length ? 'match' : 'classic') : playable(card, activeMode, pool) ? activeMode : 'classic';
  const side = card && sideOf(card, flipped);

  function chooseMode(next) {
    setMode(next); setGraded(null); setFlipped(false); setHint(false);
    try { localStorage.setItem(MODE_KEY, next); } catch { /* private mode */ }
    setParams(p => { const n = new URLSearchParams(p); n.set('play', next); return n; }, { replace: true });
  }

  /** Award feedback for one answered card: points, the floating XP, and any badge or level it earned. */
  function celebrate(game, item, extraPoints = 0) {
    setSession(s => {
      const combo = game?.combo ?? (item.rating === 'again' ? 0 : s.combo + 1);
      const points = pointsFor({ rating: item.rating, combo, seconds: item.seconds }) + extraPoints;
      return { ...s, points: s.points + points, xp: s.xp + (game?.xp || 0), combo, level: game?.level || s.level, badges: [...s.badges, ...(game?.badges || [])] };
    });
    if (game?.xp) setPop({ key: uuid(), xp: game.xp, goal: game.goalBonus });
    for (const badgeId of game?.badges || []) {
      const b = badgeById[badgeId];
      if (b) toast.custom(() => <div className="badge-toast"><BadgeMedal id={badgeId} size={44}/><div><span>BADGE UNLOCKED</span><strong>{b.name}</strong><p>{b.blurb}</p></div></div>, { duration: 6000 });
    }
    if (game?.levelUp) toast.success(`Level ${game.level.level} reached. You are now a ${game.level.title}.`, { icon: <Sparkles size={16}/> });
  }

  /**
   * Send answered cards one after another, then move past them. A failure keeps what is left, with
   * the same request ids, so "try again" cannot count a card twice.
   */
  async function submit(items, { board: boardBonus = 0 } = {}) {
    if (inFlight.current) return; inFlight.current = true; setBusy(true); setFailure('');
    if (!pending.current) pending.current = { items: items.map(it => ({ ...it, requestId: uuid(), localHour: new Date().getHours() })), advance: items.length, boardBonus };
    try {
      while (pending.current.items.length) {
        const item = pending.current.items[0];
        const body = { cardId: item.cardId, rating: item.rating, requestId: item.requestId, version: item.version, mode: item.mode, localHour: item.localHour, ...(item.board ? { board: item.board } : {}) };
        const res = await api('/reviews', { method: 'POST', body });
        pending.current.items.shift();
        setRatings(v => [...v, item.rating]);
        celebrate(res.game, item, pending.current.items.length ? 0 : pending.current.boardBonus);
      }
      const step = pending.current.advance; pending.current = null;
      setIndex(v => v + step); setFlipped(false); setHint(false); setGraded(null); refresh();
    } catch (e) { setFailure(e.message); } finally { inFlight.current = false; setBusy(false); }
  }
  const itemFor = (c, rating, extra = {}) => ({ cardId: c.id, rating, version: c.progress?.version || 0, mode: style === 'classic' ? 'classic' : style, ...extra });
  const rate = rating => submit([itemFor(card, pending.current?.items[0]?.rating || rating)]);
  const onGraded = result => { setGraded(result); setFlipped(true); };
  const proceed = (rating = graded?.rating) => submit([itemFor(card, rating, { seconds: graded?.seconds })]);
  function finishBoard({ mistakes, total }) {
    const items = board.map((c, i) => itemFor(c, !mistakes[c.id] ? 'good' : mistakes[c.id] === 1 ? 'hard' : 'again', i === board.length - 1 ? { board: { pairs: board.length, mistakes: total } } : {}));
    submit(items, { board: total ? 0 : 50 * board.length });
  }

  useEffect(() => {
    function key(e) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      if (style === 'classic') {
        if (e.code === 'Space' && card) { e.preventDefault(); setFlipped(v => !v); }
        if (flipped && ['1', '2', '3', '4'].includes(e.key)) rate(['again', 'hard', 'good', 'easy'][Number(e.key) - 1]);
      } else if (graded && (e.key === 'Enter' || e.code === 'Space')) { e.preventDefault(); proceed(); }
    }
    document.addEventListener('keydown', key); return () => document.removeEventListener('keydown', key);
  });

  const finished = queue && index >= queue.length;
  useEffect(() => { if (finished && session.best == null) setSession(s => ({ ...s, best: recordBest(id, activeMode, s.points) })); }, [finished]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading || !queue) return error ? <ErrorState message={error}/> : <Loading/>;
  if (!queue.length) return <Empty title="You’re all caught up" text="There are no cards due in this folder. Come back later or try a quick review." action={<Link className="button primary" to={`/folders/${id}`}>Back to folder</Link>}/>;

  const header = <><div className="study-header"><div className={`small-folder-icon ${data.folder.color}`}><FolderIcon name={data.folder.icon} size={21}/></div><div><span>STUDY SESSION</span><strong>{data.folder.title}</strong></div><Link to={`/folders/${id}`} className="icon-button" aria-label="Exit study session"><X size={22}/></Link></div><div className="session-progress"><span style={{ width: `${Math.min(1, index / queue.length) * 100}%` }}/></div></>;

  if (finished) {
    const remembered = ratings.filter(r => r !== 'again').length;
    return <div className="study-page">{header}<div className="study-complete">
      <span className="complete-icon"><Check size={36}/></span><span className="eyebrow">A LITTLE WISER THAN BEFORE</span><h1>That’s a good session.</h1>
      <p>You reviewed {ratings.length} cards in {MODES[activeMode].label.toLowerCase()}. Your next reviews are scheduled.</p>
      <div className="session-result">
        <div><strong>{session.points.toLocaleString()}</strong><span>points{session.best?.isNew ? ' · new best' : ''}</span></div>
        <div><strong>{remembered}</strong><span>remembered</span></div>
        {session.xp > 0 && <div><strong>+{session.xp}</strong><span>XP earned</span></div>}
      </div>
      {session.best?.isNew && <p className="best-note"><Trophy size={15}/> New personal best for this collection in {MODES[activeMode].label.toLowerCase()}.</p>}
      {session.level && <div className="complete-level"><LevelBar level={session.level}/></div>}
      {session.badges.length > 0 && <div className="complete-badges"><span className="eyebrow">BADGES UNLOCKED</span><div>{session.badges.map(b => <div key={b} className="complete-badge"><BadgeMedal id={b} size={56}/><strong>{badgeById[b]?.name}</strong></div>)}</div></div>}
      <div className="complete-actions"><Link to={`/folders/${id}`} className="button primary">Back to collection <ArrowRight size={17}/></Link><Link to="/progress" className="button secondary">See your badges</Link></div>
      <AdSlot placement="afterStudy"/>
    </div></div>;
  }

  const hud = <div className="study-hud">
    <ModeBar mode={activeMode} onChange={chooseMode} unavailable={unavailable}/>
    <div className="hud-stats" aria-live="polite">
      <span className="hud-points"><Zap size={14}/><strong>{session.points.toLocaleString()}</strong> pts</span>
      {session.combo > 1 && <span className="hud-combo" key={session.combo}><Flame size={14}/>×{session.combo}</span>}
      {pop && <span className="xp-pop" key={pop.key} onAnimationEnd={() => setPop(null)}>+{pop.xp} XP{pop.goal ? ' · goal!' : ''}</span>}
    </div>
  </div>;

  if (style === 'match') {
    return <div className="study-page is-playing">{header}{hud}
      <div className="study-counter"><span>Cards {index + 1}–{index + board.length} of {queue.length}</span><span>Match each question to its answer.</span></div>
      <MatchBoard key={`${index}-${board.length}`} cards={board} onDone={finishBoard}/>
      {failure && <div className="study-retry"><ErrorState message={failure}/><Button className="primary" disabled={busy} onClick={() => submit([])}>Try again</Button></div>}
    </div>;
  }

  const verdict = graded && <div className={`verdict-bar is-${graded.verdict}`} role="status">
    <span className="verdict-icon">{graded.verdict === 'wrong' ? <X size={18}/> : <Check size={18}/>}</span>
    <div><strong>{graded.verdict === 'right' ? PRAISE[index % PRAISE.length] : graded.verdict === 'close' ? 'Almost. Check the spelling.' : 'Not this time.'}</strong><small>{graded.verdict === 'wrong' ? 'It will come back sooner, so you can try again.' : 'Read the explanation while it’s fresh.'}</small></div>
    <div className="verdict-actions">{graded.overridable && <button type="button" className="text-button" disabled={busy} onClick={() => proceed('good')}>I was right</button>}<Button className="primary" disabled={busy} onClick={() => proceed()}>{busy ? 'Saving…' : 'Continue'} <ArrowRight size={16}/></Button></div>
  </div>;

  const question = { card, pool, graded, onGraded };
  return <div className={`study-page ${style !== 'classic' ? 'is-playing' : ''}`}>{header}{hud}
    <div className="study-counter"><span>Card {index + 1} of {queue.length}</span><span>{style === 'classic' ? (flipped ? 'How well did you remember?' : 'Take a moment. You know more than you think.') : graded ? 'Here’s the full answer.' : MODES[style].label}</span></div>
    {style === 'classic' && activeMode !== 'classic' && <p className="mode-fallback">This answer is too long to {FALLBACK[activeMode]}, so flip it and rate yourself.</p>}
    <div className={`study-card ${flipped ? 'answer-visible' : ''} ${graded ? `is-graded is-${graded.verdict}` : ''}`}><div className="study-card-label">{flipped ? 'THE ANSWER' : 'THE QUESTION'}</div><div className="study-card-body" data-face={flipped ? 'back' : 'front'}>{side.image && <Img id={side.image} alt={plainText(side.text) || 'Study image'} sizes="(max-width: 640px) 90vw, 520px" eager/>}{side.drawing && <DrawingView folderId={data.folder.id} id={side.drawing} label={plainText(side.text) || 'Study drawing'}/>}<RichText text={side.text} cloze={side.cloze}/></div><div className="study-card-bottom"><div>{card.tags.map(t => <Tag key={t}>{t}</Tag>)}</div>{!flipped && card.hint && <button className="text-button" onClick={() => setHint(v => !v)}><Lightbulb size={16}/>{hint ? card.hint : 'Show hint'}</button>}{flipped && card.source && <a href={card.source} target="_blank" rel="noreferrer" className="text-button">Source <ExternalLink size={14}/></a>}</div></div>
    {failure && <ErrorState message={failure}/>}
    {style === 'classic' ? <div className="study-actions">{!flipped ? <><Button className="primary reveal-button" onClick={() => setFlipped(true)}>Reveal answer <RotateCcw size={18}/></Button><span className="keyboard-hint">or press <kbd>space</kbd></span></> : <><div className="rating-buttons">{[['again', 'Again', 'Review in 10 min'], ['hard', 'Hard', 'Needs practice'], ['good', 'Good', 'Got it right'], ['easy', 'Easy', 'Knew it instantly']].map(([value, label, sub], i) => <button key={value} className={`rating ${value}`} disabled={busy || pending.current && pending.current.items[0]?.rating !== value} onClick={() => rate(value)}><span>{label}<kbd>{i + 1}</kbd></span><small>{card.progress?.preview?.[value] ? <>Next in <strong>{card.progress.preview[value]}</strong></> : sub}</small></button>)}</div><span className="keyboard-hint">{busy ? 'Saving your progress…' : card.progress?.retrievability != null ? <>Predicted recall right now: <strong>{Math.round(card.progress.retrievability * 100)}%</strong> · Be honest with yourself.</> : 'Be honest with yourself. Every review helps.'}</span></>}</div>
      : <div className="study-actions mode-actions" key={`${card.id}-${style}`}>
        {style === 'mcq' && <ChoiceQuestion {...question}/>}
        {style === 'truefalse' && <TrueFalseQuestion {...question}/>}
        {style === 'type' && <TypeQuestion {...question}/>}
        {style === 'voice' && <VoiceQuestion {...question} onTypeInstead={() => chooseMode('type')}/>}
        {verdict}
      </div>}
  </div>;
}
