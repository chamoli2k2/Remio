import mongoose from 'mongoose';
import { ref, options } from './_shared.js';
const { Schema, model } = mongoose;
/**
 * Experience and badges, one row per learner, updated in the same transaction as the review that
 * earned them. Counters rather than queries over the review log, because a badge check runs on
 * every answer and has to cost a single read. Day keys are UTC, like the daily goal and streaks.
 */
const counter = { type: Number, default: 0 };
const gameProfile = new Schema({
  user: { ...ref('User'), unique: true },
  xp: counter, reviews: counter,
  correct: { classic: counter, mcq: counter, truefalse: counter, type: counter, voice: counter, match: counter },
  modesTried: { type: [String], default: [] },
  combo: counter, bestCombo: counter,
  // A finished board is only counted once at least that many match reviews have arrived since the last one.
  matchSinceBoard: counter, boards: counter, flawless: counter, comebacks: counter, night: counter, dawn: counter, doubleGoal: counter, deepRoots: counter,
  lastDay: { type: String, default: '' }, dayStreak: counter, bestDayStreak: counter,
  // Only ever needs to reach the largest "different collections" target, so it stops growing there.
  folders: { type: [Schema.Types.ObjectId], default: [] },
  today: { day: { type: String, default: '' }, reviews: counter, xp: counter, goalMet: { type: Boolean, default: false } },
  badges: { type: [{ _id: false, id: String, at: Date }], default: [] },
}, options);
export const GameProfile = model('GameProfile', gameProfile);
