import mongoose from 'mongoose';
const { Schema, model } = mongoose;
/**
 * Whole documents by string key, used only when object storage is not configured. The same shape
 * as a bucket object or a key–value table row, so it has no relationship to anything else here.
 */
const blob = new Schema({ _id: { type: String }, body: { type: Buffer, required: true }, contentType: { type: String, default: 'application/json' }, bytes: { type: Number, default: 0 } }, { timestamps: true });
export const Blob = model('Blob', blob);
