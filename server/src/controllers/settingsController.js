import * as settings from '../services/settingsService.js';
import * as geo from '../services/geo.js';
import { countryByCode } from '../../../shared/countries.js';
import { SETTINGS, SETTING_GROUPS } from '../../../shared/settings.js';

/**
 * What the browser needs to render honest prices and respect the switches.
 *
 * Unauthenticated on purpose: the pricing page is public, and a signed-out visitor should see the
 * same figures as everyone else. Nothing here is a secret — it is the price list, which is meant to
 * be read, and a set of booleans describing what is switched on.
 */
export const publicConfig = async (req, res) => {
  // Short and private rather than no-store: config changes rarely, and the alternative is every
  // page load waiting on a settings round trip. A minute is short enough that an operator flipping
  // a switch sees it take effect while they are still looking at the page. `private` matters more
  // than it used to now that the answer varies by visitor — see the country below.
  res.set('Cache-Control', 'private, max-age=60');
  const config = settings.publicConfig();

  /**
   * Where we think this request is from, and what follows from it.
   *
   * `country` is a suggestion for the signup form, nothing more: it is null when we cannot tell,
   * so the client can distinguish a guess from a default, and the visitor can always overrule it.
   *
   * Whether ads are eligible is decided here rather than in the browser because only the server
   * sees the address. The browser still has the final say on the other half of the question — a
   * Premium account sees no ads wherever it is — which it knows and the server would have to look
   * up on a request that is deliberately unauthenticated.
   */
  const detected = await geo.countryCodeFor(req).catch(() => null);
  const eligible = !!config.ads.publisherId && !!config.ads.slotId && !!detected && config.ads.countries.includes(detected);

  res.json({
    ...config,
    country: detected ? countryByCode(detected)?.name || null : null,
    ads: { ...config.ads, eligible, countries: undefined },
  });
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
