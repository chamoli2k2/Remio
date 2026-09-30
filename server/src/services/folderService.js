import { Folder, Card, User, Media, Revision, CardDoc, Progress, Review, Activity, Assignment, AgentBatch, Project } from '../models/index.js';
import * as storage from './storage.js';
import { accessFolder, mutateFolder, recordEvent, roleOf } from './accessService.js';
import { queueEvent } from '../realtime/bus.js';
import { requireFolderPremium, entitledOnFolder, teamFolderRole, teamIdsFor } from './teamAccess.js';
import { assert } from '../utils/errors.js';
const populate = [{ path: 'owner', select: 'name username' }, { path: 'members.user', select: 'name username' }, { path: 'team', select: 'name kind' }];

/**
 * Card counts, tag lists and cover widths for many folders at once.
 *
 * Presenting one folder needs three facts that live outside its own document, and asking for them
 * per folder meant a library of two hundred collections ran over four hundred queries to draw one
 * page — the classic shape where nothing looks slow in the code and the page takes seconds. These
 * are three queries whatever the number of folders.
 *
 * Tags are grouped rather than collected with `$addToSet` over the whole array field, so the
 * working set is one row per distinct tag instead of one per distinct combination of them.
 */
async function statsFor(folders) {
  const ids = folders.map(f => f._id);
  const covers = folders.map(f => f.thumbnail).filter(Boolean);
  const [counts, tags, media] = await Promise.all([
    Card.aggregate([{ $match: { folder: { $in: ids } } }, { $group: { _id: '$folder', count: { $sum: 1 } } }]),
    Card.aggregate([
      { $match: { folder: { $in: ids } } },
      { $unwind: '$tags' },
      { $group: { _id: { folder: '$folder', tag: '$tags' } } },
      { $group: { _id: '$_id.folder', tags: { $push: '$_id.tag' } } },
    ]),
    covers.length ? Media.find({ _id: { $in: covers } }).select('width').lean() : [],
  ]);
  const byId = new Map(counts.map(r => [String(r._id), { count: r.count, tags: [] }]));
  for (const row of tags) {
    const entry = byId.get(String(row._id)) || { count: 0, tags: [] };
    entry.tags = row.tags.slice(0, 10);
    byId.set(String(row._id), entry);
  }
  const widths = new Map(media.map(m => [String(m._id), m.width || 0]));
  return { stat: id => byId.get(String(id)) || { count: 0, tags: [] }, coverWidth: id => widths.get(String(id)) || 0 };
}

/**
 * `stats` lets a caller presenting a whole list hand over facts it has already gathered in bulk.
 * Left out — presenting a single folder — this looks them up for the one.
 */
export async function presentFolder(folder, user, stats) {
  await folder.populate(populate);
  const source = stats || await statsFor([folder]);
  const { count, tags } = source.stat(folder._id);
  const json = folder.toJSON(); delete json.writeEpoch;
  // `premium` is answered per folder, because a seat unlocks the toolkit here and nowhere else.
  const role = roleOf(folder, user) ?? (folder.team ? await teamFolderRole(folder, user) : null);
  json.premium = await entitledOnFolder(user, folder);
  // Public readers see counts, never a list of private invitees.
  if (role !== 'owner' && !folder.members.some(m => String(m.user._id) === String(user?._id))) json.members = [];
  // The cover's own width, so a browser is never offered a resized copy larger than the picture.
  const thumbnailWidth = folder.thumbnail ? source.coverWidth(folder.thumbnail) : 0;
  return { ...json, role, tags, cardCount: count, thumbnailWidth, memberCount: folder.members.length + 1, likeCount: folder.likeCount || 0, copyCount: folder.copyCount || 0, liked: !!user?.savedFolders?.some(id => String(id) === folder.id), saved: !!user?.savedFolders?.some(id => String(id) === folder.id) };
}

