import { TEAM_INVITE_ROLES } from '../constants/index.js';
import mongoose from 'mongoose';
import { ref, options } from './_shared.js';
const { Schema, model } = mongoose;
// A join code is a bearer credential, so it is stored hashed and only ever shown once, at creation.
const teamInvite = new Schema({ team: ref('Team'), codeHash: { type: String, required: true, unique: true }, role: { type: String, enum: TEAM_INVITE_ROLES, default: 'student' }, createdBy: ref('User'), expiresAt: { type: Date, default: null }, maxUses: { type: Number, default: 0 }, uses: { type: Number, default: 0 }, revokedAt: { type: Date, default: null } }, options);
teamInvite.index({ team: 1, createdAt: -1 });
export const TeamInvite = model('TeamInvite', teamInvite);
