import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Check, Sparkles, Users } from 'lucide-react';
import { useApp } from '../hooks/useApp';
import Select from '../components/Select';
import { PREMIUM_FEATURES, PREMIUM_PLANS } from '../../../shared/account.js';
import { SEATS, TEAM_PLANS } from '../../../shared/teams.js';
import { BRAND } from '../../../shared/brand.js';

/** Monthly equivalent, rounded, so the longer plans can be compared with the short one at a glance. */
const perMonth = (amount, days) => Math.round(amount / (days / 30));

/**
 * Prices, in public, without an account.
 *
 * The premium page can only be reached by signing in, which is fine for buying and wrong for
 * deciding: somebody weighing this up should not have to create an account to find out what it
 * costs, and a payment gateway expects the price of what you are selling to be readable by anyone.
 *
 * The figures come from the pricebook the server sends rather than anything compiled into this
 * bundle, exactly as the checkout does, so a price edited in the dashboard changes both together
 * and this page can never quote a number the buyer will not actually be charged.
 */
export default function PricingPage() {
  const { config, prices } = useApp();
  const regions = config.regions || {};
  const codes = Object.keys(regions);
  // India first, because that is where most buyers are and where the rupee prices apply.
  const [region, setRegion] = useState(codes.includes('IN') ? 'IN' : codes[0] || 'IN');
  const here = regions[region] || {};
  const money = amount => prices.money(amount || 0, region);
  const priceOf = id => here.premium?.[id] || 0;
  const seatOf = id => here.perSeat?.[id] || 0;
  const monthly = priceOf('monthly');
  const saving = plan => (monthly ? Math.round((1 - perMonth(priceOf(plan.id), plan.days) / monthly) * 100) : 0);

  return <article className="pricing">
    <header className="pricing-head">
      <span className="eyebrow">PRICING</span>
      <h1>Free to learn. Paid only if you want more.</h1>
      <p className="pricing-lede">
        Everything you need to build a library and study it properly costs nothing, in every country.
        Premium adds the tools below, and every plan is a single payment for a fixed period.
      </p>
      {codes.length > 1 && <div className="pricing-region">
        <span>Show prices for</span>
        <Select compact label="Region" value={region} onChange={setRegion}
          options={codes.map(code => ({ value: code, label: regions[code]?.label || code }))}/>
      </div>}
    </header>

    <section className="pricing-tiers">
      <div className="pricing-card">
        <h2>Free</h2>
        <p className="pricing-amount">{money(0)}<span>forever</span></p>
        <p className="pricing-blurb">The whole library, and the studying that makes it stick.</p>
        <ul className="pricing-list">
          {['Unlimited folders and flashcards', 'Spaced repetition scheduling', 'Progress tracking and streaks',
            'Publish to the community', 'Join any classroom or live quiz', 'Share folders with viewers'].map(f =>
            <li key={f}><Check size={15}/> {f}</li>)}
        </ul>
        <Link className="button secondary" to="/signup">Create a free account <ArrowRight size={15}/></Link>
      </div>

      <div className="pricing-card is-premium">
        <h2><Sparkles size={17}/> Premium</h2>
        <p className="pricing-amount">{money(monthly)}<span>per month, or less on a longer plan</span></p>
        <p className="pricing-blurb">Everything free, plus the {PREMIUM_FEATURES.length} tools below.</p>
        <ul className="pricing-list">
          {PREMIUM_FEATURES.map(f => <li key={f.id}><Check size={15}/> <strong>{f.label}</strong> — {f.detail}</li>)}
        </ul>
        <Link className="button primary" to="/premium">Go Premium <ArrowRight size={15}/></Link>
      </div>
    </section>

    <section className="pricing-plans">
      <h2>Premium plans</h2>
      <p className="pricing-note">Each one buys a fixed period. Longer plans simply cost less per month.</p>
      <div className="pricing-plan-grid">
        {PREMIUM_PLANS.map(plan => <div className="pricing-plan" key={plan.id}>
          <strong>{plan.label}</strong>
          {saving(plan) >= 5 && <span className="pricing-tag">Save {saving(plan)}%</span>}
          <span className="pricing-plan-amount">{money(priceOf(plan.id))}</span>
          <span className="pricing-plan-term">{money(perMonth(priceOf(plan.id), plan.days))}/mo · {plan.days} days</span>
          <p>{plan.blurb}</p>
        </div>)}
      </div>
    </section>

    <section className="pricing-plans">
      <h2><Users size={18}/> Classrooms and teams</h2>
      <p className="pricing-note">
        Billed per seat, from {SEATS.min} to {SEATS.max}. Seats added part-way through a period are charged
        pro rata to the renewal date you already have, so topping up never shortens what you have paid for.
      </p>
      <div className="pricing-plan-grid">
        {TEAM_PLANS.map(plan => <div className="pricing-plan" key={plan.id}>
          <strong>{plan.label}</strong>
          <span className="pricing-plan-amount">{money(seatOf(plan.id))}</span>
          <span className="pricing-plan-term">per seat · {plan.days} days</span>
          <p>{plan.blurb}</p>
        </div>)}
      </div>
    </section>

    {/* Said plainly and near the prices rather than buried in the terms, because "does this keep
        charging me?" is the question a one-off payment is most often assumed to have got wrong. */}
    <section className="pricing-terms">
      <h2>The things worth knowing</h2>
      <ul>
        <li><strong>Nothing renews automatically.</strong> Every plan is a single payment for a fixed period. We hold no mandate against your card or UPI ID, and when the period ends your account simply returns to the free tier.</li>
        <li><strong>Your content is never held hostage.</strong> Folders and cards you made stay exactly where they are when a plan lapses. Only the paid tools switch off.</li>
        <li><strong>{prices.currencyNote(region)}</strong> The price you pay follows the country on your account.</li>
        <li><strong>Full refund within 7 days</strong>, for any reason, with no justification required. Read the <Link to="/refunds">cancellation and refund policy</Link> in full.</li>
        <li>Payments are handled by our gateway. {BRAND.name} never sees your card details.</li>
      </ul>
      <p className="pricing-fineprint">
        Questions about a payment? <Link to="/contact">Write to us</Link>, or read the <Link to="/terms">terms of use</Link>.
      </p>
    </section>
  </article>;
}
