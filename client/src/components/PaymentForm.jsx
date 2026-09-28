import { useState, useEffect, useMemo, useRef } from 'react';
import { Crown, ShieldCheck, MailCheck, X } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../services/api';
import { messageFor, ApiError } from '../services/errors';
import { loadCheckout } from '../services/razorpay';
import { useApp } from '../hooks/useApp';
import { useMoney } from '../hooks/useMoney';
import { Button, Field, ErrorState } from './ui';
import ConfirmEmailFirst from './ConfirmEmailFirst';
import { BRAND } from '../../../shared/brand.js';
import { countryByCode, countryByName, dialFor, composePhone } from '../../../shared/countries.js';
import CountryPicker from './CountryPicker';
// Inlined rather than linked. The gateway loads this from its own HTTPS page, so a hosted file has
// to be absolute, reachable, and already deployed, and it is silently dropped if any of those slip:
// over plain HTTP in development it is refused as mixed content. Carrying the bytes along cannot fail.
import logo from '../assets/checkout-logo.png?inline';

/** The gateway finds its container by selector, so the id has to be stable and only ever appear once. */
const EMBED_ID = 'gateway-embed';

/**
 * The one checkout form. Whatever is being bought, the difference is only which endpoints it posts
 * to and what extra fields ride along, so a personal plan and a pack of seats share every line of
 * the method picker, the billing fields, and the gateway handshake.
 */
