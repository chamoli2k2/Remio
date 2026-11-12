import { MEMBER_ROLES } from '../constants/index.js';
import mongoose from 'mongoose';
const { Schema } = mongoose;

/** A reference to another model, by name, so model files never import each other. */
export const ref = (name, required = true) => ({ type: Schema.Types.ObjectId, ref: name, required });

/** Options every schema shares: timestamps, and JSON that exposes `id` and hides storage internals. */
export const options = { timestamps: true, toJSON: { transform: (_doc, ret) => { ret.id = ret._id.toString(); delete ret._id; delete ret.__v; delete ret.clientId; return ret; } } };

/**
 * Notes live apart from flashcard collections on purpose: nothing that lists, studies, publishes
 * or counts collections can pick a notebook up by accident, because it is not one. Sharing works
 * the same way — an owner and members with viewer or editor roles — and is free.
 */
export const members = () => [{ user: ref('User'), role: { type: String, enum: MEMBER_ROLES, required: true }, _id: false }];
