import { CARD_STATES } from '../constants/index.js';
import mongoose from 'mongoose';
import { ref, options } from './_shared.js';
const { Schema, model } = mongoose;
// FSRS memory state (stability, difficulty, state) plus the legacy SM-2 fields (interval, repetitions, ease) kept for compatibility.
const progress = new Schema({ user: ref('User'), card: ref('Card'), repetitions: { type: Number, default: 0 }, interval: { type: Number, default: 0 }, ease: { type: Number, default: 2.5 }, stability: { type: Number, default: 0 }, difficulty: { type: Number, default: 0 }, state: { type: String, enum: CARD_STATES, default: 'new' }, reps: { type: Number, default: 0 }, lapses: { type: Number, default: 0 }, elapsedDays: { type: Number, default: 0 }, scheduledDays: { type: Number, default: 0 }, dueAt: { type: Date, default: Date.now }, lastReviewedAt: Date, version: { type: Number, default: 0 }, bookmarked: { type: Boolean, default: false } }, options);
progress.index({ user: 1, card: 1 }, { unique: true }); progress.index({ user: 1, dueAt: 1 });
export const Progress = model('Progress', progress);
