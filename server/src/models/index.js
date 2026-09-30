import mongoose from 'mongoose';
import { COUNTRY_NAMES, HOME_COUNTRY } from '../../../shared/countries.js';
const { Schema, model } = mongoose;
const ref = (name, required = true) => ({ type: Schema.Types.ObjectId, ref: name, required });
const options = { timestamps: true, toJSON: { transform: (_doc, ret) => { ret.id = ret._id.toString(); delete ret._id; delete ret.__v; return ret; } } };
const user = new Schema({ username: { type: String, required: true, unique: true, lowercase: true }, email: { type: String, required: true, unique: true, lowercase: true, select: false }, emailVerifiedAt: { type: Date, default: null }, passwordHash: { type: String, select: false }, googleId: { type: String, select: false }, name: { type: String, required: true }, bio: { type: String, default: '' }, country: { type: String, enum: COUNTRY_NAMES, default: HOME_COUNTRY }, dailyGoal: { type: Number, default: 20 }, desiredRetention: { type: Number, default: 0.9, min: 0.7, max: 0.97 }, termsAcceptedAt: { type: Date, default: null }, termsVersion: { type: String, default: '' }, account: { type: String, enum: ['normal', 'premium', 'admin', 'superadmin'], default: 'normal' }, premiumPlan: { type: String, default: '' }, premiumExpiresAt: { type: Date, default: null }, savedFolders: [ref('Folder')], followers: { type: Number, default: 0 }, following: { type: Number, default: 0 }, friends: { type: Number, default: 0 } }, options);
// Sparse and unique: one Google account can only ever be one account here.
user.index({ googleId: 1 }, { unique: true, sparse: true });
const session = new Schema({ tokenHash: { type: String, required: true, unique: true }, user: ref('User'), expiresAt: { type: Date, required: true, expires: 0 } }, options);
// Emailed links are bearer credentials, so only the hash is stored and `expires: 0` lets Mongo
// retire them on its own. `purpose` keeps one collection usable for password resets later.
const authToken = new Schema({ tokenHash: { type: String, required: true, unique: true }, user: ref('User'), purpose: { type: String, enum: ['verify-email', 'reset-password'], required: true }, expiresAt: { type: Date, required: true, expires: 0 }, usedAt: { type: Date, default: null } }, options);
authToken.index({ user: 1, purpose: 1 });
/**
 * One assistant's standing permission to act for one user.
 *
 * A grant, not a token: the row is the thing a person revokes, and the secrets hanging off it are
 * implementation. That distinction is what lets the settings page list "Claude — added in March,
 * last used an hour ago" rather than a pile of opaque credentials, and it means rotating a token
 * during a refresh does not look to the user like anything happened.
 *
 * Both secrets are stored only as SHA-256, the same way sessions and team join codes are, so the
 * database cannot hand anyone a working credential. `accessExpiresAt` is deliberately not a Mongo
 * TTL: an expired grant still has to be listed, and still has to be revocable, and a row that
 * deletes itself would take its own audit trail with it.
 */
const agentToken = new Schema({
  user: ref('User'),
  // What the user sees in the list. Their own words for a personal token, the client's self-declared
  // name for one issued through OAuth — which is why it is never trusted as anything but a label.
  name: { type: String, default: '' },
  scopes: { type: [String], default: [] },
  accessHash: { type: String },
  accessExpiresAt: { type: Date },
  // Absent on a personal token. Refresh exists for OAuth clients, which expect to hold a
  // long-running connection without asking the user again.
  refreshHash: { type: String },
  client: { type: String, default: '' },
  createdVia: { type: String, enum: ['personal', 'oauth'], default: 'personal' },
  lastUsedAt: { type: Date, default: null },
  revokedAt: { type: Date, default: null },
}, options);
// Sparse because a rotated grant briefly has no access secret, and a personal one never has a
// refresh secret — and a present-but-null field is indexed like any other value, so every such row
// would collide on the same key.
agentToken.index({ accessHash: 1 }, { unique: true, sparse: true });
agentToken.index({ refreshHash: 1 }, { unique: true, sparse: true });
agentToken.index({ user: 1, createdAt: -1 });

