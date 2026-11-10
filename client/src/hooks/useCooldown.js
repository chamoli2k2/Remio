import { useCallback, useEffect, useState } from 'react';

/** A countdown in whole seconds. `start(n)` begins it; `left` is 0 once it is over. Used to hold a "send again" button. */
export function useCooldown() {
  const [until, setUntil] = useState(0), [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (until <= Date.now()) return undefined;
    const id = setInterval(() => { setNow(Date.now()); if (Date.now() >= until) clearInterval(id); }, 500);
    return () => clearInterval(id);
  }, [until]);
  const start = useCallback((seconds = 60) => { setNow(Date.now()); setUntil(Date.now() + seconds * 1000); }, []);
  return [Math.max(0, Math.ceil((until - now) / 1000)), start];
}

/** "jane.doe@gmail.com" becomes "ja•••@gmail.com", enough to recognise the mailbox without printing the address. */
export const maskEmail = email => String(email || '').replace(/^(.{1,2})[^@]*(@.*)$/, '$1•••$2');
