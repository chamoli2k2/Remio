/**
 * Moves image bytes out of MongoDB and into object storage.
 *
 * Safe to run on a live server, and safe to run twice. It only touches rows that still hold bytes
 * and have no key, so a second run finds nothing to do. Each row is uploaded first and only then
 * rewritten, so an interruption leaves an unreferenced object rather than a row pointing at
 * nothing — the same ordering the upload path uses, for the same reason.
 *
 * The bytes are cleared with $unset once the key is in place. Nothing reads `data` when `key` is
 * set, so the row keeps working throughout.
 *
 *   node scripts/migrate-media.js          # report what would move
 *   node scripts/migrate-media.js --apply  # move it
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import { Media } from '../server/src/models/index.js';
import * as storage from '../server/src/services/storage.js';

const apply = process.argv.includes('--apply');
const size = bytes => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

if (!storage.isConfigured()) {
  console.error('Object storage is not configured. Set R2_BUCKET, R2_ACCOUNT_ID, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY.');
  process.exit(1);
}

await mongoose.connect(process.env.MONGODB_URI);
const pending = await Media.find({ key: { $in: ['', null] } }).select('+data folder contentType name');
const total = pending.reduce((sum, m) => sum + (m.data?.length || 0), 0);
console.log(`${pending.length} image${pending.length === 1 ? '' : 's'} still in the database, ${size(total)} in all.`);

if (!apply) {
  console.log('Nothing changed. Re-run with --apply to move them.');
} else {
  let moved = 0, failed = 0, freed = 0;
  for (const media of pending) {
    if (!media.data?.length) continue;
    const key = storage.newKey(media.folder, media.contentType);
    try {
      await storage.put(key, media.data, media.contentType || 'image/webp');
      // Two steps rather than one save: the key has to be durable before the bytes go, or an
      // interruption between them would lose the image outright.
      await Media.updateOne({ _id: media._id }, { $set: { key } });
      await Media.updateOne({ _id: media._id }, { $unset: { data: '' } });
      freed += media.data.length; moved++;
      if (moved % 25 === 0) console.log(`  ${moved}/${pending.length}…`);
    } catch (error) {
      failed++;
      console.error(`  could not move ${media._id}: ${error.message}`);
    }
  }
  console.log(`Moved ${moved}, freed ${size(freed)} in the database.${failed ? ` ${failed} failed and were left alone.` : ''}`);
}
await mongoose.disconnect();