/**
 * What an assistant did, in one reviewable unit.
 *
 * Every write an assistant makes belongs to a batch, and a batch can be undone whole. This is not
 * really a security control — the tools are additive, so nothing here can destroy anything — it is
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
  folder: ref('Folder'),
  folderTitle: { type: String, default: '' },
  cards: [ref('Card', false)],
  cardCount: { type: Number, default: 0 },
  // Whether the collection itself came from this batch, so undoing can take it with them.
  createdFolder: { type: Boolean, default: false },
  requestId: { type: String, required: true },
  // The reply already sent for this request id, replayed verbatim on a retry.
  result: Schema.Types.Mixed,
  undoneAt: { type: Date, default: null },
}, options);
agentBatch.index({ user: 1, requestId: 1 }, { unique: true });
agentBatch.index({ user: 1, createdAt: -1 });

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

const folder = new Schema({ title: { type: String, required: true }, description: { type: String, default: '' }, color: { type: String, default: 'violet' }, icon: { type: String, default: 'layers' }, visibility: { type: String, enum: ['private', 'global'], default: 'private' }, owner: ref('User'), members: [{ user: ref('User'), role: { type: String, enum: ['viewer', 'editor'], required: true }, _id: false }], version: { type: Number, default: 0 }, writeEpoch: { type: Number, default: 0 }, archived: { type: Boolean, default: false }, copiedFrom: ref('Folder', false), originalCreator: { type: String, default: '' }, thumbnail: ref('Media', false), likeCount: { type: Number, default: 0 }, copyCount: { type: Number, default: 0 }, team: ref('Team', false) }, options);
folder.index({ owner: 1, updatedAt: -1 }); folder.index({ 'members.user': 1 }); folder.index({ visibility: 1, archived: 1 }); folder.index({ team: 1, updatedAt: -1 });
const side = { text: { type: String, default: '' }, image: ref('Media', false) };
const card = new Schema({ folder: ref('Folder'), front: side, back: side, tags: [String], hint: { type: String, default: '' }, source: { type: String, default: '' }, version: { type: Number, default: 0 }, createdBy: ref('User'), updatedBy: ref('User') }, options);
card.index({ folder: 1, createdAt: 1 }); card.index({ folder: 1, tags: 1 });
// `width` is the original's own width, so no resized copy wider than the picture is ever offered.
// `variants` records which widths have been generated, which is cheaper than asking the bucket: the
// row is already loaded to check permission, and a listing would be a second network call per image.
const media = new Schema({ folder: ref('Folder'), uploadedBy: ref('User'), data: { type: Buffer, select: false }, key: { type: String, default: '' }, contentType: { type: String, default: 'image/webp' }, name: String, width: { type: Number, default: 0 }, height: { type: Number, default: 0 }, variants: { type: [Number], default: [] } }, options);
// FSRS memory state (stability, difficulty, state) plus the legacy SM-2 fields (interval, repetitions, ease) kept for compatibility.
const progress = new Schema({ user: ref('User'), card: ref('Card'), repetitions: { type: Number, default: 0 }, interval: { type: Number, default: 0 }, ease: { type: Number, default: 2.5 }, stability: { type: Number, default: 0 }, difficulty: { type: Number, default: 0 }, state: { type: String, enum: ['new', 'learning', 'review', 'relearning'], default: 'new' }, reps: { type: Number, default: 0 }, lapses: { type: Number, default: 0 }, elapsedDays: { type: Number, default: 0 }, scheduledDays: { type: Number, default: 0 }, dueAt: { type: Date, default: Date.now }, lastReviewedAt: Date, version: { type: Number, default: 0 }, bookmarked: { type: Boolean, default: false } }, options);
progress.index({ user: 1, card: 1 }, { unique: true }); progress.index({ user: 1, dueAt: 1 });
const review = new Schema({ user: ref('User'), card: ref('Card'), folder: ref('Folder', false), requestId: { type: String, required: true }, rating: { type: String, enum: ['again', 'hard', 'good', 'easy'] }, elapsedDays: Number, result: Schema.Types.Mixed }, options);
review.index({ user: 1, requestId: 1 }, { unique: true }); review.index({ user: 1, createdAt: -1 });
const activity = new Schema({ folder: ref('Folder'), actor: ref('User'), action: String, detail: String }, options);
activity.index({ folder: 1, createdAt: -1 });
const revision = new Schema({ card: ref('Card'), folder: ref('Folder'), editor: ref('User'), version: Number, snapshot: Schema.Types.Mixed }, options);
revision.index({ card: 1, version: 1 }, { unique: true });
// Durable domain events are the future integration boundary. No AI calls or indexing run in v1.
const event = new Schema({ type: String, aggregateId: String, payload: Schema.Types.Mixed, processedAt: Date }, options);
event.index({ processedAt: 1, createdAt: 1 });
// Persisted Yjs CRDT state for live co-editing. The Card document remains the authoritative, versioned text.
const cardDoc = new Schema({ card: { ...ref('Card'), unique: true }, state: { type: Buffer, required: true, select: false } }, options);
const relationship = new Schema({ from: ref('User'), to: ref('User'), kind: { type: String, enum: ['follow', 'connect'], required: true }, status: { type: String, enum: ['active', 'pending'], required: true } }, options);
relationship.index({ from: 1, to: 1, kind: 1 }, { unique: true });
relationship.index({ to: 1, kind: 1, status: 1 });
relationship.index({ from: 1, kind: 1, status: 1 });
const project = new Schema({ title: { type: String, required: true }, description: { type: String, default: '' }, visibility: { type: String, enum: ['private', 'global'], default: 'private' }, owner: ref('User'), folders: [ref('Folder', false)], version: { type: Number, default: 0 }, archived: { type: Boolean, default: false } }, options);
project.index({ owner: 1, updatedAt: -1 }); project.index({ folders: 1 });
// One order shape covers both products. `team` set means the payment buys seats rather than a
// personal subscription, so neither payment method needed new code to start selling teams.
const premiumOrder = new Schema({ user: ref('User'), plan: { type: String, required: true }, team: ref('Team', false), seats: { type: Number, default: 0 }, kind: { type: String, enum: ['personal', 'team-new', 'team-renew', 'team-seats'], default: 'personal' }, method: { type: String, enum: ['manual', 'razorpay'], default: 'razorpay' }, amount: { type: Number, default: 0 }, currency: { type: String, default: 'INR' }, gatewayOrderId: { type: String }, gatewayPaymentId: { type: String }, name: { type: String, required: true }, email: { type: String, required: true }, phone: { type: String, required: true }, country: { type: String, required: true }, address: { type: String, required: true }, status: { type: String, enum: ['pending', 'approved', 'declined'], default: 'pending' }, reviewedBy: ref('User', false) }, options);
premiumOrder.index({ user: 1, createdAt: -1 });
// Sparse and unique: a gateway payment can only ever be credited to one order, however many times
// its webhook fires. Both fields are deliberately left unset until the gateway supplies them, never
// defaulted to null, because sparse only skips an absent field — a field that is present and null
// is indexed like any other value, and every unpaid order would then be fighting for the same key.
premiumOrder.index({ gatewayOrderId: 1 }, { unique: true, sparse: true });
premiumOrder.index({ gatewayPaymentId: 1 }, { unique: true, sparse: true });
const notification = new Schema({ user: ref('User'), type: { type: String, required: true }, actor: ref('User', false), data: { type: Schema.Types.Mixed, default: {} }, readAt: { type: Date, default: null } }, options);
notification.index({ user: 1, createdAt: -1 }); notification.index({ user: 1, readAt: 1 });
// `memberCount` is denormalised so the seat check is one read; it is only ever written in the same
// transaction as the membership it counts, which is what keeps a full team from overselling a seat.
const team = new Schema({ name: { type: String, required: true }, kind: { type: String, enum: ['classroom', 'team'], default: 'classroom' }, description: { type: String, default: '' }, owner: ref('User'), plan: { type: String, default: '' }, seats: { type: Number, default: 0 }, memberCount: { type: Number, default: 1 }, expiresAt: { type: Date, default: null }, version: { type: Number, default: 0 }, archived: { type: Boolean, default: false } }, options);
team.index({ owner: 1, updatedAt: -1 });
const teamMember = new Schema({ team: ref('Team'), user: ref('User'), role: { type: String, enum: ['owner', 'teacher', 'student'], required: true }, invitedBy: ref('User', false) }, options);
teamMember.index({ team: 1, user: 1 }, { unique: true }); teamMember.index({ user: 1 }); teamMember.index({ team: 1, role: 1 });
// A join code is a bearer credential, so it is stored hashed and only ever shown once, at creation.
const teamInvite = new Schema({ team: ref('Team'), codeHash: { type: String, required: true, unique: true }, role: { type: String, enum: ['teacher', 'student'], default: 'student' }, createdBy: ref('User'), expiresAt: { type: Date, default: null }, maxUses: { type: Number, default: 0 }, uses: { type: Number, default: 0 }, revokedAt: { type: Date, default: null } }, options);
teamInvite.index({ team: 1, createdAt: -1 });
const assignment = new Schema({ team: ref('Team'), folder: ref('Folder'), createdBy: ref('User'), title: { type: String, default: '' }, instructions: { type: String, default: '' }, dueAt: { type: Date, default: null }, archived: { type: Boolean, default: false } }, options);
assignment.index({ team: 1, dueAt: 1 }); assignment.index({ folder: 1 });
// A stored setting is an override, not a value: only keys an operator has actually changed live
// here, and everything else falls back to the declaration in shared/settings.js. Which means an
// empty collection is a valid, working configuration, and deleting a row is how you undo.
const setting = new Schema({ key: { type: String, required: true, unique: true }, value: Schema.Types.Mixed, updatedBy: ref('User', false) }, options);
// Every change to configuration, kept whether or not anything went wrong. Editable settings without
// a record of who moved them is a liability the first time a number looks wrong at midnight.
const auditEntry = new Schema({ actor: ref('User', false), actorName: { type: String, default: '' }, action: { type: String, required: true }, target: { type: String, default: '' }, before: Schema.Types.Mixed, after: Schema.Types.Mixed, note: { type: String, default: '' } }, options);
auditEntry.index({ createdAt: -1 }); auditEntry.index({ target: 1, createdAt: -1 });
/**
 * A notice that something published here should not be.
 *
 * The Digital Services Act requires a hosting service to let anyone flag content they believe is
 * illegal, to act on it, and to tell the person who reported it what happened. That obligation
 * does not wait for the platform to be large, so this exists from the start.
 *
 * `reporter` is optional on purpose. Public folders can be read without an account, so the person
 * best placed to notice a problem may not have one, and requiring them to register first would
 * put a barrier in front of the report. An address is asked for instead so the outcome can be
 * sent back, and that too is optional.
 */
