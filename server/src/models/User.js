import { ACCOUNT_TYPES } from '../constants/index.js';
import mongoose from 'mongoose';
import { COUNTRY_NAMES, HOME_COUNTRY } from '../../../shared/countries.js';
import { ref, options } from './_shared.js';
const { Schema, model } = mongoose;
/**
 * How a person likes an assistant to write their answers; see shared/answerStyle.js. Every field is
 * optional, and an unset one falls through to the default. Kept on the account, with an optional
 * override per collection, rather than on the collection itself: it is one person's preference,
 * and a collaborator on the same collection may want something else.
 */
const answerStyle = new Schema({ detail: String, format: String, include: { type: [String], default: undefined }, audience: String, custom: String }, { _id: false });
const user = new Schema({ answerStyle: { type: answerStyle, default: undefined, select: false }, collectionStyles: { type: [{ folder: ref('Folder'), style: answerStyle, _id: false }], default: undefined, select: false }, username: { type: String, required: true, unique: true, lowercase: true }, email: { type: String, required: true, unique: true, lowercase: true, select: false }, emailVerifiedAt: { type: Date, default: null }, passwordHash: { type: String, select: false }, googleId: { type: String, select: false }, name: { type: String, required: true }, bio: { type: String, default: '' }, country: { type: String, enum: COUNTRY_NAMES, default: HOME_COUNTRY }, dailyGoal: { type: Number, default: 20 }, desiredRetention: { type: Number, default: 0.9, min: 0.7, max: 0.97 }, termsAcceptedAt: { type: Date, default: null }, termsVersion: { type: String, default: '' }, tokenVersion: { type: Number, default: 0, select: false }, account: { type: String, enum: ACCOUNT_TYPES, default: 'normal' }, premiumPlan: { type: String, default: '' }, premiumExpiresAt: { type: Date, default: null }, savedFolders: [ref('Folder')], followers: { type: Number, default: 0 }, following: { type: Number, default: 0 }, friends: { type: Number, default: 0 } }, options);
// Sparse and unique: one Google account can only ever be one account here.
user.index({ googleId: 1 }, { unique: true, sparse: true });
export const User = model('User', user);
