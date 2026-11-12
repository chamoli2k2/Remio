import mongoose from 'mongoose';
import { ref, options } from './_shared.js';
const { Schema, model } = mongoose;
// Every change to configuration, kept whether or not anything went wrong. Editable settings without
// a record of who moved them is a liability the first time a number looks wrong at midnight.
const auditEntry = new Schema({ actor: ref('User', false), actorName: { type: String, default: '' }, action: { type: String, required: true }, target: { type: String, default: '' }, before: Schema.Types.Mixed, after: Schema.Types.Mixed, note: { type: String, default: '' } }, options);
auditEntry.index({ createdAt: -1 }); auditEntry.index({ target: 1, createdAt: -1 });
export const AuditEntry = model('AuditEntry', auditEntry);
