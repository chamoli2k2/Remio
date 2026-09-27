import { useState, useEffect } from 'react';
import { Crown, ImageUp, ImageOff, ShieldCheck, Zap, Banknote, MailCheck } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../services/api';
import { messageFor, ApiError } from '../services/errors';
import { loadCheckout } from '../services/razorpay';
import { useApp } from '../hooks/useApp';
import { Button, Field, ErrorState } from './ui';
import ConfirmEmailFirst from './ConfirmEmailFirst';
import { BRAND } from '../../../shared/brand.js';
import { COUNTRIES, DEFAULT_COUNTRY, countryByCode, dialFor, composePhone } from '../../../shared/countries.js';

const METHOD_ICONS = { razorpay: Zap, manual: Banknote };
const money = n => `₹${(n || 0).toLocaleString('en-IN')}`;

/**
 * The one checkout form. Whatever is being bought, the difference is only which endpoints it posts
 * to and what extra fields ride along, so a personal plan and a pack of seats share every line of
 * the method picker, the billing fields, and the gateway handshake.
 */
export default function PaymentForm({ methods = [], amount, summary, label = 'Submit request', instantLabel = 'Pay', manualPath, checkoutPath, cancelPath, extra = {}, onDone, onMethodChange }) {
  const { user, setUser, refresh } = useApp();
  const [method, setMethod] = useState('');
  // Name comes from the account and the email is never asked for at all, so what is left is only
  // what we genuinely do not already know: how to ring them, and where they are.
  const [form, setForm] = useState({ name: user?.name || '', country: DEFAULT_COUNTRY, phone: '', address: '' });
  const [proof, setProof] = useState(null), [preview, setPreview] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');

  useEffect(() => { if (methods.length && !methods.some(m => m.id === method)) setMethod(methods[0].id); }, [methods, method]);
  const active = methods.find(m => m.id === method) || null;
  useEffect(() => { onMethodChange?.(active); }, [active, onMethodChange]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  function pickProof(file) {
    if (file && !/^image\/(png|jpeg|webp)$/.test(file.type)) { setError('Use a JPG, PNG, or WebP image.'); return; }
    setError('');
    setProof(file || null);
    setPreview(old => { if (old) URL.revokeObjectURL(old); return file ? URL.createObjectURL(file) : ''; });
  }

  async function submit(e) {
    e.preventDefault();
    if (active?.requiresProof && !proof) { setError('Attach a screenshot of the UPI payment.'); return; }
    setBusy(true); setError('');
    try {
      if (method === 'razorpay') await payOnline(); else { await payManual(); toast.success('Request sent with your payment photo.'); }
      refresh(); onDone?.();
    } catch (err) { setError(messageFor(err)); } finally { setBusy(false); }
  }

  /** What the server wants: a country name it recognises and one unbroken dialling string. */
  const billing = () => ({
    name: form.name,
    country: countryByCode(form.country)?.name || '',
    phone: composePhone(form.country, form.phone),
    address: form.address,
  });

  async function payManual() {
    const body = new FormData();
    Object.entries({ ...billing(), ...extra, method: 'manual' }).forEach(([k, v]) => body.append(k, v));
    body.append('proof', proof);
    await api(manualPath, { method: 'POST', body });
  }

  /** The gateway owns the card form; we only hand it an order and verify the signature it returns. */
  async function payOnline() {
    const { checkout } = await api(checkoutPath, { method: 'POST', body: { ...billing(), ...extra, method: 'razorpay' } });
    const Razorpay = await loadCheckout();
    await new Promise((resolve, reject) => {
      const rz = new Razorpay({
        key: checkout.key, order_id: checkout.orderId, amount: checkout.amount, currency: checkout.currency,
        name: BRAND.name, description: checkout.description, image: checkout.image,
        prefill: checkout.prefill, theme: { color: '#5b53e8' },
        handler: response => api('/premium/checkout/confirm', {
          method: 'POST',
          body: { orderId: response.razorpay_order_id, paymentId: response.razorpay_payment_id, signature: response.razorpay_signature },
        }).then(async () => {
          toast.success('Payment confirmed.');
          const me = await api('/auth/me').catch(() => null);
          if (me?.user) setUser(me.user);
          resolve();
        }, reject),
        modal: { ondismiss: () => { if (cancelPath) api(cancelPath, { method: 'DELETE' }).catch(() => {}); reject(new ApiError('Payment cancelled. You were not charged.', { code: 'CHECKOUT_CANCELLED' })); } },
      });
      rz.on('payment.failed', r => reject(new ApiError(r?.error?.description || 'The payment did not go through. You were not charged.', { code: 'PAYMENT_FAILED' })));
      rz.open();
    });
  }

  // The server refuses a purchase until the address is confirmed. Say so before the billing
  // details are typed out rather than rejecting them afterwards.
  if (user && !user.emailVerifiedAt) return <ConfirmEmailFirst className="premium-form">
    Your receipt goes to the address on your account, so we need to know it reaches you before taking a payment.
  </ConfirmEmailFirst>;

  return <form className="premium-form" onSubmit={submit}>
    {methods.length > 1 && <>
      <div className="premium-card-head premium-card-head-inline"><h2>How would you like to pay?</h2></div>
      <div className="pay-picker" role="radiogroup" aria-label="Payment method">{methods.map(m => {
        const Icon = METHOD_ICONS[m.id] || Banknote;
        return <label key={m.id} className={`pay-option ${method === m.id ? 'is-chosen' : ''}`}>
          <input type="radio" name="method" value={m.id} checked={method === m.id} onChange={() => setMethod(m.id)}/>
          <span className="pay-icon"><Icon size={16}/></span>
          <span className="pay-text"><strong>{m.label}</strong><small>{m.blurb}</small></span>
          {m.instant && <span className="plan-tag">Instant</span>}
        </label>;
      })}</div>
    </>}
    <div className="premium-card-head premium-card-head-inline"><h2>Billing details</h2>{summary && <span className="plan-total">{summary}</span>}</div>
    {user?.email && <p className="pay-receipt"><MailCheck size={15}/><span>Your receipt goes to <strong>{user.email}</strong>, the confirmed address on your account.</span></p>}
    <div className="premium-grid">
      <Field label="Full name" hint="As it should read on the invoice."><input required maxLength={80} autoComplete="name" placeholder="Your name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}/></Field>
      <Field label="Country"><select required autoComplete="country" value={form.country} onChange={e => setForm(f => ({ ...f, country: e.target.value }))}>{COUNTRIES.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}</select></Field>
    </div>
    <Field label="Phone number" hint="The dialling code follows the country you picked.">
      <div className="pay-phone">
        <span className="pay-dial">{dialFor(form.country)}</span>
        <input required type="tel" inputMode="numeric" autoComplete="tel-national" minLength={6} maxLength={15} placeholder="98765 43210" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value.replace(/[^\d\s]/g, '') }))}/>
      </div>
    </Field>
    <Field label="Billing address" hint="Needed on the invoice for tax purposes."><textarea required minLength={6} maxLength={300} rows={2} autoComplete="street-address" placeholder="Street, city, and postal code" value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))}/></Field>
    {active?.requiresProof && <>
      <div className="premium-card-head premium-card-head-inline"><h2>Proof of payment</h2><span className="premium-required">Required</span></div>
      <label className={`dropzone proof-dropzone ${proof ? 'has-file' : ''}`} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); pickProof(e.dataTransfer.files[0]); }}>
        <input type="file" accept="image/png,image/jpeg,image/webp" onChange={e => pickProof(e.target.files[0])}/>
        {preview ? <img className="proof-preview" src={preview} alt="Payment screenshot preview"/> : <span className="dropzone-icon"><ImageUp size={22}/></span>}
        <strong>{proof ? proof.name : 'Add your payment screenshot'}</strong>
        <small>{proof ? 'Click or drop another image to replace it.' : 'Drag an image here, or click to browse. JPG, PNG, or WebP.'}</small>
      </label>
      {proof && <button type="button" className="text-button proof-clear" onClick={() => pickProof(null)}><ImageOff size={14}/> Remove image</button>}
    </>}
    {error && <ErrorState message={error}/>}
    <Button className="primary premium-submit" loading={busy} type="submit"><Crown size={16}/> {active?.instant ? instantLabel : label}{amount ? ` · ${money(amount)}` : ''}</Button>
    <p className="premium-fineprint"><ShieldCheck size={14}/> {active?.requiresProof ? 'Your screenshot is private. Only you and an admin can open it.' : `Card details go straight to the payment gateway. ${BRAND.name} never sees them.`}</p>
  </form>;
}
