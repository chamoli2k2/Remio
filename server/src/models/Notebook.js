import mongoose from 'mongoose';
import { ref, options, members } from './_shared.js';
const { Schema, model } = mongoose;
const notebook = new Schema({ title: { type: String, required: true }, description: { type: String, default: '' }, color: { type: String, default: 'violet' }, icon: { type: String, default: 'book' }, owner: ref('User'), noteCollection: ref('NoteCollection', false), members: members(), version: { type: Number, default: 0 }, archived: { type: Boolean, default: false } }, options);
notebook.index({ owner: 1, updatedAt: -1 }); notebook.index({ 'members.user': 1 }); notebook.index({ noteCollection: 1, updatedAt: -1 });
export const Notebook = model('Notebook', notebook);
