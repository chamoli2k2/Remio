import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Trophy, Users, Play, ArrowRight, Copy, Check, X, Zap, Crown, Timer, Swords, LogIn } from 'lucide-react';
import { toast } from 'sonner';
import { useApp } from '../hooks/useApp';
import { useRoom } from '../hooks/useRealtime';
import { Button, Avatar, ErrorState, Loading, Field } from '../components/ui';
import RichText from '../components/RichText';
import Img from '../components/Img';
const LETTERS = ['A', 'B', 'C', 'D'];
/** Landing at /rooms: enter a code to join a friend's quiz. */
export function JoinRoomPage() {
  const [code, setCode] = useState(''); const navigate = useNavigate();
  return <div className="room-join"><span className="room-icon"><Swords size={26}/></span><span className="eyebrow">LIVE QUIZ</span><h1>Join a study room</h1><p>Someone hosting a quiz will give you a six-letter code. Enter it below to jump in. Answer fast for more points, keep a streak for a bonus.</p>
    <form onSubmit={e => { e.preventDefault(); if (code.trim().length === 6) navigate(`/rooms/${code.trim().toUpperCase()}`); }}><input aria-label="Room code" className="room-code-input" value={code} maxLength={6} autoFocus placeholder="ABC123" onChange={e => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}/><Button type="submit" className="primary" disabled={code.length !== 6}><LogIn size={17}/> Join room</Button></form>
    <p className="room-hint">Hosting a quiz is Premium. Anyone can still join with a code. Hosts: open a folder and choose <strong>Host a live quiz</strong>.</p></div>;
}
/** /rooms/:code plays a room; /rooms/new?folder=… hosts one. */
export default function RoomPage() {
  const { code } = useParams(); const [params] = useSearchParams(); const navigate = useNavigate(); const { user } = useApp();
  const hosting = code === 'new'; const folderId = hosting ? params.get('folder') : null;
  const { room, error, code: joined, start, next, answer } = useRoom(hosting ? null : code, { folderId, options: { count: Number(params.get('count')) || 10, seconds: Number(params.get('seconds')) || 20 } });
  useEffect(() => { if (hosting && joined) navigate(`/rooms/${joined}`, { replace: true }); }, [hosting, joined]);
  if (error && !room) return <div className="room-join"><span className="room-icon"><X size={26}/></span><h1>Couldn’t open this room</h1><ErrorState message={error}/><Link to="/rooms" className="button secondary">Try another code</Link></div>;
  if (!room) return <Loading/>;
  const me = room.players.find(p => p.id === user.id); const isHost = room.hostId === user.id;
  return <div className="room-page">
    <header className="room-header"><div><span className="eyebrow">LIVE QUIZ · {room.folderTitle}</span><h1>{room.phase === 'lobby' ? 'Waiting for players' : room.phase === 'finished' ? 'Final standings' : `Question ${room.index + 1} of ${room.total}`}</h1></div>
      <div className="room-header-right">{error && <span className="room-warning">{error}</span>}<span className="room-code" title="Share this code">{room.code}</span><Link to={`/folders/${room.folderId}`} className="icon-button" aria-label="Leave room"><X size={22}/></Link></div></header>
    {room.phase === 'lobby' && <Lobby room={room} isHost={isHost} onStart={async () => { const r = await start(); if (!r.ok) toast.error(r.error || 'Could not start'); }}/>}
    {(room.phase === 'question' || room.phase === 'reveal') && <Question room={room} me={me} isHost={isHost} onAnswer={answer} onNext={next}/>}
    {room.phase === 'finished' && <Podium room={room} me={me}/>}
  </div>;
}
function Lobby({ room, isHost, onStart }) {
  const [copied, setCopied] = useState(false); const link = `${window.location.origin}/rooms/${room.code}`;
  const copy = async () => { try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { toast(link); } };
  return <div className="room-lobby">
    <div className="room-invite"><span className="eyebrow">INVITE WITH THIS CODE</span><strong className="room-big-code">{room.code}</strong><p>Friends go to <code>{window.location.host}/rooms</code> and type the code, or open the link.</p><Button className="secondary" onClick={copy}>{copied ? <Check size={16}/> : <Copy size={16}/>} {copied ? 'Copied' : 'Copy invite link'}</Button>
      <div className="room-rules"><span><Timer size={14}/> {room.seconds}s per question</span><span><Zap size={14}/> {room.total} questions</span><span><Trophy size={14}/> Faster answers earn more</span></div></div>
    <div className="room-players"><div className="room-players-head"><Users size={16}/> {room.players.length} player{room.players.length === 1 ? '' : 's'} here</div>
      <ul>{room.players.map(p => <li key={p.id} className={p.connected ? '' : 'is-away'}><Avatar user={p} small/><span>{p.name}</span>{p.isHost && <em><Crown size={12}/> host</em>}</li>)}</ul>
      {isHost ? <Button className="primary room-start" onClick={onStart} disabled={room.players.length < 1}><Play size={18}/> Start the quiz</Button> : <p className="room-waiting">Waiting for the host to start…</p>}</div>
  </div>;
}
function Question({ room, me, isHost, onAnswer, onNext }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { if (room.phase !== 'question') return; const t = setInterval(() => setNow(Date.now()), 100); return () => clearInterval(t); }, [room.phase, room.index]);
  const remaining = room.deadline ? Math.max(0, room.deadline - now) : 0; const pct = room.phase === 'question' ? remaining / (room.seconds * 1000) * 100 : 0;
  const q = room.question; const revealed = room.phase === 'reveal'; const mine = room.myAnswer;
  const counts = revealed ? q.options.map((_, i) => Object.values(room.results || {}).filter(r => r.choice === i).length) : null;
  return <div className="room-question">
    <div className="room-timer"><span style={{ width: `${pct}%` }} className={remaining < 5000 ? 'is-urgent' : ''}/></div>
    <div className="room-status"><span>{room.phase === 'question' ? `${Math.ceil(remaining / 1000)}s` : 'Time’s up'}</span><span>{room.answeredCount} of {room.players.filter(p => p.connected).length} answered</span></div>
    <div className="room-prompt">{q.image && <Img id={q.image} alt="Question image" sizes="(max-width: 640px) 90vw, 520px" eager/>}<RichText text={q.prompt} cloze="show"/></div>
    <div className="room-options">{q.options.map((opt, i) => { const state = revealed ? (i === q.correct ? 'is-correct' : mine?.choice === i ? 'is-wrong' : '') : mine?.choice === i ? 'is-picked' : ''; return <button key={i} type="button" className={`room-option ${state}`} disabled={revealed || !!mine || !me} onClick={() => onAnswer(i)}><span className="room-letter">{LETTERS[i]}</span><RichText text={opt} as="span"/>{revealed && <span className="room-count">{counts[i]}</span>}</button>; })}</div>
    {revealed ? <div className="room-reveal"><div className={`room-verdict ${mine ? (mine.correct ? 'good' : 'bad') : ''}`}>{!mine ? 'You didn’t answer in time.' : mine.correct ? <><Check size={18}/> Correct · +{mine.points} points{me?.streak > 1 && <em> · {me.streak} in a row</em>}</> : <><X size={18}/> Not this time</>}</div>
      <Leaderboard players={room.players} me={me} compact/>
      {isHost ? <Button className="primary" onClick={onNext}>{room.index + 1 >= room.total ? <>See final standings <Trophy size={17}/></> : <>Next question <ArrowRight size={17}/></>}</Button> : <p className="room-waiting">Waiting for the host…</p>}</div>
      : mine ? <p className="room-waiting">Answer locked in. Waiting for the others…</p> : <p className="room-hint-line">Pick an answer. Faster is worth more.</p>}
  </div>;
}
function Leaderboard({ players, me, compact }) {
  return <ol className={`room-leaderboard ${compact ? 'compact' : ''}`}>{players.slice(0, compact ? 5 : 50).map(p => <li key={p.id} className={p.id === me?.id ? 'is-me' : ''}><span className="room-rank">{p.rank}</span><Avatar user={p} small/><span className="room-name">{p.name}{p.isHost && <Crown size={11}/>}</span>{p.streak > 1 && <span className="room-streak"><Zap size={11}/> {p.streak}</span>}<strong>{p.score.toLocaleString()}</strong></li>)}</ol>;
}
function Podium({ room, me }) {
  const top = room.players.slice(0, 3); const mine = room.players.find(p => p.id === me?.id);
  return <div className="room-podium">
    <div className="podium-steps">{[top[1], top[0], top[2]].map((p, i) => p ? <div key={p.id} className={`podium-step place-${[2, 1, 3][i]}`}><Avatar user={p}/><strong>{p.name}</strong><span>{p.score.toLocaleString()} pts</span><em>{[2, 1, 3][i] === 1 ? <Trophy size={16}/> : `#${[2, 1, 3][i]}`}</em></div> : <div key={i} className="podium-step empty"/>)}</div>
    {mine && <p className="room-summary">You finished <strong>#{mine.rank}</strong> with <strong>{mine.score.toLocaleString()}</strong> points · {mine.correct} of {room.total} correct.</p>}
    <Leaderboard players={room.players} me={me}/>
    <div className="room-actions"><Link className="button primary" to={`/folders/${room.folderId}`}>Back to the folder</Link><Link className="button secondary" to={`/folders/${room.folderId}/study?mode=all`}>Review these cards</Link></div>
  </div>;
}
