import { randomInt } from 'node:crypto';
import { hasCloze, renderCloze } from '../../../shared/cloze.js';
import { answerParts } from '../../../shared/answers.js';
/**
 * Live quiz rooms: a host turns a folder into a multiple-choice game that friends join with a six-letter code.
 * Rooms are in-memory and ephemeral (they die with the last player), so nothing here touches MongoDB. The store is
 * pure apart from an injectable scheduler, which keeps the timing logic unit-testable.
 */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
export const LIMITS = { minCards: 2, maxCards: 30, minSeconds: 5, maxSeconds: 60, maxPlayers: 50 };
export const SCORE = { base: 1000, floor: 0.5, streakBonus: 100, streakCap: 500 };
const shuffle = (arr, rand) => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
// The short form of the answer: the bold key term of a long explanation, or a cloze card's hidden text.
const answerOf = card => answerParts(card)?.display || '';
const promptOf = card => card.back.text.trim() || !hasCloze(card.front.text) ? card.front.text : renderCloze(card.front.text, 'hide', { hiddenOpen: '[', hiddenClose: ']' });
/** Builds one multiple-choice question per card: the card's own answer plus up to three distinct distractors from the deck. */
export function buildQuestions(cards, { count = LIMITS.maxCards, rand = Math.random } = {}) {
  const usable = cards.filter(c => answerOf(c) && (c.front.text.trim() || c.front.image));
  const pool = [...new Set(usable.map(answerOf))];
  return shuffle(usable, rand).slice(0, count).map(card => {
    const answer = answerOf(card);
    const distractors = shuffle(pool.filter(a => a !== answer), rand).slice(0, 3);
    const options = shuffle([answer, ...distractors], rand);
    return { cardId: String(card.id || card._id), prompt: promptOf(card), image: card.front.image ? String(card.front.image) : null, options, correct: options.indexOf(answer) };
  });
}
export const scoreFor = (elapsedMs, totalMs, streak) => Math.round(SCORE.base * (SCORE.floor + (1 - SCORE.floor) * Math.max(0, 1 - elapsedMs / totalMs))) + Math.min(SCORE.streakCap, SCORE.streakBonus * Math.max(0, streak - 1));
export class RoomStore {
  constructor({ schedule = setTimeout, cancel = clearTimeout, now = () => Date.now(), rand = Math.random } = {}) { this.rooms = new Map(); this.schedule = schedule; this.cancel = cancel; this.now = now; this.rand = rand; this.listeners = new Set(); }
  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(room) { for (const fn of this.listeners) fn(room); }
  code() { let c; do { c = Array.from({ length: 6 }, () => ALPHABET[randomInt(ALPHABET.length)]).join(''); } while (this.rooms.has(c)); return c; }
  create({ folder, host, cards, count = 10, seconds = 20 }) {
    count = Math.min(LIMITS.maxCards, Math.max(LIMITS.minCards, Number(count) || 10)); seconds = Math.min(LIMITS.maxSeconds, Math.max(LIMITS.minSeconds, Number(seconds) || 20));
    const questions = buildQuestions(cards, { count, rand: this.rand });
    if (questions.length < LIMITS.minCards) throw Object.assign(new Error('A quiz needs at least two cards with answers.'), { status: 400 });
    const room = { code: this.code(), folderId: String(folder.id || folder._id), folderTitle: folder.title, hostId: String(host.id), phase: 'lobby', questions, index: -1, seconds, players: new Map(), answers: new Map(), questionStartedAt: null, deadline: null, timer: null, createdAt: this.now() };
    this.rooms.set(room.code, room); this.join(room.code, host); return room;
  }
  get(code) { return this.rooms.get(String(code || '').toUpperCase()); }
  join(code, user) {
    const room = this.get(code); if (!room) throw Object.assign(new Error('Room not found. Check the code and try again.'), { status: 404 });
    const id = String(user.id);
    if (!room.players.has(id)) {
      if (room.players.size >= LIMITS.maxPlayers) throw Object.assign(new Error('This room is full.'), { status: 409 });
      room.players.set(id, { id, name: user.name, username: user.username, score: 0, streak: 0, correct: 0, answered: 0, connected: 1, joinedAt: this.now() });
    } else room.players.get(id).connected++;
    this.emit(room); return room;
  }
  leave(code, userId) {
    const room = this.get(code); if (!room) return null; const p = room.players.get(String(userId)); if (!p) return room;
    p.connected = Math.max(0, p.connected - 1);
    if (room.phase === 'lobby' && !p.connected) room.players.delete(p.id);
    if (![...room.players.values()].some(x => x.connected)) { this.destroy(room.code); return null; }
    if (room.hostId === p.id && !p.connected) room.hostId = [...room.players.values()].find(x => x.connected).id; // host handover
    this.emit(room); return room;
  }
  destroy(code) { const room = this.get(code); if (!room) return; if (room.timer) this.cancel(room.timer); this.rooms.delete(room.code); }
  assertHost(room, userId) { if (room.hostId !== String(userId)) throw Object.assign(new Error('Only the host can do that.'), { status: 403 }); }
  start(code, userId) { const room = this.get(code); if (!room) return null; this.assertHost(room, userId); if (room.phase !== 'lobby') return room; return this.next(code, userId); }
  /** Host advances: from lobby/reveal to the next question, or to the podium after the last one. */
  next(code, userId) {
    const room = this.get(code); if (!room) return null; this.assertHost(room, userId);
    if (room.phase === 'question' || room.phase === 'finished') return room;
    if (room.timer) { this.cancel(room.timer); room.timer = null; }
    room.index++; room.answers = new Map();
    if (room.index >= room.questions.length) { room.phase = 'finished'; room.deadline = null; this.emit(room); return room; }
    room.phase = 'question'; room.questionStartedAt = this.now(); room.deadline = room.questionStartedAt + room.seconds * 1000;
    room.timer = this.schedule(() => this.reveal(room.code), room.seconds * 1000);
    this.emit(room); return room;
  }
  answer(code, userId, choice) {
    const room = this.get(code); if (!room || room.phase !== 'question') return null;
    const p = room.players.get(String(userId)); if (!p || room.answers.has(p.id)) return room;
    const q = room.questions[room.index]; choice = Number(choice); if (!(choice >= 0 && choice < q.options.length)) return room;
    const elapsed = Math.min(room.seconds * 1000, this.now() - room.questionStartedAt); const correct = choice === q.correct;
    p.answered++; if (correct) { p.streak++; p.correct++; } else p.streak = 0;
    const points = correct ? scoreFor(elapsed, room.seconds * 1000, p.streak) : 0; p.score += points;
    room.answers.set(p.id, { choice, correct, points, elapsed });
    // Everyone connected has answered: reveal early instead of making the room wait out the clock.
    if ([...room.players.values()].filter(x => x.connected).every(x => room.answers.has(x.id))) this.reveal(room.code); else this.emit(room);
    return room;
  }
  reveal(code) {
    const room = this.get(code); if (!room || room.phase !== 'question') return room;
    if (room.timer) { this.cancel(room.timer); room.timer = null; }
    for (const p of room.players.values()) if (!room.answers.has(p.id)) p.streak = 0; // a timeout breaks the streak too
    room.phase = 'reveal'; room.deadline = null; this.emit(room); return room;
  }
  /** What a client is allowed to see. The correct option is withheld while a question is open. */
  snapshot(code, forUserId) {
    const room = this.get(code); if (!room) return null;
    const q = room.index >= 0 && room.index < room.questions.length ? room.questions[room.index] : null;
    const leaderboard = [...room.players.values()].sort((a, b) => b.score - a.score || a.joinedAt - b.joinedAt).map((p, i) => ({ rank: i + 1, id: p.id, name: p.name, username: p.username, score: p.score, streak: p.streak, correct: p.correct, answered: p.answered, connected: p.connected > 0, isHost: p.id === room.hostId }));
    const mine = forUserId ? room.answers.get(String(forUserId)) : null;
    return {
      code: room.code, folderId: room.folderId, folderTitle: room.folderTitle, hostId: room.hostId, phase: room.phase, seconds: room.seconds, total: room.questions.length, index: room.index,
      deadline: room.deadline, questionStartedAt: room.questionStartedAt, answeredCount: room.answers.size, players: leaderboard,
      question: q && { cardId: q.cardId, prompt: q.prompt, image: q.image, options: q.options, correct: room.phase === 'question' ? null : q.correct },
      myAnswer: mine ? { choice: mine.choice, correct: room.phase === 'question' ? null : mine.correct, points: room.phase === 'question' ? null : mine.points } : null,
      results: room.phase === 'question' ? null : Object.fromEntries([...room.answers].map(([id, a]) => [id, { choice: a.choice, correct: a.correct, points: a.points }]))
    };
  }
}
