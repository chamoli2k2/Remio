import mongoose from 'mongoose';
import { ref, options } from './_shared.js';
const { Schema, model } = mongoose;
// One row per signed-in device. The refresh token rotates on every use; the last few hashes are kept
// so a replayed old token can be recognised as theft and the whole device signed out.
const refreshToken = new Schema({ tokenHash: { type: String, required: true, unique: true }, previousHashes: { type: [String], default: [], index: true }, rotatedAt: { type: Date, default: null }, user: ref('User'), expiresAt: { type: Date, required: true, expires: 0 } }, options);
export const RefreshToken = model('RefreshToken', refreshToken);
