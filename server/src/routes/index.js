import { Router } from 'express';
import multer from 'multer';
import { rateLimit as limiter } from 'express-rate-limit';
import { z } from 'zod';
import * as auth from '../controllers/authController.js';
import * as folders from '../controllers/folderController.js';
import * as cards from '../controllers/cardController.js';
import * as study from '../controllers/studyController.js';
import * as social from '../controllers/socialController.js';
import * as projects from '../controllers/projectController.js';
import * as admin from '../controllers/adminController.js';
import * as premium from '../controllers/premiumController.js';
import * as notifications from '../controllers/notificationController.js';
import * as teams from '../controllers/teamController.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePremium, requireDashboard, requireVerifiedEmail } from '../middleware/account.js';
import { validate, signupSchema, passwordChangeSchema, forgotPasswordSchema, resetPasswordSchema, deleteAccountSchema, verifyEmailSchema, folderSchema, cardSchema, usernameSchema, idSchema, projectSchema, premiumOrderSchema, teamSchema, teamInviteSchema, joinCodeSchema, assignmentSchema, seatQuoteSchema, teamOrderSchema } from '../middleware/validate.js';
import { asyncHandler as a } from '../utils/errors.js';
/**
 * A test suite is one client IP making hundreds of calls, so the limits would fire on the honest
 * traffic of the suite itself rather than on anything it is checking. Never honoured in production,
 * so setting the flag on a live host cannot switch the limits off.
 */
const limitsOff = () => process.env.DISABLE_RATE_LIMIT === '1' && process.env.NODE_ENV !== 'production';
const rateLimit = options => limiter({ ...options, skip: limitsOff });

