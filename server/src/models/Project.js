import { VISIBILITY } from '../constants/index.js';
import mongoose from 'mongoose';
import { ref, options } from './_shared.js';
const { Schema, model } = mongoose;
const project = new Schema({ title: { type: String, required: true }, description: { type: String, default: '' }, visibility: { type: String, enum: VISIBILITY, default: 'private' }, owner: ref('User'), folders: [ref('Folder', false)], version: { type: Number, default: 0 }, archived: { type: Boolean, default: false } }, options);
project.index({ owner: 1, updatedAt: -1 }); project.index({ folders: 1 });
export const Project = model('Project', project);
