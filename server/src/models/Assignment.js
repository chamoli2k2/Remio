import mongoose from 'mongoose';
import { ref, options } from './_shared.js';
const { Schema, model } = mongoose;
const assignment = new Schema({ team: ref('Team'), folder: ref('Folder'), createdBy: ref('User'), title: { type: String, default: '' }, instructions: { type: String, default: '' }, dueAt: { type: Date, default: null }, archived: { type: Boolean, default: false } }, options);
assignment.index({ team: 1, dueAt: 1 }); assignment.index({ folder: 1 });
export const Assignment = model('Assignment', assignment);
