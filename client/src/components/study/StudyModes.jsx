import { useEffect, useMemo, useRef, useState } from 'react';
import { Layers, ListChecks, CircleCheckBig, Keyboard, Mic, Puzzle, Check, X, MicOff, RotateCcw, Timer } from 'lucide-react';
import RichText from '../RichText';
import { MODES } from '../../../../shared/game.js';
import { partsOf, optionsFor, statementFor, gradeAnswer, promptText, SpeechRecognition, VOICE_LANGS, defaultVoiceLang } from './modes';

const MODE_ICONS = { classic: Layers, mcq: ListChecks, truefalse: CircleCheckBig, type: Keyboard, voice: Mic, match: Puzzle };
const SHORT_LABELS = { classic: 'Flip', mcq: 'Choices', truefalse: 'True / false', type: 'Type', voice: 'Speak', match: 'Match' };
const LETTERS = ['A', 'B', 'C', 'D'];

/** The six ways to study, as one scrollable row of chips. A mode the deck cannot support says why. */
export function ModeBar({ mode, onChange, unavailable = {} }) {
  return <div className="mode-bar" role="radiogroup" aria-label="How to study">
    {Object.keys(MODES).map(id => {
      const Icon = MODE_ICONS[id]; const reason = unavailable[id];
      return <button key={id} type="button" role="radio" aria-checked={mode === id} className={`mode-chip ${mode === id ? 'is-active' : ''}`} disabled={!!reason} title={reason || MODES[id].label} onClick={() => onChange(id)}>
        <Icon size={15}/><span>{SHORT_LABELS[id]}</span>{MODES[id].xp > 1 && <small>×{MODES[id].xp}</small>}
      </button>;
    })}
  </div>;
}

const secondsSince = t => (Date.now() - t) / 1000;

/** Four options; one is this card's answer and the rest are other cards' answers. Keys 1–4 pick. */
export function ChoiceQuestion({ card, pool, graded, onGraded }) {
  const { options, correct } = useMemo(() => optionsFor(card, pool), [card, pool]);
  const started = useRef(Date.now()); const [picked, setPicked] = useState(null);
  function pick(i) {
    if (graded) return; setPicked(i);
    const right = i === correct;
    onGraded({ rating: right ? 'good' : 'again', verdict: right ? 'right' : 'wrong', seconds: secondsSince(started.current) });
  }
  useEffect(() => {
    const key = e => { if (e.target instanceof HTMLInputElement) return; const n = Number(e.key); if (n >= 1 && n <= options.length) pick(n - 1); };
    document.addEventListener('keydown', key); return () => document.removeEventListener('keydown', key);
  });
  return <div className="choice-grid">
    {options.map((opt, i) => {
      const state = graded ? (i === correct ? 'is-correct' : i === picked ? 'is-wrong' : 'is-dim') : '';
      return <button key={i} type="button" className={`choice ${state}`} disabled={!!graded} onClick={() => pick(i)}>
        <span className="choice-letter">{graded && i === correct ? <Check size={14}/> : graded && i === picked ? <X size={14}/> : LETTERS[i]}</span>
        <RichText text={opt} as="span"/>
      </button>;
    })}
  </div>;
}

/** "Is this the answer?" Half the time it is. T and F, or the arrow keys, answer. */
export function TrueFalseQuestion({ card, pool, graded, onGraded }) {
  const { shown, truth } = useMemo(() => statementFor(card, pool), [card, pool]);
  const started = useRef(Date.now()); const [said, setSaid] = useState(null);
  function answer(value) {
    if (graded) return; setSaid(value);
    const right = value === truth;
    onGraded({ rating: right ? 'good' : 'again', verdict: right ? 'right' : 'wrong', seconds: secondsSince(started.current) });
  }
  useEffect(() => {
    const key = e => { if (e.target instanceof HTMLInputElement) return; if (['t', 'ArrowLeft'].includes(e.key)) answer(true); if (['f', 'ArrowRight'].includes(e.key)) answer(false); };
    document.addEventListener('keydown', key); return () => document.removeEventListener('keydown', key);
  });
  return <div className="tf-box">
    <div className={`tf-statement ${graded ? (truth ? 'is-true' : 'is-false') : ''}`}><span>Is this the answer?</span><RichText text={shown}/></div>
    <div className="tf-actions">
      {[[true, 'True', Check, 'T'], [false, 'False', X, 'F']].map(([value, label, Icon, k]) => <button key={label} type="button" disabled={!!graded} className={`tf-button ${value ? 'is-yes' : 'is-no'} ${graded && said === value ? (value === truth ? 'is-correct' : 'is-wrong') : ''}`} onClick={() => answer(value)}><Icon size={18}/>{label}<kbd>{k}</kbd></button>)}
    </div>
  </div>;
}

