import mongoose from 'mongoose';
import { ref, options } from './_shared.js';
const { Schema, model } = mongoose;
// Persisted Yjs CRDT state for live co-editing. The Card document remains the authoritative, versioned text.
const cardDoc = new Schema({ card: { ...ref('Card'), unique: true }, state: { type: Buffer, required: true, select: false } }, options);
export const CardDoc = model('CardDoc', cardDoc);
