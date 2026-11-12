import { RELATIONSHIP_KINDS, RELATIONSHIP_STATUSES } from '../constants/index.js';
import mongoose from 'mongoose';
import { ref, options } from './_shared.js';
const { Schema, model } = mongoose;
const relationship = new Schema({ from: ref('User'), to: ref('User'), kind: { type: String, enum: RELATIONSHIP_KINDS, required: true }, status: { type: String, enum: RELATIONSHIP_STATUSES, required: true } }, options);
relationship.index({ from: 1, to: 1, kind: 1 }, { unique: true });
relationship.index({ to: 1, kind: 1, status: 1 });
relationship.index({ from: 1, kind: 1, status: 1 });
export const Relationship = model('Relationship', relationship);
