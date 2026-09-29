/**
 * Publishes the United States exam collections.
 *
 * Safe to run against a live database, and safe to run twice: a collection that already exists is
 * left alone rather than duplicated, and one that already has cards is not refilled. Re-running
 * after editing the content adds the new collections and leaves the old ones as they are.
 *
 * Covers go through the same path an uploaded image does — resized, converted to WebP, and stored
 * in object storage if it is configured — so these collections are indistinguishable from ones a
 * person made.
 *
 *   node scripts/seed-us-library.js --owner=<username>     # publish them under that account
 *   node scripts/seed-us-library.js                        # under the only superadmin, if there is one
 *   node scripts/seed-us-library.js --dry                  # say what would happen and change nothing
 */
import 'dotenv/config';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import sharp from 'sharp';
import { Card, Folder, Media, User } from '../server/src/models/index.js';
import * as storage from '../server/src/services/storage.js';
import { usLibrary } from '../shared/usLibrary.js';

const arg = name => process.argv.find(a => a.startsWith(`--${name}=`))?.split('=')[1];
const dry = process.argv.includes('--dry');
const covers = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'deck-covers');

await mongoose.connect(process.env.MONGODB_URI);

/** Whoever is named, or the only superadmin. Refusing to guess between two is deliberate. */
async function findOwner() {
  const wanted = arg('owner');
  if (wanted) {
    const user = await User.findOne({ username: wanted.toLowerCase().replace(/^@/, '') });
    if (!user) throw new Error(`No account called @${wanted}.`);
    return user;
  }
  const staff = await User.find({ account: 'superadmin' }).limit(2);
  if (staff.length === 1) return staff[0];
  throw new Error(staff.length ? 'More than one superadmin — say which with --owner=<username>.' : 'No superadmin found. Pass --owner=<username>.');
}

/**
 * Stores a cover the way the app would.
 *
 * Resized and re-encoded rather than uploaded as-is: a 120 KB PNG becomes a WebP a fraction of the
 * size, and decoding and re-encoding also strips whatever metadata the file arrived with.
 */
async function uploadCover(file, folder, owner) {
  const source = await readFile(path.join(covers, file)).catch(() => null);
  if (!source) { console.log(`    (no cover file ${file}, skipping)`); return null; }
  const data = await sharp(source).resize({ width: 1200, height: 900, fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
  const key = storage.isConfigured() ? storage.newKey(folder.id) : '';
  if (key) await storage.put(key, data, 'image/webp');
  const media = await Media.create({
    folder: folder.id, uploadedBy: owner.id, name: file,
    ...(key ? { key } : { data }),
  });
  return media;
}

const owner = await findOwner();
console.log(`Publishing as @${owner.username}${dry ? ' (dry run, nothing will change)' : ''}`);
console.log(`Object storage: ${storage.isConfigured() ? 'configured, covers go to the bucket' : 'not configured, covers go in the database'}\n`);

let made = 0, skipped = 0, cards = 0;
for (const deck of usLibrary) {
  const existing = await Folder.findOne({ owner: owner.id, title: deck.title });
  if (existing) {
    console.log(`~ ${deck.title} — already there, left alone`);
    skipped += 1;
    continue;
  }
  console.log(`+ ${deck.title} (${deck.cards.length} cards)`);
  if (dry) { made += 1; cards += deck.cards.length; continue; }

  const folder = await Folder.create({
    title: deck.title, description: deck.description, color: deck.color, icon: deck.icon,
    visibility: 'global', owner: owner.id,
  });
  await Card.insertMany(deck.cards.map(c => ({
    folder: folder.id,
    front: { text: c.front },
    back: { text: c.back },
    hint: c.hint || '',
    tags: c.tags || [],
    createdBy: owner.id,
    updatedBy: owner.id,
  })));
  if (deck.thumbnail) {
    const cover = await uploadCover(deck.thumbnail, folder, owner);
    if (cover) { folder.thumbnail = cover.id; await folder.save(); }
  }
  made += 1; cards += deck.cards.length;
}

console.log(`\n${made} published, ${skipped} already present, ${cards} cards${dry ? ' would be' : ''} written.`);
if (!dry && made) console.log('They are public, so they are in the sitemap within the hour.');
await mongoose.disconnect();
