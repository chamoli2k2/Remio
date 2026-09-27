import { useState } from 'react';
import { Crown, Check, Clock3, Sparkles, ShieldCheck } from 'lucide-react';
import { api } from '../services/api';
import { useApp, useQuery } from '../hooks/useApp';
import { Button, Loading } from '../components/ui';
import PaymentForm from '../components/PaymentForm';
import { hasPremium, PREMIUM_FEATURES, PREMIUM_PLANS, planById } from '../../../shared/account.js';
import { BRAND } from '../../../shared/brand.js';
const money = n => `₹${n.toLocaleString('en-IN')}`;
const perMonth = plan => `${money(Math.round(plan.price / (plan.days / 30)))}/mo`;

/**
 * What is being bought and what happens after paying. The caller supplies the line items because a
 * personal plan and a pack of seats are priced differently, but everything else is shared.
 */
export function PaymentAside({ amount, lines = [], steps = [] }) {
  return <aside className="premium-aside">
    <div className="premium-pay-card">
      <span className="premium-pay-label">ORDER SUMMARY</span>
      <dl className="pay-lines">{lines.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
      <div className="pay-total"><span>Total due today</span><strong className="premium-amount">{money(amount || 0)}</strong></div>
      <p className="premium-pay-note">One payment for the whole term. Nothing renews automatically and we hold no mandate against your card.</p>
    </div>
    <div className="premium-pay-card premium-pay-card-quiet">
      <span className="premium-pay-label">WHAT HAPPENS NEXT</span>
      <ol className="premium-steps">{steps.map((s, i) => <li key={s}><span>{i + 1}</span> {s}</li>)}</ol>
      <p className="pay-trust"><ShieldCheck size={14}/> Cards, UPI, net banking, and wallets, handled by Razorpay. {BRAND.name} never sees your card details.</p>
    </div>
  </aside>;
}

const STEPS = ['Confirm your billing details.', 'Pay in the secure Razorpay window.', 'Premium turns on right away.'];

export default function PremiumPage() {
  const { user } = useApp();
  const unlocked = hasPremium(user);
  const { data, loading, refetch } = useQuery('/premium/order', () => api('/premium/order').catch(() => ({ order: null, subscription: null, methods: [] })));
  const [plan, setPlan] = useState('yearly');
  const [dropping, setDropping] = useState(false);
  const order = data?.order, sub = data?.subscription, methods = data?.methods || [];
  const chosen = planById(plan);
  // Every plan buys the same thing, so the only honest reason to pick a longer one is the rate.
  const monthly = PREMIUM_PLANS.find(p => p.id === 'monthly');
  const saving = p => Math.round(100 - (p.price / (p.days / 30)) / monthly.price * 100);
  return <>
    <section className="premium-hero">
      <div>
        <span className="premium-badge"><Crown size={13}/> {BRAND.name.toUpperCase()} PREMIUM</span>
        <h1>{unlocked ? 'You have Premium.' : 'Study with the full toolkit.'}</h1>
        <p>{unlocked ? 'Projects, imports, live quizzes, folder covers, and editor invites are unlocked on this account.' : 'Keep the free library exactly as it is, and add the six tools below.'}</p>
        {unlocked && <span className="premium-plan"><Check size={14}/> {sub?.planLabel || user.account} · {sub?.expiresAt ? `${sub.daysLeft} day${sub.daysLeft === 1 ? '' : 's'} left` : 'never expires'}</span>}
      </div>
      <div className="premium-hero-art" aria-hidden="true"><Crown size={78}/></div>
    </section>
    <div className="premium-section-head"><h2>What Premium unlocks</h2><span>{PREMIUM_FEATURES.length} features</span></div>
    <ul className="premium-feature-list">{PREMIUM_FEATURES.map(f => <li key={f.id}><span className="premium-feature-icon"><Sparkles size={15}/></span><div><strong>{f.label}</strong><p>{f.detail}</p></div></li>)}</ul>
    {unlocked ? null : loading ? <Loading/> : order?.status === 'pending' ? <section className="premium-pending">
      <span className="premium-pending-icon"><Clock3 size={22}/></span>
      <div><h2>Waiting for confirmation</h2><p>{order.method === 'manual'
        ? `Your ${planById(order.plan)?.label || 'Premium'} request and payment screenshot are with our team. Premium turns on as soon as the transfer is verified.`
        : `Your ${planById(order.plan)?.label || 'Premium'} payment is still settling with the gateway. Premium turns on as soon as it clears, usually within a minute.`}</p></div>
      {order.hasProof && <a href={`/api/premium/orders/${order.id}/proof`} target="_blank" rel="noreferrer"><img className="proof-preview" src={`/api/premium/orders/${order.id}/proof`} alt="Your payment screenshot"/></a>}
      {/* Closing the gateway window usually means changing your mind, but the order it left behind
          would otherwise sit here with no way past it. A screenshot under review is different: an
          admin may be halfway through it, so that one is left alone. */}
      {order.method !== 'manual' && <Button className="ghost" loading={dropping} onClick={async () => {
        setDropping(true);
        try { await api('/premium/order', { method: 'DELETE' }); refetch(); } finally { setDropping(false); }
      }}>Start over</Button>}
    </section> : <div className="premium-checkout">
      <div className="premium-form-wrap">
        <div className="premium-card-head"><h2>Choose a plan</h2><p>Every plan unlocks the same features. Longer plans simply cost less per month.</p></div>
        <div className="plan-picker" role="radiogroup" aria-label="Premium plan">{PREMIUM_PLANS.map(p => <label key={p.id} className={`plan-option ${plan === p.id ? 'is-chosen' : ''}`}>
          <input type="radio" name="plan" value={p.id} checked={plan === p.id} onChange={() => setPlan(p.id)}/>
          <span className="plan-top"><strong>{p.label}</strong>{saving(p) >= 5 && <span className="plan-tag">Save {saving(p)}%</span>}</span>
          <span className="plan-price">{money(p.price)}</span>
          <span className="plan-term">{perMonth(p)} · {p.days} days</span>
          <span className="plan-blurb">{p.blurb}</span>
        </label>)}</div>
        <PaymentForm
          methods={methods}
          amount={chosen?.price}
          summary={chosen ? `${chosen.label} · ${money(chosen.price)}` : ''}
          extra={{ plan }}
          manualPath="/premium/order"
          checkoutPath="/premium/checkout"
          cancelPath="/premium/order"
        />
      </div>
      <PaymentAside
        amount={chosen?.price}
        lines={chosen ? [[chosen.label, money(chosen.price)], ['Access for', `${chosen.days} days`], ['Works out at', perMonth(chosen)]] : []}
        steps={STEPS}
      />
    </div>}
  </>;
}
