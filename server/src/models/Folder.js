import { MEMBER_ROLES, VISIBILITY } from '../constants/index.js';
import mongoose from 'mongoose';
import { ref, options } from './_shared.js';
const { Schema, model } = mongoose;
const folder = new Schema({ title: { type: String, required: true }, description: { type: String, default: '' }, color: { type: String, default: 'violet' }, icon: { type: String, default: 'layers' }, visibility: { type: String, enum: VISIBILITY, default: 'private' }, owner: ref('User'), members: [{ user: ref('User'), role: { type: String, enum: MEMBER_ROLES, required: true }, _id: false }], version: { type: Number, default: 0 }, writeEpoch: { type: Number, default: 0 }, archived: { type: Boolean, default: false }, copiedFrom: ref('Folder', false), originalCreator: { type: String, default: '' }, thumbnail: ref('Media', false), likeCount: { type: Number, default: 0 }, copyCount: { type: Number, default: 0 }, team: ref('Team', false) }, options);
folder.index({ owner: 1, updatedAt: -1 }); folder.index({ 'members.user': 1 }); folder.index({ visibility: 1, archived: 1 }); folder.index({ team: 1, updatedAt: -1 });
export const Folder = model('Folder', folder);
