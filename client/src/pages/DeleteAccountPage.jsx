import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Trash2, MailCheck, ShieldCheck, Clock3 } from 'lucide-react';
import { useApp } from '../hooks/useApp';
import { api } from '../services/api';
import { discard as discardReviews } from '../services/reviewSync';
import { Button, Field, ErrorState } from '../components/ui';
import SendCodeButton from '../components/SendCodeButton';
import { useCooldown, maskEmail } from '../hooks/useCooldown';
import { BRAND } from '../../../shared/brand.js';

const PHRASE = 'delete my account';

/**
 * Where anybody can ask for their account to be deleted, signed in or not. It is a public page on
 * purpose: an app store asks for a web address that explains how to do this, and a person who has
 * lost their password still has the right to leave.
 *
 * The proof is the mailbox. A six-digit code goes to the address on the account, and only the code
 * and the typed phrase together erase anything. Asking for a code looks the same whether or not the
 * address has an account, so this page cannot be used to find out who is a member.
 */
export default function DeleteAccountPage() {
  const { user, setUser } = useApp();
  const [email, setEmail] = useState(user?.email || ''), [code, setCode] = useState(''), [confirm, setConfirm] = useState('');
  const [step, setStep] = useState('email'), [busy, setBusy] = useState(false), [error, setError] = useState(''), [wait, startWait] = useCooldown();

  async function sendCode(e) {
    e?.preventDefault(); setBusy(true); setError('');
    try { const d = await api('/auth/delete-account/code', { method: 'POST', body: { email } }); setStep('code'); startWait(d.retryAfter || 60); }
    catch (err) { if (err.code === 'CODE_TOO_SOON') { setStep('code'); startWait(60); } setError(err.message); } finally { setBusy(false); }
  }
  async function erase(e) {
    e.preventDefault(); setBusy(true); setError('');
    try {
      await api('/auth/delete-account', { method: 'POST', body: { email, code, confirm } });
      discardReviews(); setStep('done');
      if (user) setUser(null);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  return <article className="legal delete-account">
    <header className="legal-head">
      <span className="eyebrow">YOUR DATA</span>
      <h1>Delete your {BRAND.name} account</h1>
      <p className="legal-lede">Ask for your {BRAND.name} account and the data in it to be erased. We confirm it is you with a code sent to your email.</p>
      <p className="legal-updated"><Clock3 size={14}/> Takes about a minute</p>
    </header>
    <div className="legal-body"><div className="legal-content">
      <section>
        <h2>How to delete your account</h2>
        <ol>
          <li>Enter the email address on your {BRAND.name} account below and ask for a code.</li>
          <li>Open the email we send you and copy the 6-digit code. It works once and expires in 10 minutes.</li>
          <li>Enter the code, type the confirmation phrase, and press delete.</li>
        </ol>
        <p>You can also do this signed in from Settings. If you cannot get to your email, write to <a href={`mailto:${BRAND.email.privacy}`}>{BRAND.email.privacy}</a> from the address on the account.</p>
      </section>
      <section>
        <h2>What is deleted and what is kept</h2>
        <ul>
          <li><strong>Deleted straight away:</strong> your account, collections, cards, notes, uploaded images, study history, and any connections you made to assistants.</li>
          <li><strong>Backups:</strong> copies roll off on their own within 30 days.</li>
          <li><strong>Kept:</strong> records of payments, for as long as Indian tax and accounting law requires, with your name, address and phone number stripped out. Security logs are kept briefly in a form that is not tied to your content.</li>
        </ul>
        <p>If you run a classroom other people are still in, hand it over or close it first, so their work does not go with you. Read the full <Link to="/privacy">Privacy Policy</Link>.</p>
      </section>
      <section className="delete-card">
        <h2>Delete it now</h2>
        {step === 'done'
          ? <div className="form-stack"><p><MailCheck size={18}/> Your account and its data have been deleted. We have emailed you a confirmation. Thank you for trying {BRAND.name}.</p><Link className="button secondary" to="/">Back to the home page</Link></div>
          : step === 'email'
            ? <form className="form-stack" onSubmit={sendCode}>
              <Field label="Email on your account"><input required type="email" autoComplete="email" maxLength={254} value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com"/></Field>
              {error && <ErrorState message={error}/>}
              <Button className="danger-button" type="submit" loading={busy}><ShieldCheck size={16}/> Email me a code</Button>
            </form>
            : <form className="form-stack" onSubmit={erase}>
              <p>If <strong>{maskEmail(email)}</strong> has an account, a 6-digit code is on its way. It lasts 10 minutes. Check your spam folder if it does not arrive.</p>
              <Field label="Code from the email"><input required inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} placeholder="123456"/></Field>
              <Field label={`Type "${PHRASE}" to confirm`}><input required value={confirm} onChange={e => setConfirm(e.target.value)} placeholder={PHRASE}/></Field>
              {error && <ErrorState message={error}/>}
              <div className="delete-actions">
                <Button type="button" onClick={() => { setStep('email'); setCode(''); setConfirm(''); setError(''); }}>Use a different email</Button>
                <SendCodeButton busy={busy} left={wait} sent onClick={sendCode} sentLabel="Send a new code"/>
                <Button className="danger-button" type="submit" loading={busy} disabled={confirm !== PHRASE || code.length !== 6}><Trash2 size={16}/> Delete my account and data</Button>
              </div>
            </form>}
      </section>
    </div></div>
  </article>;
}
