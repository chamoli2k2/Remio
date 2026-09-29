import { useEffect, useRef, useState } from 'react';
import { useApp } from '../hooks/useApp';
import { hasPremium } from '../../../shared/account.js';
import { BRAND } from '../../../shared/brand.js';

const SCRIPT = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js';
const OPT_OUT = `${BRAND.slug}:no-personalised-ads`;

/**
 * Whether this browser has asked not to be profiled.
 *
 * Two signals, and both are honoured. Global Privacy Control is a header and a browser property
 * that says "do not sell or share my data"; California treats it as a valid opt-out request, so
 * ignoring it is not an option. The stored flag is our own link, for people whose browser does not
 * send GPC.
 */
export const personalisationRefused = () => {
  try {
    if (navigator.globalPrivacyControl === true) return true;
    return localStorage.getItem(OPT_OUT) === '1';
  } catch { return true; }
};

/** Set by the footer link. Refusing is remembered; there is no way to un-refuse by accident. */
export const refusePersonalisation = () => {
  try { localStorage.setItem(OPT_OUT, '1'); return true; } catch { return false; }
};

let scriptFor = null;

/**
 * Loads the ad script once, and only for a visitor who is actually going to be shown an ad.
 *
 * Nothing about advertising reaches the page until this runs — no script, no cookie, no request to
 * Google — which is what makes the country and Premium gates real rather than cosmetic.
 */
function loadAds(publisherId, personalised) {
  if (scriptFor === publisherId) return;
  scriptFor = publisherId;
  // Set before the script runs, because it reads this as it initialises. After is too late.
  window.adsbygoogle = window.adsbygoogle || [];
  if (!personalised) window.adsbygoogle.requestNonPersonalizedAds = 1;
  const script = document.createElement('script');
  script.src = `${SCRIPT}?client=${encodeURIComponent(publisherId)}`;
  script.async = true;
  script.crossOrigin = 'anonymous';
  document.head.appendChild(script);
}

/**
 * One advertisement, in a place we have decided an advertisement belongs.
 *
 * Four things all have to be true, and any one of them turns this into nothing at all:
 *
 *  - advertising is switched on, with a publisher and a unit configured;
 *  - the server placed this visitor in a country on the list;
 *  - this placement is enabled;
 *  - the account is not Premium.
 *
 * That last one is the point of the whole feature for a paying customer: buying Premium buys the
 * absence of this. It is checked here rather than on the server because the config endpoint is
 * deliberately unauthenticated.
 *
 * The space is reserved before anything loads. An ad that pushes the page down as it arrives is
 * the single most irritating thing on the web, and it is also what turns a Cumulative Layout Shift
 * of zero into a bad score.
 */
export default function AdSlot({ placement, label = 'Advertisement' }) {
  const { config, user } = useApp();
  const slot = useRef(null);
  const pushed = useRef(false);
  const [failed, setFailed] = useState(false);

  const ads = config.ads || {};
  const shown = !!ads.eligible && !!ads.placements?.[placement] && !hasPremium(user);
  const personalised = !!ads.personalised && !personalisationRefused();

  useEffect(() => {
    if (!shown || pushed.current || !slot.current) return;
    try {
      loadAds(ads.publisherId, personalised);
      // AdSense fills the <ins> when it is pushed. Once per element: pushing twice draws twice and
      // is a policy violation rather than a bug.
      (window.adsbygoogle = window.adsbygoogle || []).push({});
      pushed.current = true;
    } catch { setFailed(true); }
  }, [shown, personalised, ads.publisherId]);

  if (!shown || failed) return null;

  return <aside className="ad-slot" aria-label={label}>
    <span className="ad-slot-label">{label}</span>
    <ins
      ref={slot}
      className="adsbygoogle ad-slot-unit"
      style={{ display: 'block' }}
      data-ad-client={ads.publisherId}
      data-ad-slot={ads.slotId}
      data-ad-format="horizontal"
      data-full-width-responsive="true"
    />
  </aside>;
}
