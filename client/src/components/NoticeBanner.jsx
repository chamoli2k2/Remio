import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Megaphone, X } from 'lucide-react';
import { useApp } from '../hooks/useApp';
import { BRAND } from '../../../shared/brand.js';

const STORE = `${BRAND.slug}:notice-dismissed`;

/**
 * Remembers which message was dismissed, not that one was.
 *
 * A flag saying "banner dismissed" would silence the next announcement too, which is how a sale
 * goes unseen by exactly the people who read the last one. Keyed on the text instead: a new
 * message is a message nobody has dismissed yet, and it comes back on its own.
 *
 * Trimmed to a length because localStorage is not the place for 240 characters, and a prefix of
 * the message is plenty to tell two of them apart.
 */
const keyFor = text => text.trim().slice(0, 80);
const readDismissed = () => { try { return localStorage.getItem(STORE) || ''; } catch { return ''; } };

/**
 * The strip across the top of every page.
 *
 * The message comes from the served configuration rather than the bundle, so changing it is a
 * setting rather than a deploy — which is the whole point of a banner announcing a sale that ends
 * on Friday. That also means it arrives a moment after first paint; it is deliberately not
 * reserved space, because a banner that is usually absent should not leave a gap when it is.
 */
export default function NoticeBanner() {
  const { config } = useApp();
  const text = (config.notice || '').trim();
  const [dismissed, setDismissed] = useState(readDismissed);

  if (!text || dismissed === keyFor(text)) return null;

  const offer = !!config.noticeOffer;
  const href = (config.noticeLink || '').trim();
  const external = href.startsWith('https://');

  const hide = () => {
    setDismissed(keyFor(text));
    try { localStorage.setItem(STORE, keyFor(text)); } catch { /* private mode: it reappears, which is the safer failure */ }
  };

  const label = <>
    {offer && <span className="notice-tag"><Megaphone size={12}/> Offer</span>}
    <span className="notice-text">{text}</span>
    {href && <span className="notice-go">{external ? 'Open' : 'See it'} <ArrowRight size={13}/></span>}
  </>;

  return <div className={`notice-banner ${offer ? 'is-offer' : ''}`} role="region" aria-label="Announcement">
    {href
      ? (external
        // rel is not optional on a target=_blank link: without noopener the page it opens can
        // reach back through window.opener and navigate this one.
        ? <a className="notice-body" href={href} target="_blank" rel="noopener noreferrer">{label}</a>
        : <Link className="notice-body" to={href}>{label}</Link>)
      : <span className="notice-body">{label}</span>}
    <button type="button" className="notice-close" onClick={hide} aria-label="Dismiss this announcement"><X size={15}/></button>
  </div>;
}