/** Type it from memory. Small typos are forgiven but cost a little; a miss shows what was expected. */
export function TypeQuestion({ card, graded, onGraded }) {
  const target = partsOf(card).target; const [value, setValue] = useState(''); const input = useRef(null);
  useEffect(() => { input.current?.focus({ preventScroll: true }); }, [card]);
  function check(e) {
    e?.preventDefault(); if (graded) return;
    const verdict = gradeAnswer(value, target);
    onGraded({ rating: verdict === 'exact' ? 'good' : verdict === 'close' ? 'hard' : 'again', verdict: verdict === 'exact' ? 'right' : verdict === 'close' ? 'close' : 'wrong', reply: value, overridable: verdict !== 'exact' });
  }
  return <form className="type-box" onSubmit={check}>
    <input ref={input} value={value} onChange={e => setValue(e.target.value)} disabled={!!graded} placeholder="Type your answer" autoComplete="off" autoCapitalize="off" spellCheck={false} enterKeyHint="done" maxLength={200} aria-label="Your answer"/>
    {!graded && <div className="type-actions"><button type="button" className="text-button" onClick={() => onGraded({ rating: 'again', verdict: 'wrong', reply: '', overridable: false })}>I don’t know</button><button type="submit" className="button primary" disabled={!value.trim()}>Check <kbd>↵</kbd></button></div>}
    {graded && graded.verdict !== 'right' && <p className="type-diff">{graded.reply ? <>You wrote <s>{graded.reply}</s> · </> : null}Answer: <strong>{target}</strong></p>}
  </form>;
}

const SPEECH_ERRORS = {
  'not-allowed': 'Microphone access is blocked. Allow it for this site in your browser settings, or type instead.',
  'service-not-allowed': 'Speech recognition is not available here. On iPhone, try it in Safari, or type instead.',
  'no-speech': 'I didn’t hear anything. Tap the microphone and try again.',
  'audio-capture': 'No microphone was found.',
  network: 'Speech recognition needs an internet connection.',
};