/** Every folder in a list, with the out-of-document facts fetched once for all of them. */
export async function presentFolders(folders, user) {
  if (!folders.length) return [];
  const stats = await statsFor(folders);
  return Promise.all(folders.map(f => presentFolder(f, user, stats)));
}
export async function listFolders(user, scope) {
  // Team folders sit in the member's library too, so a student does not have to go via the team page.
  const teams = scope === 'explore' ? [] : await teamIdsFor(user);
  const filter = scope === 'explore' ? { visibility: 'global', archived: false } : { archived: false, $or: [{ owner: user._id }, { 'members.user': user._id }, { _id: { $in: user.savedFolders }, visibility: 'global' }, ...(teams.length ? [{ team: { $in: teams } }] : [])] };
  const folders = await Folder.find(filter).sort({ updatedAt: -1 }).limit(200);
  return presentFolders(folders, user);
}
export async function createFolder(user, body) { const { thumbnail, ...rest } = body; return Folder.create({ ...rest, owner: user.id }); }
export async function updateFolder(id, user, body) {
  return mutateFolder(id, user, 'owner', async (folder, session) => {
    assert(folder.version === body.version, 409, 'This folder changed. Refresh and try again.', 'VERSION_CONFLICT');
    if (body.thumbnail) {
      await requireFolderPremium(user, folder, 'Folder covers');
      assert(await Media.exists({ _id: body.thumbnail, folder: folder.id }).session(session), 400, 'Thumbnail does not belong to this folder.');
    }
    const { version, ...changes } = body; Object.assign(folder, changes); folder.version += 1;
    await folder.save({ session }); await recordEvent(folder, user, 'folder.updated', folder.title, session); return folder;
  });
}
export async function setMember(id, user, username, role) {
  return mutateFolder(id, user, 'owner', async (folder, session) => {
    const target = await User.findOne({ username }).session(session); assert(target, 404, 'No user with that username. Ask them to create an account first.');
    assert(target.id !== String(folder.owner), 400, 'The owner already has full access.');
    folder.members = folder.members.filter(m => String(m.user) !== target.id);
    if (role === 'editor') await requireFolderPremium(user, folder, 'Inviting editors');
    if (role !== 'remove') folder.members.push({ user: target.id, role });
    folder.version += 1; await folder.save({ session }); await recordEvent(folder, user, 'folder.members.changed', role === 'remove' ? `Removed @${username}` : `Added @${username} as ${role}`, session); return folder;
  });
}
export async function copyFolder(id, user) {
  return mutateFolder(id, user, 'viewer', async (source, session) => {
    const author = await User.findById(source.owner).session(session);
    const [copy] = await Folder.create([{ title: `${source.title} (copy)`, description: source.description, color: source.color, icon: source.icon, owner: user.id, visibility: 'private', copiedFrom: source.id, originalCreator: source.originalCreator || author.username }], { session });
    source.copyCount = (source.copyCount || 0) + 1; await source.save({ session });
    /**
     * One image on the copy, for one on the original.
     *
     * With object storage the bucket copies it server-side: the bytes never travel to us and back,
     * and each copy gets its own object so deleting one folder cannot break another's images.
     * Without it, the old behaviour — duplicate the buffer — still applies.
     */
    const duplicateImage = async original => {
      // Dimensions travel with the copy; the resized versions do not. Copying those too would mean
      // several bucket operations per image for sizes this folder may never be asked for, and they
      // are regenerated on first use anyway.
      // The fingerprint travels with the copy, or the new folder would not recognise the image it
      // already has the next time somebody adds it, and would store a third set of identical bytes.
      const shape = { name: original.name, contentType: original.contentType, width: original.width, height: original.height, sha256: original.sha256, bytes: original.bytes, sourceUrl: original.sourceUrl };
      if (!original.key) return Media.create([{ folder: copy.id, uploadedBy: user.id, data: original.data, ...shape }], { session });
      const to = storage.newKey(copy.id, original.contentType);
      await storage.copy(original.key, to);
      return Media.create([{ folder: copy.id, uploadedBy: user.id, key: to, ...shape }], { session });
    };
    const cards = await Card.find({ folder: source.id }).session(session);
    const imageMap = new Map();
    for (const card of cards) {
      const data = card.toObject(); delete data._id; delete data.__v; delete data.createdAt; delete data.updatedAt;
      for (const side of ['front', 'back']) if (data[side]?.image) {
        const key = String(data[side].image);
        if (!imageMap.has(key)) { const original = await Media.findById(key).select('+data').session(session); if (original) { const [image] = await duplicateImage(original); imageMap.set(key, image.id); } }
        data[side].image = imageMap.get(key) ?? null;
      }
      await Card.create([{ ...data, folder: copy.id, version: 0, createdBy: user.id, updatedBy: user.id }], { session });
    }
    if (source.thumbnail) {
      const original = await Media.findById(source.thumbnail).select('+data').session(session);
      if (original) { const [thumb] = await duplicateImage(original); copy.thumbnail = thumb.id; await copy.save({ session }); }
    }
    await recordEvent(copy, user, 'folder.copied', copy.title, session); return copy;
  });
}
/**
 * Permanent deletion of a collection and everything that only existed because of it.
 *
 * Archive is the reversible path; this is the other one. Cards, pictures, study history,
 * assignments and the record of what an assistant wrote here all go with it, because a folder
 * that is "gone" with a pile of orphaned rows is not gone. Copies other people already made
 * keep their own cards — those are their folders now.
 *
 * The title has to be typed back, and the check is here rather than only in the dialog, because
 * a confirm that the client can skip is not a confirm. The match is exact after trim, against
 * the title as it is stored, so a rename between opening the dialog and submitting is refused
 * rather than deleting the wrong thing.
 *
 * Owner only. An editor can add and remove cards; ending the collection itself is the owner's.
 */
