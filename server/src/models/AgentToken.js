import { AGENT_TOKEN_ORIGINS } from '../constants/index.js';
import mongoose from 'mongoose';
import { ref, options } from './_shared.js';
const { Schema, model } = mongoose;
/**
 * One assistant's standing permission to act for one user.
 *
 * A grant, not a token: the row is the thing a person revokes, and the secrets hanging off it are
 * implementation. That distinction is what lets the settings page list "Claude — added in March,
 * last used an hour ago" rather than a pile of opaque credentials, and it means rotating a token
 * during a refresh does not look to the user like anything happened.
 *
 * Both secrets are stored only as SHA-256, the same way sessions and team join codes are, so the
 * database cannot hand anyone a working credential. `accessExpiresAt` is deliberately not a Mongo
 * TTL: an expired grant still has to be listed, and still has to be revocable, and a row that
 * deletes itself would take its own audit trail with it.
 */
const agentToken = new Schema({
  user: ref('User'),
  // What the user sees in the list. Their own words for a personal token, the client's self-declared
  // name for one issued through OAuth — which is why it is never trusted as anything but a label.
  name: { type: String, default: '' },
  scopes: { type: [String], default: [] },
  accessHash: { type: String },
  accessExpiresAt: { type: Date },
  // Absent on a personal token. Refresh exists for OAuth clients, which expect to hold a
  // long-running connection without asking the user again.
  refreshHash: { type: String },
  client: { type: String, default: '' },
  createdVia: { type: String, enum: AGENT_TOKEN_ORIGINS, default: 'personal' },
  lastUsedAt: { type: Date, default: null },
  revokedAt: { type: Date, default: null },
}, options);
// Sparse because a rotated grant briefly has no access secret, and a personal one never has a
// refresh secret — and a present-but-null field is indexed like any other value, so every such row
// would collide on the same key.
agentToken.index({ accessHash: 1 }, { unique: true, sparse: true });
agentToken.index({ refreshHash: 1 }, { unique: true, sparse: true });
agentToken.index({ user: 1, createdAt: -1 });
export const AgentToken = model('AgentToken', agentToken);
