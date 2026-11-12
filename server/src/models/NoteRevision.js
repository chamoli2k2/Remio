import { NOTE_REVISION_SOURCES } from '../constants/index.js';
import mongoose from 'mongoose';
import { ref, options } from './_shared.js';
const { Schema, model } = mongoose;
/**
 * What a page said before a change, so a bad edit, a bad autosave or an assistant's rewrite can be
 * undone by the person. Kept to the last few per page (see noteService) so history is bounded.
 */
const noteRevision = new Schema({ note: ref('Note'), notebook: ref('Notebook'), title: { type: String, default: '' }, body: { type: String, default: '' }, tags: [String], version: { type: Number, default: 0 }, by: ref('User', false), via: { type: String, enum: NOTE_REVISION_SOURCES, default: 'app' }, byName: { type: String, default: '' } }, options);
noteRevision.index({ note: 1, createdAt: -1 });
noteRevision.index({ notebook: 1 });
export const NoteRevision = model('NoteRevision', noteRevision);
