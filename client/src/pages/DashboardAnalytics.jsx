import { useState } from 'react';
import { useQuery } from '../hooks/useApp';
import { Loading, ErrorState, Empty } from '../components/ui';
import Select, { optionsOf } from '../components/Select';
const DAY_WINDOWS = [7, 30, 90, 365], WEEK_WINDOWS = [4, 8, 12, 26];
const num = n => (Number.isFinite(n) ? n : 0).toLocaleString();
/** The percentages the service sends are already rounded to one decimal, so they are only printed. */
const pct = p => `${Number.isFinite(p) ? p : 0}%`;
const share = (n, of) => (of ? Math.round((n / of) * 1000) / 10 : 0);
/**
 * One figure in the currency it was taken in. Nothing here is converted or added across currencies:
 * the orders carry no exchange rate, and a combined total would be a guess printed as a fact.
 */
const money = (amount, currency) => {
  const value = Number.isFinite(amount) ? amount : 0;
  // Plans are priced in whole units, so most of these totals are whole and the trailing .00 is
  // just noise down a column. The paise are only shown when there actually are some.
  const whole = Number.isInteger(value);
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency || 'INR', minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 }).format(value); }
  catch { return `${value} ${currency || ''}`.trim(); }
};
const day = iso => new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
function Section({ title, text, children }) {
  return <section className="dash-an-section"><div className="dash-an-section-head"><h2>{title}</h2><p>{text}</p></div>{children}</section>;
}
function Figures({ items }) {
  return <div className="dash-an-figures">{items.map(f => <div key={f.label}><strong>{f.value}</strong><span>{f.label}</span></div>)}</div>;
}
function Bars({ series = [], field, label, empty }) {
  if (!series.length) return <p className="dash-an-note">{empty}</p>;
  const max = series.reduce((m, d) => Math.max(m, d[field] || 0), 0);
  return <div className="dash-an-bars" role="img" aria-label={label}>{series.map(d => <span key={d.date} className="dash-an-bar" title={`${day(d.date)}: ${num(d[field])}`}>
    <span style={{ height: `${max ? ((d[field] || 0) / max) * 100 : 0}%` }}/>
  </span>)}</div>;
}
function Gross({ revenue = [] }) {
  return revenue.length ? revenue.map(v => <span key={v.currency}>{money(v.gross, v.currency)}</span>) : <span>None</span>;
}
function Breakdown({ rows = [], head, note }) {
  if (!rows.length) return <p className="dash-an-note">No approved orders in this window, so there is nothing to break down.</p>;
  return <>
    <div className="dash-table-wrap"><table className="dash-table"><thead><tr><th>{head}</th><th>Orders</th><th>Gross</th></tr></thead><tbody>{rows.map((r, i) => <tr key={r.label || i}>
      <td><strong>{r.label || 'Not given'}</strong></td><td>{num(r.orders)}</td><td><Gross revenue={r.revenue}/></td>
    </tr>)}</tbody></table></div>
    {note ? <p className="dash-an-note">{note}</p> : null}
  </>;
}
function Counter({ label, value, action, calm }) {
  return <div className={`dash-an-counter ${calm ? 'is-calm' : 'is-warn'}`}><strong>{value}</strong><span>{label}</span><small>{action}</small></div>;
}
export default function DashboardAnalytics() {
  const [days, setDays] = useState(30);
  const [weeks, setWeeks] = useState(8);
  const { data, loading, error } = useQuery(`/admin/analytics?days=${days}&weeks=${weeks}`);
  if (loading) return <Loading/>;
  if (error) return <ErrorState message={error}/>;
  if (!data) return <Empty title="No analytics yet" text="The numbers appear here once the server has something to count."/>;
  const growth = data.growth || {}, revenue = data.revenue || {}, engagement = data.engagement || {}, retention = data.retention || {}, health = data.health || {};
  const activation = growth.activation || {}, orders = revenue.orders || {}, conversion = revenue.conversion || {}, reviews = engagement.totals || {};
  const cohorts = retention.rows || [];
  const columns = cohorts.reduce((n, r) => Math.max(n, (r.weeks || []).length), 0);
  return <>
    <div className="dash-usage-head">
      <p>
        Everything the stored data can answer about the last
        {` ${data.days ?? days} `}days, with retention read over
        {` ${data.weeks ?? weeks} `}signup weeks. Request errors, latency and email delivery are not
        here because nothing in the models records them.
      </p>
      <div className="dash-an-windows">
        <div className="dash-usage-window">
          <span>Window</span>
          <Select compact label="Window" value={days} onChange={setDays}
            options={optionsOf(DAY_WINDOWS, d => `Last ${d} days`)}/>
        </div>
        <div className="dash-usage-window">
          <span>Cohorts</span>
          <Select compact label="Cohorts" value={weeks} onChange={setWeeks}
            options={optionsOf(WEEK_WINDOWS, w => `${w} weeks`)}/>
        </div>
      </div>
    </div>
    <Section title="Growth" text="Who arrived, and how many of them did the two things that separate an account from a form submission.">
      <Figures items={[
        { label: 'Accounts in total', value: num(growth.totals?.accounts) },
        { label: 'New in the window', value: num(growth.totals?.newInWindow) },
        { label: 'Wrote a card', value: pct(activation.createdCardPercent) },
        { label: 'Reviewed a card', value: pct(activation.reviewedPercent) },
      ]}/>
      <Bars series={growth.series} field="signups" label="Signups per day" empty="No signups to chart in this window."/>
    </Section>
    <Section title="Revenue" text="What was paid, kept in the currency it was paid in, next to the orders that never got there.">
      {/* Currencies sit side by side rather than summed: paise and cents are different units, and one
          number over both would not be money in either. */}
      <div className="dash-an-currencies">{(revenue.currencies || []).length
        ? revenue.currencies.map(c => <div key={c.currency}><strong>{money(c.gross, c.currency)}</strong><span>{c.currency} · {num(c.orders)} order{c.orders === 1 ? '' : 's'}</span></div>)
        : <p className="dash-an-note">Nothing has been approved in this window.</p>}</div>
      <Figures items={[
        { label: 'Approved orders', value: num(orders.approved) },
        { label: 'Waiting on a decision', value: num(orders.pending) },
        { label: 'Declined', value: num(orders.declined) },
        { label: 'Orders per new account', value: pct(conversion.percent) },
      ]}/>
      <h3>By plan</h3>
      <Breakdown rows={revenue.byPlan} head="Plan"/>
      <h3>By billing country</h3>
      <Breakdown rows={revenue.byCountry} head="Country" note="This is the billing address the buyer typed at checkout, which they choose freely and which does not set the price. The priced market follows the country on the account, so read the currency column alongside it rather than treating this as revenue by market."/>
      <h3>By method</h3>
      <Breakdown rows={revenue.byMethod} head="Method"/>
    </Section>
    <Section title="Engagement" text="How much studying happened, and how many different people it came from.">
      <Figures items={[
        { label: 'Active today', value: num(reviews.daily) },
        { label: 'Active this week', value: num(reviews.weekly) },
        { label: 'Active in the window', value: num(reviews.monthly) },
        { label: 'Reviews in the window', value: num(reviews.reviews) },
      ]}/>
      <Bars series={engagement.series} field="reviews" label="Reviews per day" empty="Nobody has reviewed anything in this window."/>
      <h3>Most copied public folders</h3>
      {(engagement.topFolders || []).length
        ? <div className="dash-table-wrap"><table className="dash-table"><thead><tr><th>Folder</th><th>Owner</th><th>Copies</th><th>Likes</th></tr></thead><tbody>{engagement.topFolders.map(f => <tr key={f.id}>
          <td><strong>{f.title}</strong></td>
          <td>{f.owner ? `@${f.owner}` : 'Deleted user'}{f.ownerName ? <span>{f.ownerName}</span> : null}</td>
          <td>{num(f.copies)}</td><td>{num(f.likes)}</td>
        </tr>)}</tbody></table></div>
        : <p className="dash-an-note">No public folder has been copied yet.</p>}
    </Section>
    <Section title="Retention" text="Whether the people who signed up in a given week were still reviewing in the weeks that followed.">
      {!cohorts.length ? <p className="dash-an-note">No signups in these weeks, so there are no cohorts to follow.</p>
        : <div className="dash-table-wrap"><table className="dash-table dash-an-cohorts"><thead><tr>
          <th>Signup week</th><th>People</th>{Array.from({ length: columns }, (_, w) => <th key={w}>Week {w}</th>)}
        </tr></thead><tbody>{cohorts.map(row => <tr key={row.cohort}>
          <td><strong>{day(row.cohort)}</strong></td>
          <td>{num(row.size)}</td>
          {Array.from({ length: columns }, (_, w) => {
            // Columns past `measured` have not had time to elapse yet, so they are blanked rather
            // than shown as 0%: a zero here reads as the whole cohort leaving instead of as a week
            // that has not happened.
            if (w >= (row.measured || 0)) return <td key={w} className="dash-an-unmeasured" title="This week has not elapsed yet">—</td>;
            const people = (row.weeks || [])[w] || 0;
            const percent = share(people, row.size);
            return <td key={w} className="dash-an-cell" style={{ '--dash-an-shade': row.size ? percent / 100 : 0 }} title={`${people} of ${row.size}`}>{percent}%</td>;
          })}
        </tr>)}</tbody></table></div>}
    </Section>
    <Section title="Health" text="Queues that should sit near zero. A number that keeps climbing is the thing to look at, not the number itself.">
      <div className="dash-an-counters">
        <Counter label="Approvals stuck over a day" value={num(health.stuckApprovals)} calm={!health.stuckApprovals} action="Open Premium requests and decide them."/>
        <Counter label="Payments never claimed" value={num(health.unclaimedPayments)} calm={!health.unclaimedPayments} action="Checkout opened and never finished. Check the gateway if the count keeps growing."/>
        <Counter label="Accounts unverified over a day" value={num(health.unverifiedAccounts)} calm={!health.unverifiedAccounts} action="A steady rise usually means verification email is not arriving."/>
        <Counter label="Domain events stored" value={num(health.domainEvents)} calm action="Grows with normal use. Worth pruning if it outgrows its disk."/>
        <Counter label={`Database ${health.database?.state || 'unknown'}`} value={health.database?.state === 'connected' ? 'OK' : 'Check'} calm={health.database?.state === 'connected'} action="Anything other than connected means the figures above are stale."/>
      </div>
    </Section>
  </>;
}
