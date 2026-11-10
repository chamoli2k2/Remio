import bcrypt from 'bcryptjs';
import { User } from '../models/index.js';
import { clearAuthCookies, deliverTokens, refreshTokenOf, wantsTokens } from '../middleware/auth.js';
import { issueTokens, rotateRefresh, revokeRefresh } from '../services/auth/jwt.js';
import { BRAND } from '../../../shared/brand.js';
import { AppError, assert } from '../utils/errors.js';
import { publicProfile as loadProfile, searchUsers } from '../services/socialService.js';
import * as account from '../services/accountService.js';
import { signInWithGoogle, freeUsername } from '../services/auth/googleSignIn.js';
import { countryNameFor } from '../services/geo.js';
import { reservedUsername } from '../middleware/validate.js';
import { codesRequired, issueCode, assertSent, checkCode, spendCode } from '../services/emailCodeService.js';

/**
 * The signed-in person as they see themselves: their address, and whether a password exists.
 *
 * The flag is what lets Settings offer "set a password" to someone who has only used Google,
 * instead of asking them for a current password they never had. The hash itself never leaves.
 */
async function self(id) {
  const user = await User.findById(id).select('+email +passwordHash');
  if (!user) return null;
  const { passwordHash, ...rest } = user.toJSON();
  return { ...rest, hasPassword: !!passwordHash };
}
const signIn = async (req, res, userId) => deliverTokens(req, res, await issueTokens(userId));
/**
 * The acceptance is stored as a time and a version, not a boolean.
 * "They ticked a box" is worth very little a year later; "they accepted the terms published on
 * this date, at this moment" is the thing you would actually want to be able to show.
 */
export const signup = async (req, res) => {
  const { password, acceptedTerms, emailCode, ...body } = req.body;
  // An account is only made for an address its owner has just proven they can read. The code is
  // checked first and spent last, so a taken username does not cost them the code.
  const proof = codesRequired() ? await checkCode(body.email, 'signup', emailCode) : null;
  if (!body.username) body.username = await freeUsername(body.email);
  const user = await User.create({ ...body, termsAcceptedAt: new Date(), termsVersion: BRAND.policyUpdated, passwordHash: await bcrypt.hash(password, 12), ...(proof ? { emailVerifiedAt: new Date() } : {}), ...(process.env.NODE_ENV === 'test' ? { account: 'premium' } : {}) });
  if (proof) await spendCode(proof); else account.sendVerification(user).catch(() => {});
  const session = await signIn(req, res, user.id);
  res.status(201).json({ user: await self(user.id), ...session });
};
/** Step one of signing up: mail a code to the address. Nothing is created until it comes back. */
export const signupCode = async (req, res) => {
  const { email } = req.body;
  assert(!await User.exists({ email }), 409, 'There is already an account with that email. Sign in instead.', 'EMAIL_TAKEN');
  assertSent(await issueCode(email, 'signup'));
  res.json({ ok: true, expiresInMinutes: 10 });
};
/**
 * The one endpoint behind both Google buttons. Which of sign-in, linking, or sign-up it performs
 * is decided by what already exists, not by which page the click came from — the page only
 * decides whether the country and consent are sent with it.
 */
export const google = async (req, res) => {
  const { user, created } = await signInWithGoogle(req.body, { detectCountry: () => countryNameFor(req) });
  const session = await signIn(req, res, user.id);
  res.status(created ? 201 : 200).json({ user: await self(user.id), created, ...session });
};
export const login = async (req, res) => { const identifier = String(req.body.identifier).toLowerCase().trim(); const user = await User.findOne({ $or: [{ username: identifier }, { email: identifier }] }).select('+passwordHash'); assert(user?.passwordHash && await bcrypt.compare(req.body.password, user.passwordHash), 401, 'Username or password is incorrect.'); res.json({ user: await self(user.id), ...await signIn(req, res, user.id) }); };
/**
 * Exchanges the refresh token for a new pair. A token that buys nothing clears the cookies, so the
 * browser stops presenting a dead one and the client's retry goes out as a signed-out visitor.
 */
