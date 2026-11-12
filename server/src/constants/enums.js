/**
 * Every fixed set of values the API accepts or the database stores. Models, request validation and
 * services all read from here, so adding a value is a one-line change in this file.
 */

/* Accounts */
export const ACCOUNT_TYPES = ['normal', 'premium', 'admin', 'superadmin'];

/* Sharing and visibility */
export const VISIBILITY = ['private', 'global'];
/** What a member of a shared folder or notebook can be. 'remove' is a request, never stored. */
export const MEMBER_ROLES = ['viewer', 'editor'];
export const MEMBER_ROLE_CHANGES = [...MEMBER_ROLES, 'remove'];

/* Appearance of a folder, project or notebook cover */
export const COVER_COLORS = ['violet', 'blue', 'orange', 'green', 'pink', 'slate'];
export const COVER_ICONS = ['layers', 'code', 'globe', 'brain', 'book', 'flask', 'terminal', 'palette'];

/* Studying */
export const RATINGS = ['again', 'hard', 'good', 'easy'];
export const CARD_STATES = ['new', 'learning', 'review', 'relearning'];

/* Email codes and links */
export const AUTH_TOKEN_PURPOSES = ['verify-email', 'reset-password'];
export const EMAIL_CODE_PURPOSES = ['signup', 'delete-account'];

/* Teams */
export const TEAM_KINDS = ['classroom', 'team'];
export const TEAM_MEMBER_ROLES = ['owner', 'teacher', 'student'];
export const TEAM_INVITE_ROLES = ['teacher', 'student'];

/* Friends */
export const RELATIONSHIP_KINDS = ['follow', 'connect'];
export const RELATIONSHIP_STATUSES = ['active', 'pending'];

/* Billing */
export const ORDER_KINDS = ['personal', 'team-new', 'team-renew', 'team-seats'];
export const ORDER_METHODS = ['manual', 'razorpay'];
export const ORDER_STATUSES = ['pending', 'approved', 'declined'];
export const ORDER_DECISIONS = ['approved', 'declined'];

/* Moderation */
export const REPORT_REASONS = ['illegal', 'infringement', 'privacy', 'harmful', 'spam', 'other'];
export const REPORT_STATUSES = ['open', 'upheld', 'rejected'];
export const REPORT_DECISIONS = ['upheld', 'rejected'];

/* Assistant (agent) access */
export const AGENT_TOKEN_ORIGINS = ['personal', 'oauth'];
export const AGENT_BATCH_KINDS = ['cards', 'cover', 'edit', 'notes', 'noteedit'];
export const NOTE_REVISION_SOURCES = ['app', 'assistant'];
