import { useEffect, useRef, useState } from 'react';
import { ApiError } from '../services/errors';
import { useApp } from '../hooks/useApp';
import { useTheme } from '../hooks/useTheme';

const SRC = 'https://accounts.google.com/gsi/client';
let pending = null;

/** Loads Google's script once, on the first auth page somebody opens rather than on every page. */
function loadGoogle() {
  if (window.google?.accounts?.id) return Promise.resolve(window.google);
  pending ||= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SRC; script.async = true; script.defer = true;
    script.onload = () => window.google?.accounts?.id
      ? resolve(window.google)
      : reject(new ApiError('Google sign-in did not load. Please try again.', { code: 'GOOGLE_UNAVAILABLE' }));
    script.onerror = () => { pending = null; reject(new ApiError('Could not load Google sign-in. Check your connection, or use your email and password.', { code: 'GOOGLE_UNAVAILABLE' })); };
    document.head.appendChild(script);
  });
  return pending;
}

/**
 * Google's own button, rendered by Google.
 *
 * It has to be their markup rather than ours: the styling, wording, and logo are fixed by their
 * brand terms, and a hand-made button that posts to the same endpoint would be a policy problem
 * rather than a design choice. So we hand them a container and get a signed token back.
 *
 * `onCredential` receives that token and nothing else. Everything about who this is gets decided
 * on the server, because a token is the only part of this the browser cannot forge.
 */
export default function GoogleButton({ onCredential, text = 'signin_with' }) {
  const { config } = useApp();
  const { theme } = useTheme();
  const slot = useRef(null);
  const [failed, setFailed] = useState('');
  // Kept in a ref so re-rendering with a new callback does not mean re-initialising Google.
  const handler = useRef(onCredential);
  handler.current = onCredential;

  const clientId = config.googleClientId;

  useEffect(() => {
    if (!clientId || !slot.current) return;
    let cancelled = false;
    loadGoogle().then(google => {
      if (cancelled || !slot.current) return;
      google.accounts.id.initialize({
        client_id: clientId,
        callback: response => handler.current?.(response.credential),
        // One Tap is deliberately off. It appears unbidden over the page, and on a form somebody is
        // already filling in it reads as an interruption rather than a shortcut.
        auto_select: false,
        cancel_on_tap_outside: true,
        use_fedcm_for_prompt: true,
      });
      google.accounts.id.renderButton(slot.current, {
        theme: theme === 'dark' ? 'filled_black' : 'outline',
        size: 'large', text, shape: 'pill', logo_alignment: 'center', width: 320,
      });
    }).catch(e => { if (!cancelled) setFailed(e.message); });
    return () => { cancelled = true; };
  }, [clientId, theme, text]);

  // Nothing at all when it is not configured, rather than a button that cannot work.
  if (!clientId) return null;
  return <div className="google-signin">
    <div ref={slot} className="google-signin-slot"/>
    {failed && <p className="google-signin-error">{failed}</p>}
    <span className="google-signin-divider"><span/>or<span/></span>
  </div>;
}
