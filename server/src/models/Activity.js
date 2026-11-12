import mongoose from 'mongoose';
import { ref, options } from './_shared.js';
const { Schema, model } = mongoose;
const activity = new Schema({ folder: ref('Folder'), actor: ref('User'), action: String, detail: String }, options);
activity.index({ folder: 1, createdAt: -1 });
export const Activity = model('Activity', activity);
