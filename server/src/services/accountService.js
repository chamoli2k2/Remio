import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import {
  User, Session, AuthToken, Folder, Card, Media, Progress, Review, Activity, Revision,
  CardDoc, Relationship, Project, PremiumOrder, Notification, Team, TeamMember, TeamInvite, Assignment,
} from '../models/index.js';
import { assert } from '../utils/errors.js';
import { hashToken } from '../middleware/auth.js';
import { send, verificationEmail, passwordResetEmail, passwordChangedEmail, accountDeletedEmail } from './mailService.js';
import { publicOrigin } from '../utils/origin.js';

const VERIFY_TTL_MS = 24 * 60 * 60 * 1000;
/** A reset link hands out an account, so it is worth far less time than a confirmation link. */
const RESET_TTL_MS = 60 * 60 * 1000;
/** Resending is rate limited at the route; this stops a second link being minted needlessly. */
const RESEND_GAP_MS = 60 * 1000;

const origin = publicOrigin;

/**
 * Issues a fresh verification link and emails it. Previous unused links for the address are
 * dropped, so the most recent email is always the one that works.
 */
export async function sendVerification(user, { force = false } = {}) {
  if (user.emailVerifiedAt) return { sent: false, reason: 'already-verified' };

  const recent = await AuthToken.findOne({ user: user.id, purpose: 'verify-email', usedAt: null }).sort({ createdAt: -1 });
  if (!force && recent && Date.now() - recent.createdAt.getTime() < RESEND_GAP_MS) {
    return { sent: false, reason: 'too-soon' };
  }

  await AuthToken.deleteMany({ user: user.id, purpose: 'verify-email' });
  const token = crypto.randomBytes(32).toString('hex');
  await AuthToken.create({
    tokenHash: hashToken(token), user: user.id, purpose: 'verify-email',
    expiresAt: new Date(Date.now() + VERIFY_TTL_MS),
  });

  // The address lives behind `select: false`, so it is only read where it is actually needed.
  const withEmail = await User.findById(user.id).select('+email');
  const url = `${origin()}/verify-email?token=${token}`;
  const sent = await send({ to: withEmail.email, ...verificationEmail({ name: user.name, url }) });
  return { sent, reason: sent ? 'sent' : 'mail-unavailable' };
}

/** Consumes a link. The token is spent on first use, but saying so again is not an error. */
export async function confirmVerification(token) {
  assert(typeof token === 'string' && token.length === 64, 400, 'That confirmation link is not valid.');
  const row = await AuthToken.findOne({ tokenHash: hashToken(token), purpose: 'verify-email' });
  assert(row, 400, 'That confirmation link is not valid. Send yourself a new one from Settings.');

  const user = await User.findById(row.user);
  assert(user, 404, 'That account no longer exists.');
  // Links get clicked twice, reloaded, and prefetched by mail scanners. Once the address is
  // confirmed there is nothing left to do, so repeating the answer beats showing a failure.
  if (user.emailVerifiedAt) return user;
  assert(row.expiresAt > new Date(), 400, 'That confirmation link has expired. Send yourself a new one from Settings.');

  row.usedAt = new Date();
  await row.save();
  return User.findByIdAndUpdate(row.user, { $set: { emailVerifiedAt: new Date() } }, { new: true });
}

/**
 * Emails a reset link. The caller is told nothing about whether the address belongs to anybody,
 * because this route is unauthenticated and would otherwise be a way to test whether someone has
 * an account here.
 */
export async function sendPasswordReset(email) {
  const user = await User.findOne({ email: String(email).toLowerCase().trim() }).select('+email');
  if (!user) return { sent: false, reason: 'no-account' };

  await AuthToken.deleteMany({ user: user.id, purpose: 'reset-password' });
  const token = crypto.randomBytes(32).toString('hex');
  await AuthToken.create({
    tokenHash: hashToken(token), user: user.id, purpose: 'reset-password',
    expiresAt: new Date(Date.now() + RESET_TTL_MS),
  });

  const url = `${origin()}/reset-password?token=${token}`;
  const sent = await send({ to: user.email, ...passwordResetEmail({ name: user.name, url }) });
  return { sent, reason: sent ? 'sent' : 'mail-unavailable' };
}

/**
 * Spends a reset link and sets the new password. Every session goes, including the one belonging to
 * whoever pushed the real owner out, and the address is marked confirmed: reading the link is proof
 * they hold the mailbox.
 *
 * Unlike a deliberate change, this does not refuse a password the account is already using. The
 * person here has forgotten it, and refusing would quietly confirm a guess to a stranger.
 */
export async function resetPassword({ token, newPassword }) {
  const invalid = 'That reset link is not valid any more. Ask for a new one and use the most recent email.';
  const row = await AuthToken.findOne({ tokenHash: hashToken(token), purpose: 'reset-password' });
  assert(row && !row.usedAt && row.expiresAt > new Date(), 400, invalid);

  const user = await User.findById(row.user).select('+passwordHash +email');
  assert(user, 400, invalid);

  user.passwordHash = await bcrypt.hash(newPassword, 12);
  if (!user.emailVerifiedAt) user.emailVerifiedAt = new Date();
  await user.save();

  await Session.deleteMany({ user: user.id });
  await AuthToken.deleteMany({ user: user.id });

  await send({ to: user.email, ...passwordChangedEmail({ name: user.name }) });
  return { reset: true };
}

/**
 * Changing a password proves the current one first, then drops every other session. An attacker who
 * already has a stolen cookie loses it the moment the real owner changes their password.
 */
