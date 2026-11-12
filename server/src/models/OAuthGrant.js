import mongoose from 'mongoose';
import { ref, options } from './_shared.js';
const { Schema, model } = mongoose;
/**
 * An authorization code in flight, and the PKCE challenge that binds it to whoever asked.
 *
 * Short-lived and single-use. `expires: 0` retires them without a sweeper, and `usedAt` is what
 * makes a replay detectable in the window before Mongo gets round to it — the code is marked used
 * in the same conditional update that redeems it, so two simultaneous redemptions cannot both win.
 */
const oauthGrant = new Schema({
  codeHash: { type: String, required: true, unique: true },
  clientId: { type: String, required: true },
  user: ref('User'),
  redirectUri: { type: String, required: true },
  codeChallenge: { type: String, required: true },
  scopes: { type: [String], default: [] },
  // RFC 8707. Recorded at authorization and stamped into the grant, so a code minted for this
  // server cannot be redeemed to reach a different one.
  resource: { type: String, default: '' },
  expiresAt: { type: Date, required: true, expires: 0 },
  usedAt: { type: Date, default: null },
}, options);
export const OAuthGrant = model('OAuthGrant', oauthGrant);
