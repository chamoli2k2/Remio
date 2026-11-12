import { EMAIL_CODE_PURPOSES } from '../constants/index.js';
import mongoose from 'mongoose';
import { ref, options } from './_shared.js';
const { Schema, model } = mongoose;
// A six-digit code mailed to an address, to prove its owner is at the keyboard: when an account is made
// and when one is deleted. One row per address and purpose, so asking again replaces the last code.
const emailCode = new Schema({ email: { type: String, required: true, lowercase: true }, purpose: { type: String, enum: EMAIL_CODE_PURPOSES, required: true }, user: ref('User', false), codeHash: { type: String, required: true }, attempts: { type: Number, default: 0 }, sentAt: { type: Date, default: Date.now }, windowStart: { type: Date, default: Date.now }, sends: { type: Number, default: 1 }, expiresAt: { type: Date, required: true, expires: 0 } }, options);
emailCode.index({ email: 1, purpose: 1 }, { unique: true });
export const EmailCode = model('EmailCode', emailCode);
