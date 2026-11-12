import { TEAM_KINDS } from '../constants/index.js';
import mongoose from 'mongoose';
import { ref, options } from './_shared.js';
const { Schema, model } = mongoose;
// `memberCount` is denormalised so the seat check is one read; it is only ever written in the same
// transaction as the membership it counts, which is what keeps a full team from overselling a seat.
const team = new Schema({ name: { type: String, required: true }, kind: { type: String, enum: TEAM_KINDS, default: 'classroom' }, description: { type: String, default: '' }, owner: ref('User'), plan: { type: String, default: '' }, seats: { type: Number, default: 0 }, memberCount: { type: Number, default: 1 }, expiresAt: { type: Date, default: null }, version: { type: Number, default: 0 }, archived: { type: Boolean, default: false } }, options);
team.index({ owner: 1, updatedAt: -1 });
export const Team = model('Team', team);
