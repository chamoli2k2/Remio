import { Setting, AuditEntry } from '../models/index.js';
import { clientId as googleClientId, isConfigured as googleConfigured } from './auth/googleToken.js';
import { DEFAULT_REGIONS, pricebook } from '../../../shared/pricing.js';
import { PREMIUM_PLANS } from '../../../shared/account.js';
import { TEAM_PLANS } from '../../../shared/teams.js';
import { SETTING_KEYS, parseSettings, settingConflicts, settingFallbacks, settingSpec } from '../../../shared/settings.js';
import { assert } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

/**
 * The live configuration, and the only thing that should ever answer "what is this set to".
 *
 * Settings are read on nearly every request — a rate limit, an upload cap, a price — so they are
 * held in memory and refreshed when something writes, rather than fetched each time. The cost of
 * that is one process holding a copy, so a second instance would go on serving the old value until
 * it restarted. Worth knowing before scaling out; see `reload` for the way out of it.
 */
let cache = settingFallbacks();
let loadedAt = 0;

/** Overrides layered onto the fallbacks. Unknown keys are dropped, which is how a setting is retired. */
function merge(rows) {
  const next = settingFallbacks();
  for (const row of rows) if (SETTING_KEYS.includes(row.key)) next[row.key] = row.value;
  return next;
}

/**
 * Reads the stored overrides into memory. Called once at boot and after every write.
 *
 * A failure here is deliberately not fatal. Settings are all fallback-able by construction, so a
 * database that is slow to come up should leave the app running on its shipped defaults rather than
 * refusing to start — the alternative is a configuration table taking the whole site down.
 */
export async function reload() {
  try {
    cache = merge(await Setting.find().lean());
    loadedAt = Date.now();
  } catch (error) {
    logger.error('settings could not be read; running on shipped defaults', { error });
  }
  return cache;
}

/** One setting's effective value. */
export const setting = key => cache[key];
/** Every effective value, as a plain object. */
export const settings = () => ({ ...cache });
export const settingsLoadedAt = () => loadedAt;

/** Millisecond forms of the few settings stored in friendlier units. */
export const megabytes = key => setting(key) * 1024 * 1024;

/**
 * A pricebook built from the live settings.
 *
 * Assembled on each call rather than memoised: it is a handful of object spreads, and a stale price
 * is a worse bug than a cheap one. Everything that quotes or charges money goes through this.
 */
export function livePricebook() {
  const regions = Object.fromEntries(Object.entries(DEFAULT_REGIONS).map(([id, region]) => [id, {
    ...region,
    premium: Object.fromEntries(PREMIUM_PLANS.map(p => [p.id, setting(`price.${id}.${p.id}`) ?? region.premium[p.id]])),
    perSeat: Object.fromEntries(TEAM_PLANS.map(p => [p.id, setting(`seat.${id}.${p.id}`) ?? region.perSeat[p.id]])),
  }]));
  const planDays = Object.fromEntries([...PREMIUM_PLANS, ...TEAM_PLANS].map(p => [p.id, setting(`days.${p.id}`) ?? p.days]));
  return pricebook({ regions, selling: setting('selling.countries'), planDays });
}

/**
 * What the browser is allowed to know: prices, what is switched on, and the limits the UI enforces
 * before the server does. Deliberately a hand-written list rather than everything, because a
 * throttle or a seat bound is nobody's business but ours and this response is public.
 */
export function publicConfig() {
  const book = livePricebook();
  return {
    regions: book.regions,
    selling: book.selling,
    planDays: Object.fromEntries([...PREMIUM_PLANS, ...TEAM_PLANS].map(p => [p.id, setting(`days.${p.id}`)])),
    flags: {
      signupOpen: setting('signup.open'),
      explorePublic: setting('explore.public'),
      imports: setting('imports.enabled'),
      quiz: setting('quiz.enabled'),
      readOnly: setting('maintenance.readOnly'),
      razorpay: setting('selling.razorpay'),
      google: googleConfigured(),
    },
    googleClientId: googleClientId(),
    notice: setting('maintenance.notice'),
    noticeLink: setting('maintenance.noticeLink'),
    noticeOffer: setting('maintenance.noticeOffer'),
    // The country question is answered per request in the controller, which is what decides
    // `eligible`. Everything here is the same for everybody.
    ads: {
      countries: setting('ads.countries'),
      publisherId: setting('ads.enabled') ? setting('ads.publisherId') : '',
      slotId: setting('ads.enabled') ? setting('ads.slotId') : '',
      personalised: setting('ads.personalised'),
      placements: {
        explore: setting('ads.onExplore'),
        publicFolder: setting('ads.onPublicFolder'),
        library: setting('ads.onLibrary'),
        afterStudy: setting('ads.afterStudy'),
      },
    },
    limits: {
      imageMb: setting('limits.imageMb'),
      importMb: setting('limits.importMb'),
      importCards: setting('limits.importCards'),
      cardText: setting('limits.cardText'),
      projectFolders: setting('limits.projectFolders'),
      dailyGoalMax: setting('limits.dailyGoalMax'),
      minSeats: setting('teams.minSeats'),
      maxSeats: setting('teams.maxSeats'),
    },
  };
}

