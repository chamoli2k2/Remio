import { REPORT_REASONS, REPORT_STATUSES } from '../constants/index.js';
import mongoose from 'mongoose';
import { ref, options } from './_shared.js';
const { Schema, model } = mongoose;
/**
 * A notice that something published here should not be.
 *
 * The Digital Services Act requires a hosting service to let anyone flag content they believe is
 * illegal, to act on it, and to tell the person who reported it what happened. That obligation
 * does not wait for the platform to be large, so this exists from the start.
 *
 * `reporter` is optional on purpose. Public folders can be read without an account, so the person
 * best placed to notice a problem may not have one, and requiring them to register first would
 * put a barrier in front of the report. An address is asked for instead so the outcome can be
 * sent back, and that too is optional.
 */
const contentReport = new Schema({
  folder: ref('Folder'),
  reporter: ref('User', false),
  email: { type: String, default: '' },
  reason: { type: String, enum: REPORT_REASONS, required: true },
  detail: { type: String, default: '' },
  status: { type: String, enum: REPORT_STATUSES, default: 'open' },
  // What was decided and why, kept because a decision a reviewer cannot explain later is not a
  // decision anyone can appeal against.
  outcome: { type: String, default: '' },
  reviewedBy: ref('User', false),
  reviewedAt: { type: Date, default: null },
}, options);
// The queue is read newest-first, and a folder's own history is read when judging a repeat report.
contentReport.index({ status: 1, createdAt: -1 });
contentReport.index({ folder: 1, createdAt: -1 });
export const ContentReport = model('ContentReport', contentReport);
