import mongoose from 'mongoose';
import { ref, options } from './_shared.js';
const { Schema, model } = mongoose;
// `drawing` is a plain string id, not a reference: the drawing lives in object storage, keyed by
// folder and this id, so nothing about it depends on this database (see shared/drawing.js).
const side = { text: { type: String, default: '' }, image: ref('Media', false), drawing: { type: String, default: null } };
const card = new Schema({ folder: ref('Folder'), front: side, back: side, tags: [String], hint: { type: String, default: '' }, source: { type: String, default: '' }, version: { type: Number, default: 0 }, createdBy: ref('User'), updatedBy: ref('User'),
  // Sent by the phone app when it creates offline, so a retry after a lost reply returns the card instead of making a second one.
  clientId: { type: String, select: false } }, options);
card.index({ folder: 1, createdBy: 1, clientId: 1 }, { unique: true, partialFilterExpression: { clientId: { $type: 'string' } } });
card.index({ folder: 1, createdAt: 1 }); card.index({ folder: 1, tags: 1 });
export const Card = model('Card', card);
