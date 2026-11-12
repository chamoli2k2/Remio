/** Sizes, counts and lifetimes that tune how the server behaves. Change them here. */
import { DAY_MS, HOUR_MS, MINUTE_MS, SECOND_MS } from './time.js';

/* Email codes (signup, delete account) */
export const EMAIL_CODE_TTL_MS = 10 * MINUTE_MS;
export const EMAIL_CODE_RESEND_GAP_MS = MINUTE_MS;
export const EMAIL_CODE_MAX_SENDS_PER_HOUR = 5;
export const EMAIL_CODE_MAX_ATTEMPTS = 5;

/* Verification and reset links */
export const VERIFY_LINK_TTL_MS = DAY_MS;
export const RESET_LINK_TTL_MS = HOUR_MS;
export const LINK_RESEND_GAP_MS = MINUTE_MS;

/* Sessions */
export const ACCESS_TOKEN_TTL_S = 15 * 60;
export const REFRESH_TOKEN_TTL_MS = 30 * DAY_MS;
export const REFRESH_REUSE_GRACE_MS = 30 * SECOND_MS;
export const REFRESH_KEEP_PREVIOUS = 5;

/* Assistant access */
export const OAUTH_CODE_TTL_MS = 5 * MINUTE_MS;
export const AGENT_TOKEN_TOUCH_AFTER_MS = MINUTE_MS;

/* Studying */
export const MAX_STUDY_BATCH = 100;
export const STUDY_BACKDATE_MS = 7 * DAY_MS;
export const STUDY_ATTEMPTS = 3;

/* Content */
export const MAX_FOLDERS_PER_PROJECT = 40;
export const MAX_IMPORT_CARDS = 2000;
export const MAX_IMPORT_TEXT = 10000;
export const REVISIONS_KEPT = 20;
export const REVISION_GAP_MS = 5 * MINUTE_MS;

/* Images */
export const MAX_STORED_IMAGE_BYTES = 3 * 1024 * 1024;
export const MAX_FETCHED_IMAGE_BYTES = 3 * 1024 * 1024;
export const SIGNED_SECONDS = 600;
export const REDIRECT_CACHE_SECONDS = 240;
export const PUBLIC_SIGNED_SECONDS = 6 * 24 * 60 * 60;
export const PUBLIC_REDIRECT_CACHE_SECONDS = 5 * 24 * 60 * 60;

/* Caches */
export const GEO_CACHE_MAX = 5000;
export const GEO_CACHE_TTL_MS = 6 * HOUR_MS;
export const SSR_CACHE_TTL_MS = MINUTE_MS;
export const SSR_CACHE_MAX_ENTRIES = 200;

/* Live rooms */
export const ROOM_LIMITS = { minCards: 2, maxCards: 30, minSeconds: 5, maxSeconds: 60, maxPlayers: 50 };
export const ROOM_SCORE = { base: 1000, floor: 0.5, streakBonus: 100, streakCap: 500 };
