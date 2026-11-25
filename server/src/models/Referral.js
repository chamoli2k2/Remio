import mongoose from 'mongoose';
import { ref, options } from './_shared.js';
import { REFERRAL_STATUSES } from '../constants/index.js';
const { Schema, model } = mongoose;

/**
 * One row per invited person. `referee` is unique because somebody can only ever have been invited
 * once, and the reward fields record what was actually paid so a later change to the programme never
 * rewrites history.
 */
const referral = new Schema({
  referrer: ref('User'),
  referee: ref('User'),
  code: { type: String, required: true },
  status: { type: String, enum: REFERRAL_STATUSES, default: 'joined' },
  activeDays: { type: Number, default: 0 },
  qualifiedAt: { type: Date, default: null },
  refereeRewardDays: { type: Number, default: 0 },
  referrerRewardDays: { type: Number, default: 0 },
}, options);
referral.index({ referee: 1 }, { unique: true });
referral.index({ referrer: 1, createdAt: -1 });
export const Referral = model('Referral', referral);
