import { AUTH_TOKEN_PURPOSES } from '../constants/index.js';
import mongoose from 'mongoose';
import { ref, options } from './_shared.js';
const { Schema, model } = mongoose;
// Emailed links are bearer credentials, so only the hash is stored and `expires: 0` lets Mongo
// retire them on its own. `purpose` keeps one collection usable for password resets later.
const authToken = new Schema({ tokenHash: { type: String, required: true, unique: true }, user: ref('User'), purpose: { type: String, enum: AUTH_TOKEN_PURPOSES, required: true }, expiresAt: { type: Date, required: true, expires: 0 }, usedAt: { type: Date, default: null } }, options);
authToken.index({ user: 1, purpose: 1 });
export const AuthToken = model('AuthToken', authToken);
