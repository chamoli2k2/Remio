import mongoose from 'mongoose';
import { ref, options } from './_shared.js';
const { Schema, model } = mongoose;
const note = new Schema({ notebook: ref('Notebook'), title: { type: String, default: '' }, body: { type: String, default: '' }, tags: [String], pinned: { type: Boolean, default: false }, version: { type: Number, default: 0 }, createdBy: ref('User'), updatedBy: ref('User'), clientId: { type: String, select: false } }, options);
note.index({ notebook: 1, createdBy: 1, clientId: 1 }, { unique: true, partialFilterExpression: { clientId: { $type: 'string' } } });
note.index({ notebook: 1, pinned: -1, updatedAt: -1 });
export const Note = model('Note', note);
