import { uuid } from '../services/uuid';
import AdSlot from '../components/AdSlot';
import { useState, useEffect, useRef, useMemo, lazy, Suspense } from 'react';
import { preload } from 'react-dom';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { X, ArrowRight, RotateCcw, Lightbulb, Check, ExternalLink, Flame, Trophy, Zap, Sparkles, Pencil } from 'lucide-react';
import { toast } from 'sonner';
import { useQuery, useApp } from '../hooks/useApp';
import { api, imageUrl } from '../services/api';
import { enqueue, flush, flushSoon, subscribe, versionFor, pendingCards, pendingCount } from '../services/reviewSync';
import Img from '../components/Img';
import DrawingView from '../components/DrawingView';
import { Loading, ErrorState, Tag, FolderIcon, Empty, Button } from '../components/ui';
import RichText, { sideOf, plainText } from '../components/RichText';
import { MODES, MODE_IDS, XP, xpForReview, isSkip, isCorrect } from '../../../shared/game.js';
import { srcSet } from '../../../shared/images.js';
import { answerPool, playable, boardFrom, pointsFor, recordBest, partsOf, SpeechRecognition } from '../components/study/modes';
import { ModePicker, ModeTag, ChoiceQuestion, TrueFalseQuestion, TypeQuestion, SpeakAnswer, MatchBoard } from '../components/study/StudyModes';
import { BadgeMedal, LevelBar, badgeById } from '../components/study/GameBits';

const PRAISE = ['Spot on.', 'Nailed it.', 'Exactly right.', 'You knew that.', 'Sharp.'];
const FALLBACK = { mcq: 'choose from', truefalse: 'judge', type: 'type', voice: 'say', match: 'match' };
const IMAGE_SIZES = '(max-width: 640px) 90vw, 520px';
const CardEditor = lazy(() => import('../components/CardEditor'));

/**
 * Cards for a session. Reviews still waiting in the outbox are sent first, so the progress loaded
 * includes them; if they cannot be sent, a due-only session leaves those cards out rather than
 * offering them again.
 */
async function loadSession(id, dueOnly) {
  await flushSoon(2500);
  const [f, c] = await Promise.all([api(`/folders/${id}`), api(`/folders/${id}/cards`)]);
  const queued = dueOnly ? pendingCards() : new Set();
  return { ...f, cards: c.cards.filter(card => !dueOnly || (!queued.has(card.id) && (!card.progress?.dueAt || new Date(card.progress.dueAt) <= new Date()))) };
}

