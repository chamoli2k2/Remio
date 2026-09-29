import { useState } from 'react';
import { toast } from 'sonner';
import { ShieldCheck } from 'lucide-react';
import { personalisationRefused, refusePersonalisation } from './AdSlot';

/**
 * "Your privacy choices", as California requires when personal information is shared for
 * advertising.
 *
 * One click, and it stays clicked. There is deliberately no way to switch it back on: an opt-out
 * that can be reversed by a stray click is not much of an opt-out, and nobody has ever wanted to
 * ask to be profiled again.
 *
 * Shown to everyone rather than only to Californians, because working out who is Californian in
 * order to decide whether to offer them a privacy control is a worse trade than simply offering it
 * to all. If a visitor's browser already sends Global Privacy Control the choice is honoured
 * before this is ever clicked, and it reads as already done.
 */
export default function PrivacyChoice() {
  const [refused, setRefused] = useState(personalisationRefused);
  if (refused) return <span className="privacy-choice is-set"><ShieldCheck size={13}/> Not personalised</span>;
  return <button type="button" className="privacy-choice" onClick={() => {
    if (refusePersonalisation()) { setRefused(true); toast.success('Ads here will not be personalised for you.'); }
    else toast.error('Your browser would not let us store that. Try turning off private browsing.');
  }}>Your privacy choices</button>;
}