/** Say the answer out loud. Up to three tries; a right answer on a later try counts as "hard". */
export function VoiceQuestion({ card, graded, onGraded, onTypeInstead }) {
  const target = partsOf(card).target;
  const [lang, setLang] = useState(defaultVoiceLang); const [listening, setListening] = useState(false);
  const [heard, setHeard] = useState(''); const [tries, setTries] = useState(0); const [problem, setProblem] = useState('');
  const rec = useRef(null), triesRef = useRef(0);
  useEffect(() => () => rec.current?.abort(), []);
  useEffect(() => { rec.current?.abort(); setHeard(''); setTries(0); triesRef.current = 0; setProblem(''); }, [card]);

  function finish(alternatives) {
    const attempt = ++triesRef.current; setTries(attempt);
    const verdict = alternatives.map(a => gradeAnswer(a, target)).sort((a, b) => ['exact', 'close', 'wrong'].indexOf(a) - ['exact', 'close', 'wrong'].indexOf(b))[0] || 'wrong';
    if (verdict !== 'wrong') onGraded({ rating: attempt === 1 ? 'good' : 'hard', verdict: 'right', reply: alternatives[0] });
    else if (attempt >= 3) onGraded({ rating: 'again', verdict: 'wrong', reply: alternatives[0] || '', overridable: true });
  }
  function listen() {
    if (!SpeechRecognition || listening || graded) return;
    setProblem(''); setHeard('');
    const r = new SpeechRecognition(); rec.current = r;
    r.lang = lang; r.interimResults = true; r.maxAlternatives = 5; r.continuous = false;
    let done = false;
    r.onresult = e => {
      const result = e.results[e.results.length - 1];
      setHeard([...e.results].map(x => x[0].transcript).join(' '));
      if (result.isFinal && !done) { done = true; finish([...result].map(a => a.transcript)); }
    };
    r.onerror = e => { if (e.error !== 'aborted') setProblem(SPEECH_ERRORS[e.error] || 'Something went wrong with speech recognition. Try again, or type instead.'); };
    r.onend = () => setListening(false);
    try { r.start(); setListening(true); } catch { setProblem(SPEECH_ERRORS['service-not-allowed']); }
  }
  function changeLang(value) { setLang(value); try { localStorage.setItem('remio:voice-lang', value); } catch { /* private mode */ } }

  return <div className="voice-box">
    <button type="button" className={`mic-button ${listening ? 'is-listening' : ''}`} onClick={listening ? () => rec.current?.stop() : listen} disabled={!!graded} aria-label={listening ? 'Stop listening' : 'Speak your answer'}>
      {listening ? <span className="mic-waves" aria-hidden="true"><i/><i/><i/></span> : null}<Mic size={28}/>
    </button>
    <p className="voice-status" aria-live="polite">
      {graded ? (graded.reply ? <>Heard “{graded.reply}”</> : null)
        : listening ? (heard ? <>“{heard}”</> : 'Listening…')
          : tries > 0 ? <>Heard “{heard}”. Not quite. {3 - tries} {3 - tries === 1 ? 'try' : 'tries'} left.</>
            : 'Tap the microphone and say the answer.'}
    </p>
    {problem && <p className="voice-problem" role="alert"><MicOff size={14}/>{problem}</p>}
    {!graded && <div className="voice-tools">
      <select value={lang} onChange={e => changeLang(e.target.value)} aria-label="Language you will speak">{VOICE_LANGS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select>
      {tries > 0 && <button type="button" className="text-button" onClick={() => onGraded({ rating: 'again', verdict: 'wrong', reply: heard, overridable: true })}>Show the answer</button>}
      <button type="button" className="text-button" onClick={onTypeInstead}><Keyboard size={14}/> Type instead</button>
    </div>}
    {graded && graded.verdict !== 'right' && <p className="type-diff">Answer: <strong>{target}</strong></p>}
    <small className="voice-note">Your browser’s speech service turns what you say into text.</small>
  </div>;
}

/**
 * Two columns, questions and answers, shuffled separately. Tap one from each side. A wrong pair
 * shakes and counts against that question; a right pair melts away. Each card's rating follows
 * from its own mistakes, so one confusion does not mark the whole board down.
 */
export function MatchBoard({ cards, onDone }) {
  const tiles = useMemo(() => {
    const left = cards.map(c => ({ id: c.id, side: 'q', text: promptText(c) }));
    const right = cards.map(c => ({ id: c.id, side: 'a', text: partsOf(c).display }));
    const mix = a => [...a].sort(() => Math.random() - 0.5);
    return { left: mix(left), right: mix(right) };
  }, [cards]);
  const [selected, setSelected] = useState(null), [matched, setMatched] = useState(() => new Set()), [shake, setShake] = useState(null);
  const mistakes = useRef({}); const started = useRef(Date.now()); const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 250); return () => clearInterval(t); }, []);
  useEffect(() => { setSelected(null); setMatched(new Set()); mistakes.current = {}; started.current = Date.now(); }, [cards]);

  function tap(tile) {
    if (matched.has(tile.id)) return;
    if (!selected || selected.side === tile.side) { setSelected(tile); return; }
    const question = tile.side === 'q' ? tile : selected;
    if (selected.id === tile.id) {
      const next = new Set(matched).add(tile.id); setMatched(next); setSelected(null);
      if (next.size === cards.length) {
        const total = Object.values(mistakes.current).reduce((a, b) => a + b, 0);
        setTimeout(() => onDone({ mistakes: { ...mistakes.current }, total, seconds: secondsSince(started.current) }), 450);
      }
    } else {
      mistakes.current[question.id] = (mistakes.current[question.id] || 0) + 1;
      setShake([selected.side + selected.id, tile.side + tile.id]); setSelected(null);
      setTimeout(() => setShake(null), 450);
    }
  }
  const total = Object.values(mistakes.current).reduce((a, b) => a + b, 0);
  const column = list => list.map(t => {
    const key = t.side + t.id; const done = matched.has(t.id);
    return <button key={key} type="button" disabled={done} onClick={() => tap(t)} className={`match-tile side-${t.side} ${selected && selected.side + selected.id === key ? 'is-selected' : ''} ${done ? 'is-matched' : ''} ${shake?.includes(key) ? 'is-shaking' : ''}`}>
      {t.side === 'a' ? <RichText text={t.text} as="span"/> : <span>{t.text}</span>}
    </button>;
  });
  return <div className="match-board" data-no-gestures>
    <div className="match-meta"><span><Timer size={14}/> {Math.floor((now - started.current) / 1000)}s</span><span>{matched.size} of {cards.length} matched</span><span className={total ? 'has-misses' : ''}>{total} {total === 1 ? 'miss' : 'misses'}</span></div>
    <div className="match-columns"><div className="match-column">{column(tiles.left)}</div><div className="match-column">{column(tiles.right)}</div></div>
    <p className="match-hint"><RotateCcw size={13}/> Tap a question, then its answer.</p>
  </div>;
}
