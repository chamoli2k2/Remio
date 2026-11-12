import { AGENT_BATCH_KINDS } from '../constants/index.js';
import mongoose from 'mongoose';
import { ref, options } from './_shared.js';
const { Schema, model } = mongoose;
/**
 * What an assistant did, in one reviewable unit.
 *
 * Every write an assistant makes belongs to a batch, and a batch can be undone whole. This is not
 * really a security control — the tools that write batches are additive, so nothing here can destroy anything — it is
 * an admission that a model will sometimes produce forty cards of confident nonsense, and the cost
 * of that should be one click rather than forty.
 *
 * `cards` is the list actually inserted, so undoing removes exactly what this batch added and
 * nothing a person wrote afterwards. `requestId` is the idempotency key: MCP clients retry on
 * timeout, and without this a slow call that succeeded would be replayed into duplicates.
 */
const agentBatch = new Schema({
  user: ref('User'),
  token: ref('AgentToken', false),
  // Denormalised, because the point of the review screen is to say which assistant did this, and
  // the most likely reason to be reading it is that the grant has just been revoked.
  tokenName: { type: String, default: '' },
  // Notes batches have a notebook instead of a collection, so this one is optional.
  folder: ref('Folder', false),
  folderTitle: { type: String, default: '' },
  // What a notes batch wrote: the notebook, the pages it created, and whether the notebook itself
  // came from the batch (so undoing can take it away if nobody has added anything since).
  notebook: ref('Notebook', false),
  notebookTitle: { type: String, default: '' },
  notes: [ref('Note', false)],
  pageCount: { type: Number, default: 0 },
  createdNotebook: { type: Boolean, default: false },
  cards: [ref('Card', false)],
  cardCount: { type: Number, default: 0 },
  /**
   * Images this batch caused to be fetched and stored.
   *
   * Recorded as ids rather than bucket keys on purpose. Resized copies are made lazily, long
   * after the batch was written, so a list of keys captured here would be missing whichever
   * sizes were generated since — and undoing would leave them behind, paying rent forever. The
   * rows know their own variants at the moment they are read.
   *
   * Only images this batch created appear here. One reused from an earlier batch is left alone,
   * or undoing the second batch would break the first one's cards.
   */
  media: [ref('Media', false)],
  imageCount: { type: Number, default: 0 },
  // Whether the collection itself came from this batch, so undoing can take it with them.
  createdFolder: { type: Boolean, default: false },
  // The cover this batch set, and what was there before, so undoing puts it back rather than
  // leaving a collection pointing at an image that has just been deleted.
  coverMedia: ref('Media', false),
  previousCover: { type: String, default: '' },
  requestId: { type: String, required: true },
  /**
   * What wrote this batch. `edit` rows exist only to count the pictures an edit fetched against the
   * daily allowance: an edit is undone from the card's own history, so undo refuses them and the
   * review list leaves them out. Older rows have no kind and are card or cover batches.
   */
  kind: { type: String, enum: AGENT_BATCH_KINDS, default: undefined },
  // A digest of the request, so a request id reused for different cards is refused rather than
  // answered with the result of the first. Older rows have none and are replayed as before.
  fingerprint: { type: String, default: undefined },
  // The reply already sent for this request id, replayed verbatim on a retry.
  result: Schema.Types.Mixed,
  undoneAt: { type: Date, default: null },
}, options);
agentBatch.index({ user: 1, requestId: 1 }, { unique: true });
agentBatch.index({ user: 1, createdAt: -1 });
export const AgentBatch = model('AgentBatch', agentBatch);
