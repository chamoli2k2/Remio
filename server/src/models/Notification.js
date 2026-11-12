import mongoose from 'mongoose';
import { ref, options } from './_shared.js';
const { Schema, model } = mongoose;
const notification = new Schema({ user: ref('User'), type: { type: String, required: true }, actor: ref('User', false), data: { type: Schema.Types.Mixed, default: {} }, readAt: { type: Date, default: null } }, options);
notification.index({ user: 1, createdAt: -1 }); notification.index({ user: 1, readAt: 1 });
export const Notification = model('Notification', notification);