export const refresh = async (req, res) => {
  const raw = refreshTokenOf(req);
  const issued = raw ? await rotateRefresh(raw) : null;
  if (!issued) {
    if (!wantsTokens(req)) clearAuthCookies(res);
    throw new AppError(401, 'Your sign-in has ended. Please sign in again.', 'REFRESH_INVALID');
  }
  res.json(deliverTokens(req, res, issued));
};
export const logout = async (req, res) => { await revokeRefresh(refreshTokenOf(req)); clearAuthCookies(res); res.json({ ok: true }); };
/**
 * Includes the address, which `select: false` hides everywhere else. Only ever your own, and it
 * saves asking people to retype something we already know at checkout and in Settings.
 */
export const me = async (req, res) => res.json({ user: req.user ? await self(req.user.id) : null, ...(req.auth ? { auth: { accessExpiresAt: new Date(req.auth.exp * 1000).toISOString() } } : {}) });
/**
 * A username change is checked here rather than left to the unique index, so a taken name gets a
 * sentence instead of a duplicate-key error, and a reserved one is refused the same way it is at
 * signup. Old profile links stop working, which is the honest consequence of renaming.
 */
export const profile = async (req, res) => {
  const { username, ...rest } = req.body;
  const update = { ...rest };
  if (username && username !== req.user.username) {
    assert(!reservedUsername(username), 400, 'That username is reserved. Please pick another.', 'USERNAME_RESERVED');
    assert(!await User.exists({ username, _id: { $ne: req.user.id } }), 409, 'That username is taken. Try another.', 'USERNAME_TAKEN');
    update.username = username;
  }
  await User.updateOne({ _id: req.user.id }, { $set: update });
  res.json({ user: await self(req.user.id) });
};
export const publicProfile = async (req, res) => res.json(await loadProfile(req.params.username, req.user));
export const searchPeople = async (req, res) => res.json({ users: await searchUsers(req.query.q, req.user?.id) });

export const resendVerification = async (req, res) => res.json(await account.sendVerification(req.user, { force: false }));
export const verifyEmail = async (req, res) => {
  const user = await account.confirmVerification(req.body.token);
  const mine = user && req.user?.id === user.id;
  // Their access token still says unverified, so replace it now rather than on the next request.
  res.json({ user: mine ? await self(user.id) : user, ...(mine ? deliverTokens(req, res, await issueTokens(user.id, { withRefresh: false })) : {}) });
};
/** Every other device is signed out, and this one is handed an access token at the new version. */
export const changePassword = async (req, res) => {
  const result = await account.changePassword(req.user, req.body, refreshTokenOf(req));
  res.json({ ...result, ...deliverTokens(req, res, await issueTokens(req.user.id, { withRefresh: false })) });
};
// The answer is the same whether or not the address is on file, so nobody can use this to find out
// who has an account. What actually happened is only ever said in the email itself.
export const forgotPassword = async (req, res) => { await account.sendPasswordReset(req.body.email); res.json({ ok: true }); };
export const resetPassword = async (req, res) => {
  const result = await account.resetPassword(req.body);
  // This device's tokens were among those just revoked, so clear them rather than leave dead ones.
  clearAuthCookies(res);
  res.json(result);
};
export const deleteAccount = async (req, res) => {
  const result = await account.deleteAccount(req.user, req.body);
  clearAuthCookies(res);
  res.json(result);
};
export const deleteAccountCode = async (req, res) => res.json(await account.sendDeleteCodeToSelf(req.user));
export const deleteCodeForAddress = async (req, res) => res.json(await account.sendDeleteCodeToAddress(req.body.email));
export const deleteByCode = async (req, res) => {
  const result = await account.deleteAccountByCode(req.body);
  clearAuthCookies(res);
  res.json(result);
};