export async function changePassword(user, { currentPassword, newPassword }, keepSessionToken) {
  const withHash = await User.findById(user.id).select('+passwordHash +email');
  assert(withHash && await bcrypt.compare(currentPassword, withHash.passwordHash), 400, 'That is not your current password.');
  assert(!await bcrypt.compare(newPassword, withHash.passwordHash), 400, 'Choose a password you are not already using.');

  withHash.passwordHash = await bcrypt.hash(newPassword, 12);
  await withHash.save();

  const keep = keepSessionToken ? hashToken(keepSessionToken) : null;
  const { deletedCount } = await Session.deleteMany({ user: user.id, ...(keep ? { tokenHash: { $ne: keep } } : {}) });
  await AuthToken.deleteMany({ user: user.id });

  await send({ to: withHash.email, ...passwordChangedEmail({ name: user.name }) });
  return { signedOutElsewhere: deletedCount };
}

/**
 * Teams outlive their owner's account, so deleting one out from under its members would take their
 * classroom with it. The owner has to hand it over or close it first.
 */
async function blockingTeams(userId) {
  const owned = await Team.find({ owner: userId, archived: false }).select('_id name').lean();
  if (!owned.length) return [];
  const counts = await TeamMember.aggregate([
    { $match: { team: { $in: owned.map(t => t._id) } } },
    { $group: { _id: '$team', members: { $sum: 1 } } },
  ]);
  const shared = new Set(counts.filter(c => c.members > 1).map(c => String(c._id)));
  return owned.filter(t => shared.has(String(t._id))).map(t => t.name);
}

/**
 * Erases the account and everything belonging to it in one transaction, so a failure part way
 * through cannot leave a half-deleted user behind.
 *
 * Payment orders are the deliberate exception. They are proof of a transaction we have to be able
 * to produce, so the personal details on them are overwritten rather than the row being dropped.
 */
export async function deleteAccount(user, { password }) {
  const withHash = await User.findById(user.id).select('+passwordHash +email');
  assert(withHash && await bcrypt.compare(password, withHash.passwordHash), 400, 'That password is not correct.');

  const blocked = await blockingTeams(user.id);
  assert(!blocked.length, 409,
    `Hand over or close ${blocked.length === 1 ? 'this classroom' : 'these classrooms'} before deleting your account, so the people in ${blocked.length === 1 ? 'it' : 'them'} do not lose their work: ${blocked.join(', ')}.`);

  const { email, name } = withHash;
  const id = user.id;

  await mongoose.connection.transaction(async session => {
    const opts = { session };
    const folders = await Folder.find({ owner: id }).select('_id').session(session).lean();
    const folderIds = folders.map(f => f._id);
    const cards = await Card.find({ folder: { $in: folderIds } }).select('_id').session(session).lean();
    const cardIds = cards.map(c => c._id);

    // Everything hanging off the folders this account owned.
    await CardDoc.deleteMany({ card: { $in: cardIds } }, opts);
    await Revision.deleteMany({ folder: { $in: folderIds } }, opts);
    await Progress.deleteMany({ card: { $in: cardIds } }, opts);
    await Card.deleteMany({ folder: { $in: folderIds } }, opts);
    await Media.deleteMany({ folder: { $in: folderIds } }, opts);
    await Activity.deleteMany({ folder: { $in: folderIds } }, opts);
    await Assignment.deleteMany({ folder: { $in: folderIds } }, opts);
    await Folder.deleteMany({ owner: id }, opts);

    // Their own study history and anything addressed to them.
    await Progress.deleteMany({ user: id }, opts);
    await Review.deleteMany({ user: id }, opts);
    await Notification.deleteMany({ $or: [{ user: id }, { actor: id }] }, opts);
    await Relationship.deleteMany({ $or: [{ from: id }, { to: id }] }, opts);
    await Project.deleteMany({ owner: id }, opts);
    await Activity.deleteMany({ actor: id }, opts);
    await Media.deleteMany({ uploadedBy: id }, opts);

    // Shared folders they were a member of stay with their owner, minus this membership.
    await Folder.updateMany({ 'members.user': id }, { $pull: { members: { user: id } } }, opts);
    // Other people may have saved a folder that is going away, so drop the dangling references.
    await User.updateMany({ savedFolders: { $in: folderIds } }, { $pull: { savedFolders: { $in: folderIds } } }, opts);

    // Teams: only solo ones reach here, so the team and its scaffolding go with the account.
    const soloTeams = await Team.find({ owner: id }).select('_id').session(session).lean();
    const soloIds = soloTeams.map(t => t._id);
    await Assignment.deleteMany({ team: { $in: soloIds } }, opts);
    await TeamInvite.deleteMany({ team: { $in: soloIds } }, opts);
    await TeamMember.deleteMany({ $or: [{ team: { $in: soloIds } }, { user: id }] }, opts);
    await Team.deleteMany({ _id: { $in: soloIds } }, opts);

    // Proof of payment survives, stripped of anything identifying.
    await PremiumOrder.updateMany({ user: id }, {
      $set: { name: 'Deleted account', email: 'deleted@invalid', phone: '', address: '', country: '' },
      $unset: { proof: '' },
    }, opts);

    await AuthToken.deleteMany({ user: id }, opts);
    await Session.deleteMany({ user: id }, opts);
    await User.deleteOne({ _id: id }, opts);
  });

  await send({ to: email, ...accountDeletedEmail({ name }) });
  return { deleted: true };
}