export default function StudyPage() {
  const { id } = useParams(); const [params, setParams] = useSearchParams(); const dueOnly = params.get('mode') === 'due'; const { refresh } = useApp();
  const { data, loading, error } = useQuery(`study:${id}:${dueOnly ? 'due' : 'all'}`, () => loadSession(id, dueOnly));
  const [queue, setQueue] = useState(null), [index, setIndex] = useState(0), [flipped, setFlipped] = useState(false), [hint, setHint] = useState(false);
  const [ratings, setRatings] = useState([]), [sync, setSync] = useState(() => ({ pending: pendingCount(), offline: false }));
  // Picked once on the screen before the first card, then fixed: it is in the URL so a reload keeps it.
  const mode = MODE_IDS.includes(params.get('play')) ? params.get('play') : null;
  const [graded, setGraded] = useState(null);
  const [session, setSession] = useState({ points: 0, xp: 0, combo: 0, level: null, badges: [], best: null });
  const [pop, setPop] = useState(null), [editing, setEditing] = useState(false);
  // What each queued review was shown as worth, so the server's figure can replace it when it lands;
  // when each card was last answered here; and the card last answered, so a double tap counts once.
  const estimates = useRef(new Map()), answeredAt = useRef(new Map()), answered = useRef(-1);
  useEffect(() => { if (data && !queue) setQueue(data.cards); }, [data, queue]);
  useEffect(() => subscribe(event => {
    if (event.results) for (const r of event.results) if (estimates.current.has(r.requestId)) { settle(r, estimates.current.get(r.requestId)); estimates.current.delete(r.requestId); }
    if ('pending' in event) setSync({ pending: event.pending, offline: !!event.offline });
  }), []); // eslint-disable-line react-hooks/exhaustive-deps
  // Leaving the session sends what is left and drops its cached cards, so coming back loads fresh ones.
  useEffect(() => () => { flush(); refresh(`study:${id}`); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const pool = useMemo(() => answerPool(data?.cards || []), [data]);
  const unavailable = useMemo(() => {
    const cards = data?.cards || [], out = {};
    for (const m of ['mcq', 'truefalse', 'match']) if (pool.length < 2) out[m] = 'Needs at least two cards with different answers.';
    if (!cards.some(c => partsOf(c)?.target)) out.type = 'No answer here is short enough to type.';
    if (!SpeechRecognition) out.voice = 'This browser cannot listen. Try Chrome, Edge or Safari.';
    else if (!cards.some(c => partsOf(c))) out.voice = 'No card here has a written answer to compare with.';
    return out;
  }, [data, pool]);
  const activeMode = !mode || unavailable[mode] ? 'classic' : mode;
  const card = queue?.[index];
  const board = useMemo(() => (activeMode === 'match' && queue ? boardFrom(queue, index, pool) : []), [activeMode, queue, index, pool]);
  const style = !card ? null : activeMode === 'match' ? (board.length ? 'match' : 'classic') : playable(card, activeMode, pool) ? activeMode : 'classic';
  const side = card && sideOf(card, flipped);

  const startIn = next => setParams(p => { const n = new URLSearchParams(p); n.set('play', next); return n; });

  /** The server's answer for a review shown earlier: correct the XP shown, and celebrate what it earned. */
  function settle(result, estimate) {
    const game = result.ok ? result.game : null;
    setSession(s => ({ ...s, xp: s.xp + (game?.xp || 0) - estimate, level: game?.level || s.level, badges: [...s.badges, ...(game?.badges || [])] }));
    if (game?.goalBonus) toast.success(`Daily goal reached. +${XP.goalBonus} XP.`, { icon: <Trophy size={16}/> });
    for (const badgeId of game?.badges || []) {
      const b = badgeById[badgeId];
      if (b) toast.custom(() => <div className="badge-toast"><BadgeMedal id={badgeId} size={44}/><div><span>BADGE UNLOCKED</span><strong>{b.name}</strong><p>{b.blurb}</p></div></div>, { duration: 6000 });
    }
    if (game?.levelUp) toast.success(`Level ${game.level.level} reached. You are now a ${game.level.title}.`, { icon: <Sparkles size={16}/> });
  }

  /**
   * Answer cards and move straight on. The reviews go to the outbox and reach the server in a batch
   * a few seconds later, so nothing here waits on the network. The XP shown at once is worked out
   * with the server's own rules; the server's figure replaces it when the batch is acknowledged,
   * which is also when a daily goal, a badge or a level is confirmed.
   */
  function answer(items, { board: boardBonus = 0 } = {}) {
    if (answered.current === index) return;
    answered.current = index;
    const now = Date.now(); let combo = session.combo, points = boardBonus, xp = 0;
    const reviews = items.map(({ card: c, seconds, ...it }) => {
      const echo = !!it.echo, skipped = isSkip(it.mode, it.reply);
      combo = isCorrect(it.rating) && !skipped ? combo + 1 : 0;
      const last = answeredAt.current.get(c.id) ?? (c.progress?.lastReviewedAt ? new Date(c.progress.lastReviewedAt).getTime() : null);
      const repeat = last != null && now - last < XP.repeatWindowMs;
      const estimate = skipped ? 0 : echo ? (repeat ? XP.repeatXp : XP.echoXp) : xpForReview({ rating: it.rating, mode: it.mode, combo, firstSight: !c.progress?.reps && last == null, repeat });
      answeredAt.current.set(c.id, now);
      const requestId = uuid();
      estimates.current.set(requestId, estimate); xp += estimate;
      if (!skipped) points += pointsFor({ rating: it.rating, combo, seconds });
      // Only the server's blank check needs a typed or spoken reply, so only a short piece of it is
      // sent; an answer said back is compared with the card, so it goes whole.
      const reply = it.reply == null ? undefined : echo ? it.reply.slice(0, 4000) : it.reply.trim().slice(0, 100);
      return { ...it, reply, cardId: c.id, requestId, version: versionFor(c), localHour: new Date(now).getHours(), reviewedAt: new Date(now).toISOString() };
    });
    enqueue(reviews);
    setSession(s => ({ ...s, points: s.points + points, xp: s.xp + xp, combo }));
    setRatings(v => [...v, ...items.map(i => i.rating)]);
    if (xp) setPop({ key: uuid(), xp });
    setIndex(v => v + items.length); setFlipped(false); setHint(false); setGraded(null);
  }
  const itemFor = (c, rating, extra = {}) => ({ card: c, rating, mode: style === 'classic' ? 'classic' : style, ...extra });
  const rate = rating => answer([itemFor(card, rating)]);
  const onGraded = result => { setGraded(result); setFlipped(true); };
  const proceed = (rating = graded?.rating) => answer([graded?.echo?.passed
    ? itemFor(card, 'again', { reply: graded.echo.reply, echo: true })
    : itemFor(card, rating, { seconds: graded?.seconds, reply: graded?.reply })]);
  function finishBoard({ mistakes, total }) {
    const items = board.map((c, i) => itemFor(c, !mistakes[c.id] ? 'good' : mistakes[c.id] === 1 ? 'hard' : 'again', i === board.length - 1 ? { board: { pairs: board.length, mistakes: total } } : {}));
    answer(items, { board: total ? 0 : 50 * board.length });
  }

  // The next card's pictures start downloading while this one is being answered.
  const next = queue?.[index + 1];
  useEffect(() => {
    for (const s of next ? [next.front, next.back] : []) if (s?.image) preload(imageUrl(s.image), { as: 'image', imageSrcSet: srcSet(w => `${imageUrl(s.image)}?w=${w}`), imageSizes: IMAGE_SIZES });
  }, [next]);

  useEffect(() => {
    function key(e) {
      // The editor's text areas are not plain inputs, so its typing would otherwise flip and rate the card.
      if (editing) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      if (style === 'classic') {
        if (e.code === 'Space' && card) { e.preventDefault(); setFlipped(v => !v); }
        if (flipped && ['1', '2', '3', '4'].includes(e.key)) rate(['again', 'hard', 'good', 'easy'][Number(e.key) - 1]);
      } else if (graded && !(e.target instanceof HTMLButtonElement) && (e.key === 'Enter' || e.code === 'Space')) { e.preventDefault(); proceed(); }
    }
    document.addEventListener('keydown', key); return () => document.removeEventListener('keydown', key);
  });

  const finished = queue && index >= queue.length;
  useEffect(() => { if (finished && session.best == null) setSession(s => ({ ...s, best: recordBest(id, activeMode, s.points) })); }, [finished]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (finished) flush(); }, [finished]);

  if (loading || !queue) return error ? <ErrorState message={error}/> : <Loading/>;
  if (!queue.length) return <Empty title="You’re all caught up" text="There are no cards due in this folder. Come back later or try a quick review." action={<Link className="button primary" to={`/folders/${id}`}>Back to folder</Link>}/>;

  const header = <><div className="study-header"><div className={`small-folder-icon ${data.folder.color}`}><FolderIcon name={data.folder.icon} size={21}/></div><div><span>STUDY SESSION</span><strong>{data.folder.title}</strong></div><Link to={`/folders/${id}`} className="icon-button" aria-label="Exit study session"><X size={22}/></Link></div><div className="session-progress"><span style={{ width: `${Math.min(1, index / queue.length) * 100}%` }}/></div></>;

  if (!mode || unavailable[mode]) return <div className="study-page">{header}<ModePicker unavailable={unavailable} count={queue.length} onPick={startIn}/></div>;
  function anotherMode() {
    setQueue(null); setIndex(0); setRatings([]); setGraded(null); setFlipped(false);
    answered.current = -1; estimates.current.clear();
    setSession({ points: 0, xp: 0, combo: 0, level: session.level, badges: [], best: null });
    setParams({ mode: 'all' });
  }

  if (finished) {
    const remembered = ratings.filter(r => r !== 'again').length;
    return <div className="study-page">{header}<div className="study-complete">
      <span className="complete-icon"><Check size={36}/></span><span className="eyebrow">A LITTLE WISER THAN BEFORE</span><h1>That’s a good session.</h1>
      <p>You reviewed {ratings.length} cards in {MODES[activeMode].label.toLowerCase()}. {!sync.pending ? 'Your next reviews are scheduled.' : sync.offline ? 'Your answers are saved on this device and will sync when you are back online.' : 'Saving your answers…'}</p>
      <div className="session-result">
        <div><strong>{session.points.toLocaleString()}</strong><span>points{session.best?.isNew ? ' · new best' : ''}</span></div>
        <div><strong>{remembered}</strong><span>remembered</span></div>
        {session.xp > 0 && <div><strong>+{session.xp}</strong><span>XP earned</span></div>}
      </div>
      {session.best?.isNew && <p className="best-note"><Trophy size={15}/> New personal best for this collection in {MODES[activeMode].label.toLowerCase()}.</p>}
      {session.level && <div className="complete-level"><LevelBar level={session.level}/></div>}
      {session.badges.length > 0 && <div className="complete-badges"><span className="eyebrow">BADGES UNLOCKED</span><div>{session.badges.map(b => <div key={b} className="complete-badge"><BadgeMedal id={b} size={56}/><strong>{badgeById[b]?.name}</strong></div>)}</div></div>}
      <div className="complete-actions"><Link to={`/folders/${id}`} className="button primary">Back to collection <ArrowRight size={17}/></Link><Button className="secondary" onClick={anotherMode}>Practise again in a mode</Button><Link to="/progress" className="button secondary">See your badges</Link></div>
      <AdSlot placement="afterStudy"/>
    </div></div>;
  }

  const hud = <div className="study-hud">
    <ModeTag mode={activeMode}/>
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
    </div>;
  }

  const echoed = graded?.echo?.passed;
  const verdict = graded && <div className={`verdict-bar is-${echoed ? 'close' : graded.verdict}`} role="status">
    <span className="verdict-icon">{graded.verdict === 'wrong' && !echoed ? <X size={18}/> : <Check size={18}/>}</span>
    <div><strong>{echoed ? 'Said it back.' : graded.verdict === 'right' ? PRAISE[index % PRAISE.length] : graded.verdict === 'close' ? (style === 'voice' ? 'Partly there. Compare with the card.' : 'Almost. Check the spelling.') : 'Not this time.'}</strong><small>{echoed ? `Worth ${XP.echoXp} XP for practising it. It will still come back sooner.` : graded.skipped ? (style === 'voice' ? 'No XP unless you say it back. It will come back sooner.' : 'Skipped, so no XP. It will come back sooner.') : graded.verdict === 'wrong' ? 'It will come back sooner, so you can try again.' : 'Read the explanation while it’s fresh.'}</small></div>
    <div className="verdict-actions">{graded.overridable && <button type="button" className="text-button" onClick={() => proceed('good')}>I was right</button>}<Button className="primary" onClick={() => proceed()}>Continue <ArrowRight size={16}/></Button></div>
  </div>;

  const question = { card, pool, graded, onGraded };
  const editable = activeMode === 'classic' && style === 'classic' && ['owner', 'editor'].includes(data.folder.role);
  const faceOf = s => <>{s.image && <Img id={s.image} alt={plainText(s.text) || 'Study image'} sizes="(max-width: 640px) 90vw, 520px" eager/>}{s.drawing && <DrawingView folderId={data.folder.id} id={s.drawing} label={plainText(s.text) || 'Study drawing'}/>}<RichText text={s.text} cloze={s.cloze}/></>;

  if (style === 'voice') {
    return <div className="study-page is-playing is-speaking">{header}{hud}
      <div className="study-counter"><span>Card {index + 1} of {queue.length}</span><span>{graded ? 'Compare your answer with the card.' : 'Say your answer out loud.'}</span></div>
      <div className="speak-layout" key={card.id}>
        <div className="study-card speak-question"><div className="study-card-label">THE QUESTION</div><div className="study-card-body">{faceOf(sideOf(card, false))}</div><div className="study-card-bottom"><div>{card.tags.map(t => <Tag key={t}>{t}</Tag>)}</div>{card.hint && !graded && <button className="text-button" onClick={() => setHint(v => !v)}><Lightbulb size={16}/>{hint ? card.hint : 'Show hint'}</button>}{graded && card.source && <a href={card.source} target="_blank" rel="noreferrer" className="text-button">Source <ExternalLink size={14}/></a>}</div></div>
        <SpeakAnswer card={card} graded={graded} onGraded={setGraded} onEcho={echo => setGraded(g => ({ ...g, echo }))} answerSide={faceOf(sideOf(card, true))}/>
      </div>
      {verdict && <div className="study-actions mode-actions">{verdict}</div>}
    </div>;
  }

  return <div className={`study-page ${style !== 'classic' ? 'is-playing' : ''}`}>{header}{hud}
    <div className="study-counter"><span>Card {index + 1} of {queue.length}</span><span>{style === 'classic' ? (flipped ? 'How well did you remember?' : 'Take a moment. You know more than you think.') : graded ? 'Here’s the full answer.' : MODES[style].label}</span></div>
    {style === 'classic' && activeMode !== 'classic' && <p className="mode-fallback">{activeMode === 'voice' ? 'This card has no written answer to compare with' : `This answer is too long to ${FALLBACK[activeMode]}`}, so flip it and rate yourself.</p>}
    <div className={`study-card ${flipped ? 'answer-visible' : ''} ${graded ? `is-graded is-${graded.verdict}` : ''}`}><div className="study-card-label">{flipped ? 'THE ANSWER' : 'THE QUESTION'}</div><div className="study-card-body" data-face={flipped ? 'back' : 'front'}>{side.image && <Img id={side.image} alt={plainText(side.text) || 'Study image'} sizes="(max-width: 640px) 90vw, 520px" eager/>}{side.drawing && <DrawingView folderId={data.folder.id} id={side.drawing} label={plainText(side.text) || 'Study drawing'}/>}<RichText text={side.text} cloze={side.cloze}/></div><div className="study-card-bottom"><div>{card.tags.map(t => <Tag key={t}>{t}</Tag>)}</div><div className="study-card-tools">{!flipped && card.hint && <button className="text-button" onClick={() => setHint(v => !v)}><Lightbulb size={16}/>{hint ? card.hint : 'Show hint'}</button>}{flipped && card.source && <a href={card.source} target="_blank" rel="noreferrer" className="text-button">Source <ExternalLink size={14}/></a>}{editable && <button className="text-button" onClick={() => setEditing(true)}><Pencil size={14}/> Edit card</button>}</div></div></div>
    {editing && <Suspense fallback={null}><CardEditor folder={data.folder} card={card} onClose={() => setEditing(false)} onSaved={saved => setQueue(q => q.map(c => (c.id === saved.id ? { ...c, ...saved, progress: c.progress } : c)))}/></Suspense>}
    {style === 'classic' ? <div className="study-actions">{!flipped ? <><Button className="primary reveal-button" onClick={() => setFlipped(true)}>Reveal answer <RotateCcw size={18}/></Button><span className="keyboard-hint">or press <kbd>space</kbd></span></> : <><div className="rating-buttons">{[['again', 'Again', 'Review in 10 min'], ['hard', 'Hard', 'Needs practice'], ['good', 'Good', 'Got it right'], ['easy', 'Easy', 'Knew it instantly']].map(([value, label, sub], i) => <button key={value} className={`rating ${value}`} onClick={() => rate(value)}><span>{label}<kbd>{i + 1}</kbd></span><small>{card.progress?.preview?.[value] ? <>Next in <strong>{card.progress.preview[value]}</strong></> : sub}</small></button>)}</div><span className="keyboard-hint">{card.progress?.retrievability != null ? <>Predicted recall right now: <strong>{Math.round(card.progress.retrievability * 100)}%</strong> · Be honest with yourself.</> : 'Be honest with yourself. Every review helps.'}</span></>}</div>
      : <div className="study-actions mode-actions" key={`${card.id}-${style}`}>
        {style === 'mcq' && <ChoiceQuestion {...question}/>}
        {style === 'truefalse' && <TrueFalseQuestion {...question}/>}
        {style === 'type' && <TypeQuestion {...question}/>}
        {verdict}
      </div>}
  </div>;
}
