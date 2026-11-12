import mongoose from 'mongoose';
import { ref, options, members } from './_shared.js';
const { Schema, model } = mongoose;
/**
 * A collection of notebooks, shown as "Collection" on the Notes tab. Sharing one shares every
 * notebook in it; a notebook inside is always owned by the collection's owner, so deleting either
 * the collection or that account takes everything inside with it.
 */
const noteCollection = new Schema({ title: { type: String, required: true }, description: { type: String, default: '' }, color: { type: String, default: 'violet' }, icon: { type: String, default: 'layers' }, owner: ref('User'), members: members(), version: { type: Number, default: 0 } }, options);
noteCollection.index({ owner: 1, updatedAt: -1 }); noteCollection.index({ 'members.user': 1 });
export const NoteCollection = model('NoteCollection', noteCollection);