/** The catalog plus current values, for the admin form. Specs carry their own labels and bounds. */
export function adminSettings() {
  return {
    values: settings(),
    overridden: SETTING_KEYS.filter(k => cache[k] !== settingFallbacks()[k]),
    fallbacks: settingFallbacks(),
  };
}

/**
 * Applies a patch, all of it or none of it.
 *
 * Validation happens twice on purpose: each field against its own declaration, then the result
 * against the cross-field rules, judged on the settings as they would be afterwards rather than on
 * the patch alone. Changing one half of a pair should be checked against the half already stored.
 */
export async function updateSettings(actor, patch, { note = '' } = {}) {
  const { values, errors, ok } = parseSettings(patch);
  assert(ok, 400, 'Some of those values cannot be used.', 'SETTINGS_INVALID', { details: errors });

  const conflicts = settingConflicts({ ...cache, ...values });
  assert(!Object.keys(conflicts).length, 400, 'Those values conflict with each other.', 'SETTINGS_CONFLICT', { details: conflicts });

  // Only what actually moved is written or recorded, so saving a form without touching it leaves no
  // trail and the audit log stays a list of real changes.
  const changed = Object.entries(values).filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(cache[key]));
  if (!changed.length) return { changed: [], settings: settings() };

  const before = Object.fromEntries(changed.map(([key]) => [key, cache[key]]));
  await Setting.bulkWrite(changed.map(([key, value]) => ({
    updateOne: { filter: { key }, update: { $set: { key, value, updatedBy: actor?.id || null } }, upsert: true },
  })));
  await reload();
  await record(actor, 'settings.update', {
    target: changed.map(([key]) => key).join(', '),
    before,
    after: Object.fromEntries(changed),
    note,
  });
  logger.info('settings changed', { keys: changed.map(([k]) => k).join(','), actor: actor?.username });
  return { changed: changed.map(([key]) => key), settings: settings() };
}

/** Drops overrides so those keys go back to the value the code ships with. */
export async function resetSettings(actor, keys) {
  const wanted = (Array.isArray(keys) ? keys : []).filter(k => settingSpec(k));
  assert(wanted.length, 400, 'Name at least one setting to reset.', 'NOTHING_TO_RESET');
  const before = Object.fromEntries(wanted.map(k => [k, cache[k]]));
  await Setting.deleteMany({ key: { $in: wanted } });
  await reload();
  await record(actor, 'settings.reset', { target: wanted.join(', '), before, after: Object.fromEntries(wanted.map(k => [k, cache[k]])) });
  return { reset: wanted, settings: settings() };
}

/**
 * Writes one line to the audit log.
 *
 * Never allowed to fail the thing it is recording. An audit write that throws would turn a
 * successful change into an error the operator would reasonably retry, and the second attempt would
 * look like a no-op — worse than a missing line.
 */
export async function record(actor, action, { target = '', before = null, after = null, note = '' } = {}) {
  try {
    await AuditEntry.create({ actor: actor?.id || null, actorName: actor?.username || '', action, target, before, after, note });
  } catch (error) {
    logger.error('audit entry could not be written', { error, action });
  }
}

export async function listAudit({ limit = 80, action = '' } = {}) {
  const filter = action ? { action } : {};
  const rows = await AuditEntry.find(filter).sort({ createdAt: -1 }).limit(Math.min(Math.max(Number(limit) || 80, 1), 500)).lean();
  return rows.map(r => ({
    id: String(r._id), action: r.action, target: r.target, note: r.note,
    actor: r.actorName || 'system', before: r.before, after: r.after, at: r.createdAt,
  }));
}
