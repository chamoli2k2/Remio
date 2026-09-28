import * as settings from '../services/settingsService.js';
import { SETTINGS, SETTING_GROUPS } from '../../../shared/settings.js';

/**
 * What the browser needs to render honest prices and respect the switches.
 *
 * Unauthenticated on purpose: the pricing page is public, and a signed-out visitor should see the
 * same figures as everyone else. Nothing here is a secret — it is the price list, which is meant to
 * be read, and a set of booleans describing what is switched on.
 */
export const publicConfig = async (_req, res) => {
  // Short and private rather than no-store: config changes rarely, and the alternative is every
  // page load waiting on a settings round trip. A minute is short enough that an operator flipping
  // a switch sees it take effect while they are still looking at the page.
  res.set('Cache-Control', 'private, max-age=60');
  res.json(settings.publicConfig());
};

/** The catalog and the current values, which together are enough to build the admin form. */
export const readSettings = async (_req, res) => res.json({
  groups: SETTING_GROUPS,
  // The specs travel with their own labels, bounds, and help text, so the form is generated rather
  // than written twice. Functions cannot cross the wire, so option lists are resolved here.
  specs: Object.fromEntries(Object.entries(SETTINGS).map(([key, spec]) => [key, {
    ...spec, options: typeof spec.options === 'function' ? spec.options() : spec.options,
  }])),
  ...settings.adminSettings(),
});

export const writeSettings = async (req, res) => res.json(await settings.updateSettings(req.user, req.body.values, { note: req.body.note }));
export const resetSettings = async (req, res) => res.json(await settings.resetSettings(req.user, req.body.keys));
export const audit = async (req, res) => res.json({ entries: await settings.listAudit({ limit: req.query.limit, action: req.query.action }) });