export async function deleteFolder(id, user, confirm) {
  const typed = String(confirm || '').trim();
  const { keys, title, cards } = await mutateFolder(id, user, 'owner', async (folder, session) => {
    assert(typed === folder.title, 400,
      `Type the folder name exactly to delete it: “${folder.title}”.`);

    const cardIds = (await Card.find({ folder: folder._id }).select('_id').session(session).lean()).map(c => c._id);
    const mediaRows = await Media.find({ folder: folder._id }).select('key variants').session(session).lean();
    const keys = mediaRows.flatMap(row => storage.allKeysFor(row.key, row.variants));

    const opts = { session };
    await CardDoc.deleteMany({ card: { $in: cardIds } }, opts);
    await Revision.deleteMany({ folder: folder._id }, opts);
    await Progress.deleteMany({ card: { $in: cardIds } }, opts);
    await Review.deleteMany({ $or: [{ folder: folder._id }, { card: { $in: cardIds } }] }, opts);
    await Card.deleteMany({ folder: folder._id }, opts);
    await Media.deleteMany({ folder: folder._id }, opts);
    await Assignment.deleteMany({ folder: folder._id }, opts);
    await AgentBatch.deleteMany({ folder: folder._id }, opts);
    await Activity.deleteMany({ folder: folder._id }, opts);
    await Project.updateMany({ folders: folder._id }, { $pull: { folders: folder._id } }, opts);
    await User.updateMany({ savedFolders: folder._id }, { $pull: { savedFolders: folder._id } }, opts);

    // Watchers are told before the row is gone, so the live page can leave rather than sit on a
    // collection that will 404 on the next poll. Activity is already deleted, so this is not
    // written as a folder event — there is nowhere left to hang one.
    queueEvent(session, {
      type: 'folder.deleted',
      folderId: String(folder.id),
      aggregateId: String(folder.id),
      detail: folder.title,
      actor: { id: String(user.id), name: user.name, username: user.username },
      at: new Date().toISOString(),
    });

    await Folder.deleteOne({ _id: folder._id }, opts);
    return { keys, title: folder.title, cards: cardIds.length };
  });

  if (keys.length) await storage.remove(keys);
  return { deleted: true, title, cards };
}

export async function likeFolder(id, user, liked) {
  await accessFolder(id, user);
  if (liked) {
    const r = await User.updateOne({ _id: user.id, savedFolders: { $ne: id } }, { $addToSet: { savedFolders: id } });
    if (r.modifiedCount) await Folder.updateOne({ _id: id }, { $inc: { likeCount: 1 } });
  } else {
    const r = await User.updateOne({ _id: user.id, savedFolders: id }, { $pull: { savedFolders: id } });
    if (r.modifiedCount) await Folder.updateOne({ _id: id, likeCount: { $gt: 0 } }, { $inc: { likeCount: -1 } });
  }
  const fresh = await User.findById(user.id);
  return presentFolder(await accessFolder(id, fresh), fresh);
}