const contentReport = new Schema({
  folder: ref('Folder'),
  reporter: ref('User', false),
  email: { type: String, default: '' },
  reason: { type: String, enum: ['illegal', 'infringement', 'privacy', 'harmful', 'spam', 'other'], required: true },
  detail: { type: String, default: '' },
  status: { type: String, enum: ['open', 'upheld', 'rejected'], default: 'open' },
  // What was decided and why, kept because a decision a reviewer cannot explain later is not a
  // decision anyone can appeal against.
  outcome: { type: String, default: '' },
  reviewedBy: ref('User', false),
  reviewedAt: { type: Date, default: null },
}, options);
// The queue is read newest-first, and a folder's own history is read when judging a repeat report.
contentReport.index({ status: 1, createdAt: -1 });
contentReport.index({ folder: 1, createdAt: -1 });

export const AgentToken = model('AgentToken', agentToken), AgentBatch = model('AgentBatch', agentBatch), OAuthClient = model('OAuthClient', oauthClient), OAuthGrant = model('OAuthGrant', oauthGrant);
export const User = model('User', user), Session = model('Session', session), AuthToken = model('AuthToken', authToken), Folder = model('Folder', folder), Card = model('Card', card), Media = model('Media', media), Progress = model('Progress', progress), Review = model('Review', review), Activity = model('Activity', activity), Revision = model('Revision', revision), DomainEvent = model('DomainEvent', event), CardDoc = model('CardDoc', cardDoc), Relationship = model('Relationship', relationship), Project = model('Project', project), PremiumOrder = model('PremiumOrder', premiumOrder), Notification = model('Notification', notification), Team = model('Team', team), TeamMember = model('TeamMember', teamMember), TeamInvite = model('TeamInvite', teamInvite), Assignment = model('Assignment', assignment), Setting = model('Setting', setting), AuditEntry = model('AuditEntry', auditEntry), ContentReport = model('ContentReport', contentReport);
export const allModels = [User, Session, AuthToken, Folder, Card, Media, Progress, Review, Activity, Revision, DomainEvent, CardDoc, Relationship, Project, PremiumOrder, Notification, Team, TeamMember, TeamInvite, Assignment, Setting, AuditEntry, ContentReport, AgentToken, AgentBatch, OAuthClient, OAuthGrant];