const r = Router(); const authLimit = rateLimit({ windowMs: 15 * 60000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false });
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } });
r.post('/auth/signup', authLimit, validate(signupSchema), a(auth.signup));
r.post('/auth/login', authLimit, validate(z.object({ identifier: z.string().min(1).max(254), password: z.string().min(1).max(128) })), a(auth.login));
r.post('/auth/logout', a(auth.logout)); r.get('/auth/me', a(auth.me));
// Confirming a link is unauthenticated because the click can land in any browser. The token is the
// credential, so the limiter is what stops it being guessed at.
r.post('/auth/verify-email', authLimit, validate(verifyEmailSchema), a(auth.verifyEmail));
r.post('/auth/verify-email/resend', requireAuth, rateLimit({ windowMs: 15 * 60000, limit: 5 }), a(auth.resendVerification));
// Forgetting a password is the one way back in for somebody locked out, so it stays open to
// everyone. The link goes to the address on file, which is what makes it safe.
r.post('/auth/password/forgot', rateLimit({ windowMs: 15 * 60000, limit: 5 }), validate(forgotPasswordSchema), a(auth.forgotPassword));
r.post('/auth/password/reset', authLimit, validate(resetPasswordSchema), a(auth.resetPassword));
// A deliberate change is announced by email and needs an address we know reaches them.
r.post('/auth/password', requireAuth, requireVerifiedEmail, authLimit, validate(passwordChangeSchema), a(auth.changePassword));
r.delete('/auth/account', requireAuth, authLimit, validate(deleteAccountSchema), a(auth.deleteAccount));
r.get('/users', a(auth.searchPeople));
r.get('/users/:username', a(auth.publicProfile));
r.post('/users/:username/follow', requireAuth, a(social.follow));
r.delete('/users/:username/follow', requireAuth, a(social.unfollow));
r.post('/users/:username/connect', requireAuth, a(social.connect));
r.post('/users/:username/connect/accept', requireAuth, a(social.accept));
r.post('/users/:username/connect/decline', requireAuth, a(social.decline));
r.delete('/users/:username/connect', requireAuth, a(social.unfriend));
r.get('/me/friends', requireAuth, a(social.friends));
r.get('/me/requests', requireAuth, a(social.requests));
r.get('/projects', requireAuth, requirePremium, a(projects.list));
r.post('/projects', requireAuth, requirePremium, validate(projectSchema), a(projects.create));
r.get('/projects/:id', a(projects.get));
r.patch('/projects/:id', requireAuth, requirePremium, validate(projectSchema.extend({ version: z.number().int().min(0) })), a(projects.update));
r.patch('/projects/:id/archive', requireAuth, requirePremium, validate(z.object({ archived: z.boolean() })), a(projects.archive));
r.post('/projects/:id/folders', requireAuth, requirePremium, validate(z.object({ folderId: idSchema })), a(projects.addFolder));
r.delete('/projects/:id/folders/:folderId', requireAuth, requirePremium, a(projects.removeFolder));
r.patch('/auth/profile', requireAuth, validate(z.object({ name: z.string().trim().min(1).max(60), bio: z.string().max(300), dailyGoal: z.number().int().min(1).max(200), desiredRetention: z.number().min(0.7).max(0.97).optional() })), a(auth.profile));
r.get('/folders', (req, res, next) => req.query.scope === 'explore' ? next() : requireAuth(req, res, next), a(folders.list));
r.get('/folders/archived', requireAuth, a(folders.archived));
r.post('/folders', requireAuth, validate(folderSchema), a(folders.create));
r.get('/folders/:id', a(folders.get));
r.patch('/folders/:id', requireAuth, validate(folderSchema.extend({ version: z.number().int().min(0) })), a(folders.update));
r.post('/folders/:id/members', requireAuth, validate(z.object({ username: usernameSchema, role: z.enum(['viewer', 'editor', 'remove']) })), a(folders.member));
r.post('/folders/:id/copy', requireAuth, a(folders.copy));
r.patch('/folders/:id/archive', requireAuth, validate(z.object({ archived: z.boolean() })), a(folders.archive));
r.patch('/folders/:id/save', requireAuth, validate(z.object({ saved: z.boolean() })), a(folders.save));
r.get('/folders/:id/activity', a(folders.activity));
r.get('/folders/:id/cards', a(cards.list)); r.post('/folders/:id/cards', requireAuth, validate(cardSchema), a(cards.create));
r.post('/folders/:id/images', requireAuth, rateLimit({ windowMs: 60000, limit: 20 }), upload.single('image'), a(cards.upload));
const importUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024, files: 1 } });
// Import and export are gated inside the controller, which knows the folder and therefore the team seat.
r.post('/folders/:id/import', requireAuth, rateLimit({ windowMs: 60000, limit: 10 }), importUpload.single('file'), a(cards.importFile));
r.get('/folders/:id/export', requireAuth, a(cards.exportFile));
r.get('/notifications', requireAuth, a(notifications.list));
r.post('/notifications/read', requireAuth, validate(z.object({ ids: z.array(idSchema).max(100).optional() })), a(notifications.read));
const payLimit = rateLimit({ windowMs: 60000, limit: 8 });
r.get('/premium/order', requireAuth, a(premium.mine));
r.post('/premium/order', requireAuth, requireVerifiedEmail, payLimit, upload.single('proof'), a(premium.submit));
r.post('/premium/checkout', requireAuth, requireVerifiedEmail, payLimit, validate(premiumOrderSchema), a(premium.start));
r.post('/premium/checkout/confirm', requireAuth, payLimit, validate(z.object({ orderId: z.string().min(4).max(64), paymentId: z.string().min(4).max(64), signature: z.string().min(16).max(256) })), a(premium.confirm));
r.delete('/premium/order', requireAuth, a(premium.cancel));
r.get('/premium/orders/:id/proof', requireAuth, a(premium.proof));
r.get('/teams', requireAuth, a(teams.list));
r.post('/teams', requireAuth, validate(teamSchema), a(teams.create));
r.get('/teams/code/:code', requireAuth, a(teams.preview));
r.post('/teams/join', requireAuth, rateLimit({ windowMs: 60000, limit: 10 }), validate(joinCodeSchema), a(teams.join));
r.get('/teams/:id', requireAuth, a(teams.detail));
r.patch('/teams/:id', requireAuth, validate(teamSchema.extend({ version: z.number().int().min(0) })), a(teams.update));
r.patch('/teams/:id/archive', requireAuth, a(teams.archive));
r.get('/teams/:id/invites', requireAuth, a(teams.invites));
r.post('/teams/:id/invites', requireAuth, validate(teamInviteSchema), a(teams.invite));
r.delete('/teams/:id/invites/:inviteId', requireAuth, a(teams.revokeInvite));
r.patch('/teams/:id/members/:userId', requireAuth, validate(z.object({ role: z.enum(['teacher', 'student']) })), a(teams.setRole));
r.delete('/teams/:id/members/:userId', requireAuth, a(teams.removeMember));
r.post('/teams/:id/folders', requireAuth, validate(folderSchema), a(teams.createFolder));
r.post('/teams/:id/assignments', requireAuth, validate(assignmentSchema), a(teams.createAssignment));
r.delete('/teams/:id/assignments/:assignmentId', requireAuth, a(teams.archiveAssignment));
r.get('/teams/:id/progress', requireAuth, a(teams.progress));
// Seats reuse the premium order pipeline, so both payment methods work here with no new payment code.
r.post('/teams/:id/quote', requireAuth, validate(seatQuoteSchema), a(teams.quote));
r.get('/teams/:id/billing', requireAuth, a(teams.billing));
r.post('/teams/:id/checkout', requireAuth, requireVerifiedEmail, payLimit, validate(teamOrderSchema), a(teams.buy));
r.post('/teams/:id/order', requireAuth, requireVerifiedEmail, payLimit, upload.single('proof'), a(teams.buyManual));
r.delete('/teams/:id/order', requireAuth, a(teams.cancelBuy));
r.get('/admin/users', requireAuth, requireDashboard, a(admin.users));
r.patch('/admin/users/:id', requireAuth, requireDashboard, validate(z.object({ account: z.enum(['normal', 'premium', 'admin', 'superadmin']) })), a(admin.setAccount));
r.get('/admin/countries', requireAuth, requireDashboard, a(admin.countries));
r.get('/admin/orders', requireAuth, requireDashboard, a(admin.orders));
r.patch('/admin/orders/:id', requireAuth, requireDashboard, validate(z.object({ status: z.enum(['approved', 'declined']) })), a(admin.decide));
r.patch('/cards/:id', requireAuth, validate(cardSchema.extend({ version: z.number().int().min(0) })), a(cards.update));
r.delete('/cards/:id', requireAuth, a(cards.remove)); r.get('/cards/:id/revisions', requireAuth, a(cards.revisions));
r.patch('/cards/:id/bookmark', requireAuth, validate(z.object({ bookmarked: z.boolean() })), a(cards.bookmark));
r.get('/media/:id', a(cards.image));
r.post('/reviews', requireAuth, validate(z.object({ cardId: idSchema, rating: z.enum(['again', 'hard', 'good', 'easy']), requestId: z.uuid(), version: z.number().int().min(0) })), a(study.review));
r.get('/stats', requireAuth, a(study.stats));
export default r;
