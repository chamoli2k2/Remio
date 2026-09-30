import { User, Relationship, Folder } from '../models/index.js';
import { presentFolders } from './folderService.js';
import { notify } from './notificationService.js';
import { assert } from '../utils/errors.js';

const publicUser = u => ({ id: u.id, username: u.username, name: u.name, bio: u.bio || '', followers: u.followers || 0, following: u.following || 0, friends: u.friends || 0 });
const escapeRe = q => String(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Derive viewer buttons from at most three relationship rows. Pure, with no database access. */
export function flagsFromRows(me, them, rows) {
  const mine = String(me), theirs = String(them);
  const following = rows.some(r => r.kind === 'follow' && String(r.from) === mine && String(r.to) === theirs && r.status === 'active');
  const connect = rows.find(r => r.kind === 'connect');
  let friendship = 'none';
  if (connect?.status === 'active') friendship = 'friends';
  else if (connect?.status === 'pending' && String(connect.from) === mine) friendship = 'outgoing';
  else if (connect?.status === 'pending' && String(connect.to) === mine) friendship = 'incoming';
  return { following, friendship };
}

export async function relationFlags(me, them) {
  if (!me || String(me) === String(them)) return { following: false, friendship: 'self' };
  const rows = await Relationship.find({ $or: [{ from: me, to: them }, { from: them, to: me, kind: 'connect' }] }).select('from to kind status').lean();
  return flagsFromRows(me, them, rows);
}

export async function searchUsers(q, me) {
  const query = String(q || '').trim().slice(0, 24);
  if (query.length < 2) return [];
  const rx = new RegExp(`^${escapeRe(query)}`, 'i');
  const users = await User.find({ $or: [{ username: rx }, { name: rx }] }).select('name username').limit(8);
  return users.filter(u => !me || u.id !== String(me)).map(u => ({ id: u.id, username: u.username, name: u.name }));
}

export async function publicProfile(username, viewer) {
  const user = await User.findOne({ username: String(username).toLowerCase() }).select('name username bio followers following friends');
  assert(user, 404, 'User not found.');
  const folders = await Folder.find({ owner: user.id, visibility: 'global', archived: false }).sort({ updatedAt: -1 }).limit(50);
  const [relation, presented] = await Promise.all([
    relationFlags(viewer?.id, user.id),
    presentFolders(folders, viewer),
  ]);
  return { profile: { ...publicUser(user), relation }, folders: presented };
}

async function loadTarget(username) {
  const user = await User.findOne({ username: String(username).toLowerCase() });
  assert(user, 404, 'User not found.');
  return user;
}

export async function follow(me, username, on) {
  const them = await loadTarget(username);
  assert(them.id !== String(me.id), 400, 'You cannot follow yourself.');
  if (on) {
    try { await Relationship.create({ from: me.id, to: them.id, kind: 'follow', status: 'active' }); }
    catch (e) { if (e.code !== 11000) throw e; return relationFlags(me.id, them.id); }
    await Promise.all([User.updateOne({ _id: them.id }, { $inc: { followers: 1 } }), User.updateOne({ _id: me.id }, { $inc: { following: 1 } })]);
    await notify(them.id, 'follow', { actor: me });
  } else {
    const del = await Relationship.deleteOne({ from: me.id, to: them.id, kind: 'follow' });
    if (del.deletedCount) await Promise.all([User.updateOne({ _id: them.id, followers: { $gt: 0 } }, { $inc: { followers: -1 } }), User.updateOne({ _id: me.id, following: { $gt: 0 } }, { $inc: { following: -1 } })]);
  }
  return relationFlags(me.id, them.id);
}

export async function connect(me, username) {
  const them = await loadTarget(username);
  assert(them.id !== String(me.id), 400, 'You cannot connect with yourself.');
  const incoming = await Relationship.findOne({ from: them.id, to: me.id, kind: 'connect' });
  if (incoming?.status === 'pending') return accept(me, username);
  if (incoming?.status === 'active') return { following: (await relationFlags(me.id, them.id)).following, friendship: 'friends' };
  try { await Relationship.create({ from: me.id, to: them.id, kind: 'connect', status: 'pending' }); await notify(them.id, 'connect.request', { actor: me }); }
  catch (e) {
    if (e.code !== 11000) throw e;
    const existing = await Relationship.findOne({ from: me.id, to: them.id, kind: 'connect' });
    if (existing?.status === 'active') return { ...(await relationFlags(me.id, them.id)), friendship: 'friends' };
  }
  return relationFlags(me.id, them.id);
}

export async function accept(me, username) {
  const them = await loadTarget(username);
  const row = await Relationship.findOneAndUpdate({ from: them.id, to: me.id, kind: 'connect', status: 'pending' }, { $set: { status: 'active' } });
  assert(row, 404, 'No pending request from that user.');
  await Promise.all([User.updateOne({ _id: me.id }, { $inc: { friends: 1 } }), User.updateOne({ _id: them.id }, { $inc: { friends: 1 } })]);
  await notify(them.id, 'connect.accepted', { actor: me });
  return relationFlags(me.id, them.id);
}

export async function decline(me, username) {
  const them = await loadTarget(username);
  await Relationship.deleteOne({ from: them.id, to: me.id, kind: 'connect', status: 'pending' });
  return relationFlags(me.id, them.id);
}

export async function unfriend(me, username) {
  const them = await loadTarget(username);
  const del = await Relationship.deleteOne({ kind: 'connect', status: 'active', $or: [{ from: me.id, to: them.id }, { from: them.id, to: me.id }] });
  if (del.deletedCount) await Promise.all([User.updateOne({ _id: me.id, friends: { $gt: 0 } }, { $inc: { friends: -1 } }), User.updateOne({ _id: them.id, friends: { $gt: 0 } }, { $inc: { friends: -1 } })]);
  return relationFlags(me.id, them.id);
}

const peopleOf = async ids => {
  const users = await User.find({ _id: { $in: ids } }).select('name username');
  const map = new Map(users.map(u => [u.id, { id: u.id, username: u.username, name: u.name }]));
  return ids.map(id => map.get(String(id))).filter(Boolean);
};

export async function listFriends(me) {
  const rows = await Promise.all([
    Relationship.find({ from: me.id, kind: 'connect', status: 'active' }).select('to').limit(50).lean(),
    Relationship.find({ to: me.id, kind: 'connect', status: 'active' }).select('from').limit(50).lean(),
  ]);
  return peopleOf([...rows[0].map(r => r.to), ...rows[1].map(r => r.from)]);
}

export async function listRequests(me) {
  const rows = await Relationship.find({ to: me.id, kind: 'connect', status: 'pending' }).select('from').limit(50).lean();
  return peopleOf(rows.map(r => r.from));
}
