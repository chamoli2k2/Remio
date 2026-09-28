import sharp from 'sharp';
import * as storage from '../services/storage.js';
import { Card, Media, Revision, Progress } from '../models/index.js';
import * as cards from '../services/cardService.js';
import { accessFolder, mutateFolder } from '../services/accessService.js';
import { requireFolderPremium } from '../services/teamAccess.js';
import { assert } from '../utils/errors.js';
import { parseFile, toCsv, MAX_CARDS } from '../services/importService.js';
import { cardSchema } from '../middleware/validate.js';
import { BRAND } from '../../../shared/brand.js';
export const list = async (req, res) => res.json({ cards: await cards.listCards(req.params.id, req.user) });
export const create = async (req, res) => res.status(201).json({ card: await cards.createCard(req.params.id, req.user, req.body) });
export const update = async (req, res) => res.json({ card: await cards.updateCard(req.params.id, req.user, req.body) });
export const remove = async (req, res) => { await cards.deleteCard(req.params.id, req.user); res.json({ ok: true }); };
export const revisions = async (req, res) => { const card = await Card.findById(req.params.id); assert(card, 404, 'Card not found.'); await accessFolder(card.folder, req.user, 'editor'); res.json({ revisions: await Revision.find({ card: card.id }).sort({ version: -1 }).limit(20).populate('editor', 'name username') }); };
export const bookmark = async (req, res) => { const card = await Card.findById(req.params.id); assert(card, 404, 'Card not found.'); await mutateFolder(card.folder, req.user, 'viewer', async (_folder, session) => { await Progress.updateOne({ user: req.user.id, card: card.id }, { $set: { bookmarked: req.body.bookmarked } }, { upsert: true, session }); }); res.json({ ok: true }); };
export const upload = async (req, res) => {
  assert(req.file, 400, 'Choose an image.');
  // Decode and re-encode instead of trusting extensions or MIME headers; strips metadata.
  let data; try { data = await sharp(req.file.buffer, { limitInputPixels: 25000000 }).rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }).toBuffer(); } catch { assert(false, 400, 'Upload a valid JPG, PNG, or WebP image.'); }
  assert(data.length <= 3 * 1024 * 1024, 400, 'Image is too large after processing.');
  const media = await mutateFolder(req.params.id, req.user, 'editor', async (folder, session) => {
    const stored = storage.isConfigured() ? storage.newKey(folder.id) : '';
    if (stored) await storage.put(stored, data, 'image/webp');
    const [m] = await Media.create([{
      folder: folder.id, uploadedBy: req.user.id, name: req.file.originalname.slice(0, 150),
      ...(stored ? { key: stored } : { data }),
    }], { session });
    return m;
  });
  res.status(201).json({ id: media.id, url: `/api/media/${media.id}` });
};
// Import runs in two steps from the UI: dryRun=1 returns a preview, then the same upload commits. Parsing never touches the database.
export const importFile = async (req, res) => {
  assert(req.file, 400, 'Choose a file to import.');
  // Gated here rather than on the route, because a seat entitles the holder in this folder only.
  await requireFolderPremium(req.user, await accessFolder(req.params.id, req.user, 'editor'), 'Importing cards');
  const { format, cards: parsed } = await parseFile(req.file.buffer, req.file.originalname, req.file.mimetype);
  const valid = parsed.map(c => cardSchema.safeParse(c)).filter(r => r.success).map(r => r.data);
  assert(valid.length, 400, format === 'csv' ? 'No cards found. Use two columns (front, back) or a header row naming front and back.' : 'No cards were found in that file.');
  if (req.query.dryRun === '1') return res.json({ format, total: valid.length, skipped: parsed.length - valid.length, sample: valid.slice(0, 5), truncated: valid.length > MAX_CARDS });
  const extraTags = String(req.body.tags || '').split(/[\s,]+/).map(t => t.trim().toLowerCase().replace(/^#/, '').slice(0, 30)).filter(Boolean).slice(0, 5);
  const created = await cards.importCards(req.params.id, req.user, valid.slice(0, MAX_CARDS), { extraTags });
  res.status(201).json({ format, imported: created.length, skipped: parsed.length - valid.length });
};
export const exportFile = async (req, res) => {
  await requireFolderPremium(req.user, await accessFolder(req.params.id, req.user), 'Exporting cards');
  const { folder, cards: list } = await cards.exportCards(req.params.id, req.user); const name = folder.title.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() || `${BRAND.slug}-export`;
  if (req.query.format === 'csv') return res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}.csv"` }).send(toCsv(list));
  res.set({ 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}.json"` }).send(JSON.stringify({ app: BRAND.slug, version: 1, exportedAt: new Date().toISOString(), folder: { title: folder.title, description: folder.description, tags: [...new Set(list.flatMap(c => c.tags))] }, cards: list }, null, 2));
};
export const image = async (req, res) => {
  const media = await Media.findById(req.params.id).select('+data');
  assert(media, 404, 'Image not found.');
  await accessFolder(media.folder, req.user);
  if (media.key) {
    // Private on purpose: the link is signed for this viewer's benefit and must not be cached by
    // anything shared. Shorter than the signature, so a reused redirect cannot outlive it.
    res.set('Cache-Control', `private, max-age=${storage.REDIRECT_CACHE_SECONDS}`);
    return res.redirect(302, await storage.signedUrl(media.key));
  }
  res.set({ 'Content-Type': media.contentType, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' }).send(media.data);
};
