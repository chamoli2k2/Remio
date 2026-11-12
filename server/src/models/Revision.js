import mongoose from 'mongoose';
import { ref, options } from './_shared.js';
const { Schema, model } = mongoose;
const revision = new Schema({ card: ref('Card'), folder: ref('Folder'), editor: ref('User'), version: Number, snapshot: Schema.Types.Mixed }, options);
revision.index({ card: 1, version: 1 }, { unique: true });
export const Revision = model('Revision', revision);
