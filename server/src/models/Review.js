import { RATINGS } from '../constants/index.js';
import mongoose from 'mongoose';
import { ref, options } from './_shared.js';
const { Schema, model } = mongoose;
const review = new Schema({ user: ref('User'), card: ref('Card'), folder: ref('Folder', false), requestId: { type: String, required: true }, rating: { type: String, enum: RATINGS }, mode: { type: String, default: 'classic' }, elapsedDays: Number, result: Schema.Types.Mixed, game: Schema.Types.Mixed }, options);
review.index({ user: 1, requestId: 1 }, { unique: true }); review.index({ user: 1, createdAt: -1 });
export const Review = model('Review', review);
