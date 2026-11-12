import { TEAM_MEMBER_ROLES } from '../constants/index.js';
import mongoose from 'mongoose';
import { ref, options } from './_shared.js';
const { Schema, model } = mongoose;
const teamMember = new Schema({ team: ref('Team'), user: ref('User'), role: { type: String, enum: TEAM_MEMBER_ROLES, required: true }, invitedBy: ref('User', false) }, options);
teamMember.index({ team: 1, user: 1 }, { unique: true }); teamMember.index({ user: 1 }); teamMember.index({ team: 1, role: 1 });
export const TeamMember = model('TeamMember', teamMember);
