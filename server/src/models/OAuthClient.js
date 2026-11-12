import mongoose from 'mongoose';
import { options } from './_shared.js';
const { Schema, model } = mongoose;
/**
 * An OAuth client that registered itself.
 *
 * Nobody pre-configures these. The assistant discovers this server, registers under RFC 7591, and
 * gets back an id it uses from then on — which is the whole reason a user can paste one URL into
 * their assistant and be done. It also means anyone can create a row here, so a client record is
 * treated as an untrusted claim: the name is shown to the user as "an application calling itself
 * X", and the redirect URIs are the only field that is security-relevant, matched exactly.
 */
const oauthClient = new Schema({
  clientId: { type: String, required: true, unique: true },
  // Absent for a public client, which is the normal case: a desktop assistant cannot keep a secret,
  // which is exactly why PKCE exists and why it is required here whether or not a secret is set.
  secretHash: { type: String },
  name: { type: String, default: '' },
  uri: { type: String, default: '' },
  redirectUris: { type: [String], default: [] },
}, options);
export const OAuthClient = model('OAuthClient', oauthClient);
