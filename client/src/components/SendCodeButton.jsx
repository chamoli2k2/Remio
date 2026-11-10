import { Button } from './ui';

/**
 * The button that emails a code. It says what it is doing: "Sending…" while the request is out,
 * then "Resend in 42s" and disabled until the wait is over, so nobody taps it into the server's limit.
 */
export default function SendCodeButton({ onClick, busy, left, sent, className = '', idleLabel = 'Send code', sentLabel = 'Resend code' }) {
  const waiting = left > 0;
  return <Button type="button" className={className} loading={busy} disabled={busy || waiting} onClick={onClick} aria-live="polite">
    {busy ? 'Sending…' : waiting ? `Resend in ${left}s` : sent ? sentLabel : idleLabel}
  </Button>;
}
