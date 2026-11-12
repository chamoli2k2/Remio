import mongoose from 'mongoose';
import { ref, options } from './_shared.js';
const { Schema, model } = mongoose;
// A stored setting is an override, not a value: only keys an operator has actually changed live
// here, and everything else falls back to the declaration in shared/settings.js. Which means an
// empty collection is a valid, working configuration, and deleting a row is how you undo.
const setting = new Schema({ key: { type: String, required: true, unique: true }, value: Schema.Types.Mixed, updatedBy: ref('User', false) }, options);
export const Setting = model('Setting', setting);