export default function PaymentForm({ methods = [], amount, summary, instantLabel = 'Pay', checkoutPath, cancelPath, extra = {}, onDone, onMethodChange }) {
  const { user, setUser, refresh, config } = useApp();
  const { money } = useMoney();
  const [method, setMethod] = useState('');
  /**
   * The countries an invoice can be addressed to, which is not every country.
   *
   * Billing somewhere means being set up for its currency and the tax on it, and we are set up for
   * five places. Offering the other two hundred was the bug: the buyer picked one, filled in the
   * rest of the form, and only then found out it could not be taken. The list comes from the served
   * config rather than a constant so closing a market in the dashboard closes it here in the same
   * breath, and it is intersected with the priced countries because a market with no price list
   * cannot be charged in any currency.
   */
  const payable = useMemo(() => (config.selling || [])
    .map(code => countryByCode(code))
    .filter(c => c && c.region)
    .sort((a, b) => a.name.localeCompare(b.name)), [config.selling]);

  // Name comes from the account and the email is never asked for at all, so what is left is only
  // what we genuinely do not already know: how to ring them, and where they are.
  // Opens on the country the account is registered in, which is the one that priced this purchase,
  // falling back to whatever is on sale if that country is not somewhere we can bill.
  const [form, setForm] = useState(() => {
    const own = countryByName(user?.country)?.code;
    return { name: user?.name || '', country: payable.some(c => c.code === own) ? own : payable[0]?.code || '', phone: '', address: '' };
  });
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [embedded, setEmbedded] = useState(false);
  const gateway = useRef(null);

  useEffect(() => { if (methods.length && !methods.some(m => m.id === method)) setMethod(methods[0].id); }, [methods, method]);
  // A market can be closed while this form is sitting open. Falling back to one that is still on
  // sale beats posting a country the server is about to refuse.
  useEffect(() => {
    if (payable.length && !payable.some(c => c.code === form.country)) setForm(f => ({ ...f, country: payable[0].code }));
  }, [payable, form.country]);
  const active = methods.find(m => m.id === method) || null;
  useEffect(() => { onMethodChange?.(active); }, [active, onMethodChange]);

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      await payOnline();
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

  /**
   * Tears the gateway down and frees the order it reserved, so the next attempt is not blocked by
   * an abandoned one. Closing may itself trigger the gateway's dismiss callback, and our own close
   * button has to work even if it does not, so both routes lead here and only the first does the
   * work. Without that, one cancellation would fire two deletes.
   */
  function closeEmbed({ cancel = false } = {}) {
    const rz = gateway.current;
    gateway.current = null;
    setEmbedded(false);
    if (!rz) return;
    if (cancel && cancelPath) api(cancelPath, { method: 'DELETE' }).catch(() => {});
    rz.close?.();
  }

  /** The gateway owns the card form; we only hand it an order and verify the signature it returns. */
  async function payOnline() {
    const { checkout } = await api(checkoutPath, { method: 'POST', body: { ...billing(), ...extra, method: 'razorpay' } });
    const Razorpay = await loadCheckout();
    // The container is found by selector at open time, so it has to be painted before we ask.
    setEmbedded(true);
    await new Promise(paint => requestAnimationFrame(() => requestAnimationFrame(paint)));
    await new Promise((resolve, reject) => {
      const rz = new Razorpay({
        key: checkout.key, order_id: checkout.orderId, amount: checkout.amount, currency: checkout.currency,
        name: BRAND.name, description: checkout.description, image: logo,
        prefill: checkout.prefill,
        // Marked read-only because prefill on its own is only a suggestion: the gateway remembers
        // the last contact used on a device and shows that instead, so a number left over from
        // somebody else's checkout ends up on the payment. Both of these are already settled
        // before we get here — the phone came from the form and the address is the confirmed one on
        // the account — so there is nothing here for the buyer to decide, and one fewer step.
        readonly: { contact: true, email: true },
        theme: { color: '#5b53e8' },
        // Embedded rather than the default overlay. Left to itself the gateway covers the viewport
        // with an opaque backdrop of its own, which reads as being sent off to another site midway
        // through buying something. Handed a container, it renders inside ours instead, so the
        // order summary stays visible behind a dimmed page and paying stays a step within our own.
        parent: `#${EMBED_ID}`,
        handler: response => api('/premium/checkout/confirm', {
          method: 'POST',
          body: { orderId: response.razorpay_order_id, paymentId: response.razorpay_payment_id, signature: response.razorpay_signature },
        }).then(async () => {
          toast.success('Payment confirmed.');
          const me = await api('/auth/me').catch(() => null);
          if (me?.user) setUser(me.user);
          resolve();
        }, reject),
        modal: { ondismiss: () => { closeEmbed({ cancel: true }); reject(cancelled()); } },
      });
      gateway.current = rz;
      rz.on('payment.failed', r => reject(new ApiError(r?.error?.description || 'The payment did not go through. You were not charged.', { code: 'PAYMENT_FAILED' })));
      rz.open();
    }).finally(() => closeEmbed());
  }

  const cancelled = () => new ApiError('Payment cancelled. You were not charged.', { code: 'CHECKOUT_CANCELLED' });
  // Embedded, the gateway has no dismiss button of its own, so ours stands in for it.
  const giveUp = () => { closeEmbed({ cancel: true }); setError(messageFor(cancelled())); setBusy(false); };

  // The server refuses a purchase until the address is confirmed. Say so before the billing
  // details are typed out rather than rejecting them afterwards.
  if (user && !user.emailVerifiedAt) return <ConfirmEmailFirst className="premium-form">
    Your receipt goes to the address on your account, so we need to know it reaches you before taking a payment.
  </ConfirmEmailFirst>;

  return <form className="premium-form" onSubmit={submit}>
    {embedded && <div className="pay-embed-backdrop" role="dialog" aria-modal="true" aria-label="Payment">
      <div className="pay-embed">
        <div className="pay-embed-head">
          <span><ShieldCheck size={15}/> Secure payment</span>
          <button type="button" className="icon-button" onClick={giveUp} aria-label="Cancel payment"><X size={16}/></button>
        </div>
        <div id={EMBED_ID} className="pay-embed-frame"/>
      </div>
    </div>}
    <div className="premium-card-head premium-card-head-inline"><h2>Billing details</h2>{summary && <span className="plan-total">{summary}</span>}</div>
    {user?.email && <p className="pay-receipt"><MailCheck size={15}/><span>Your receipt goes to <strong>{user.email}</strong>, the confirmed address on your account.</span></p>}
    <div className="premium-grid">
      <Field label="Full name" hint="As it should read on the invoice."><input required maxLength={80} autoComplete="name" placeholder="Your name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}/></Field>
      <Field label="Country" hint="Where we can send an invoice. It does not change the price, which follows the country on your account.">
        <CountryPicker label="Billing country" options={payable} value={form.country} onChange={code => setForm(f => ({ ...f, country: code }))}/>
      </Field>
    </div>
    <Field label="Phone number" hint="The dialling code follows the country you picked.">
      <div className="pay-phone">
        <span className="pay-dial">{dialFor(form.country)}</span>
        <input required type="tel" inputMode="numeric" autoComplete="tel-national" minLength={6} maxLength={15} placeholder="98765 43210" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value.replace(/[^\d\s]/g, '') }))}/>
      </div>
    </Field>
    <Field label="Billing address" hint="Needed on the invoice for tax purposes."><textarea required minLength={6} maxLength={300} rows={2} autoComplete="street-address" placeholder="Street, city, and postal code" value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))}/></Field>
    {error && <ErrorState message={error}/>}
    <Button className="primary premium-submit" loading={busy} type="submit"><Crown size={16}/> {instantLabel}{amount ? ` · ${money(amount)}` : ''}</Button>
    <p className="premium-fineprint"><ShieldCheck size={14}/> Card details go straight to the payment gateway. {BRAND.name} never sees them.</p>
  </form>;
}
