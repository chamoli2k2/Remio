import { lazy, Suspense, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { api } from '../services/api';
import { messageFor, reportError } from '../services/errors';
import { useApp, useQuery } from '../hooks/useApp';
import { Button, Loading, ErrorState, Empty, Modal } from '../components/ui';
import Select, { optionsOf } from '../components/Select';
import { ACCOUNTS, isSuperadmin, planById } from '../../../shared/account.js';
// Split out because between them they are most of this page's weight and neither is on the tab
// that opens first. An admin who only ever approves payments never downloads either.
const DashboardAnalytics = lazy(() => import('./DashboardAnalytics'));
const DashboardSettings = lazy(() => import('./DashboardSettings'));
import { minorUnitsIn } from '../../../shared/pricing.js';
const when = iso => iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'Never';
/**
 * What an order took, in the currency it took it in. Stored in the currency's smallest unit, so it
 * is divided back out rather than assumed to be rupees — an order from Australia is not.
 */
const charged = order => {
  const currency = order.currency || 'INR';
  const amount = (order.amount || 0) / minorUnitsIn(currency);
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amount); } catch { return `${amount} ${currency}`; }
};
const day = iso => new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' });
/** Reads the subscription window for one person in the users table. */
function Subscription({ person }) {
  if (!['premium', 'admin', 'superadmin'].includes(person.account)) return <span className="dash-muted">Free</span>;
  if (!person.expiresAt) return <span className="sub-pill is-forever">{person.planLabel || 'No end date'}</span>;
  const left = person.daysLeft;
  const tone = left <= 0 ? 'is-expired' : left <= 7 ? 'is-soon' : 'is-active';
  return <span className={`sub-pill ${tone}`} title={`Ends ${day(person.expiresAt)}`}>
    {person.planLabel || 'Premium'} · {left <= 0 ? `expired ${Math.abs(left)}d ago` : `${left} day${left === 1 ? '' : 's'} left`}
  </span>;
}
const REASON_LABELS = {
  illegal: 'Illegal', infringement: 'Copyright', privacy: 'Private information',
  harmful: 'Abusive or dangerous', spam: 'Spam', other: 'Other',
};

/**
 * The notice queue.
 *
 * Upholding a report unpublishes the collection; it never deletes it. The owner keeps their work
 * and can put it right, which is the correct asymmetry when acting on a single complaint that one
 * person has read once.
 */
function Reports({ rows, onDone }) {
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState({});
  async function decide(id, status) {
    setBusy(id + status);
    try {
      await api(`/admin/reports/${id}`, { method: 'PATCH', body: { status, outcome: note[id] || '' } });
      toast.success(status === 'upheld' ? 'Upheld, and the collection is no longer public.' : 'Rejected, and the collection stays up.');
      onDone();
    } catch (e) { toast.error(messageFor(e)); } finally { setBusy(''); }
  }
  return <ul className="report-queue">{rows.map(r => <li key={r.id}>
    <div className="report-head">
      <span className={`report-reason is-${r.reason}`}>{REASON_LABELS[r.reason] || r.reason}</span>
      <Link to={`/folders/${r.folder.id}`} target="_blank"><strong>{r.folder.title || 'Untitled collection'}</strong></Link>
      <span className="dash-muted">by @{r.folder.owner || 'unknown'} · reported by {r.reporter} · {new Date(r.createdAt).toLocaleDateString()}</span>
    </div>
    {r.detail && <p className="report-detail">{r.detail}</p>}
    <div className="report-actions">
      <input aria-label="What you decided and why" placeholder="What you decided, and why" value={note[r.id] || ''} onChange={e => setNote(n => ({ ...n, [r.id]: e.target.value }))} maxLength={500}/>
      <Button className="secondary" loading={busy === r.id + 'rejected'} onClick={() => decide(r.id, 'rejected')}>Leave it up</Button>
      <Button className="primary" loading={busy === r.id + 'upheld'} onClick={() => decide(r.id, 'upheld')}>Unpublish</Button>
    </div>
  </li>)}</ul>;
}

export default function DashboardPage() {
  const { user, refresh } = useApp();
  const [open, setOpen] = useState(null);
  const [tab, setTab] = useState('users');
  const [q, setQ] = useState('');
  const { data, loading, error } = useQuery(`/admin/users${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ''}`);
  const { data: orders, loading: lo, error: eo } = useQuery('/admin/orders');
  const [days, setDays] = useState(30);
  const { data: usage, loading: lu, error: eu } = useQuery(`/admin/countries?days=${days}`, null, { enabled: tab === 'countries' });
  // Loaded whatever tab is open, because the count belongs on the tab itself: a report sitting
  // unseen is the failure mode this whole queue exists to prevent.
  const { data: reports, loading: lr, error: er, refetch: refetchReports } = useQuery('/admin/reports?status=open');
  async function setAccount(id, account) {
    try { await api(`/admin/users/${id}`, { method: 'PATCH', body: { account } }); refresh(); toast.success('Role updated'); }
    catch (e) { reportError(e); }
  }
  async function decide(id, status) {
    try {
      await api(`/admin/orders/${id}`, { method: 'PATCH', body: { status } });
      setOpen(o => o && o.id === id ? { ...o, status } : o);
      refresh(); toast.success(status === 'approved' ? 'Premium granted' : 'Request declined');
    } catch (e) { reportError(e); }
  }
  const people = data?.users || [];
  const pending = (orders?.orders || []).filter(o => o.status === 'pending');
  return <>
    <div className="page-heading"><div><span className="eyebrow">STAFF</span><h1>Dashboard</h1><p>Manage accounts and confirm Premium payments. {isSuperadmin(user) ? 'Superadmin can assign any role.' : 'Admins can set Normal or Premium.'}</p></div></div>
    <div className="tabs" role="tablist">
      <button role="tab" aria-selected={tab === 'users'} className={tab === 'users' ? 'active' : ''} onClick={() => setTab('users')}>Users {people.length ? <span>{people.length}</span> : null}</button>
      <button role="tab" aria-selected={tab === 'orders'} className={tab === 'orders' ? 'active' : ''} onClick={() => setTab('orders')}>Premium requests {pending.length ? <span>{pending.length}</span> : null}</button>
      <button role="tab" aria-selected={tab === 'countries'} className={tab === 'countries' ? 'active' : ''} onClick={() => setTab('countries')}>Where it is used {usage?.totals.countries ? <span>{usage.totals.countries}</span> : null}</button>
      <button role="tab" aria-selected={tab === 'analytics'} className={tab === 'analytics' ? 'active' : ''} onClick={() => setTab('analytics')}>Analytics</button>
      <button role="tab" aria-selected={tab === 'reports'} className={tab === 'reports' ? 'active' : ''} onClick={() => setTab('reports')}>Reports {reports?.open ? <span>{reports.open}</span> : null}</button>
      <button role="tab" aria-selected={tab === 'settings'} className={tab === 'settings' ? 'active' : ''} onClick={() => setTab('settings')}>Settings</button>
    </div>
    {tab === 'reports' && (lr ? <Loading/> : er ? <ErrorState message={er}/> : !(reports?.reports || []).length
      ? <Empty title="Nothing reported" text="Notices about published collections arrive here. Nothing is waiting."/>
      : <Reports rows={reports.reports} onDone={refetchReports}/>)}
    {tab === 'users' && <>
      <form className="folder-search dash-search" onSubmit={e => e.preventDefault()}><input aria-label="Search users" placeholder="Search name, username, email" value={q} onChange={e => setQ(e.target.value)}/></form>
      {loading ? <Loading/> : error ? <ErrorState message={error}/> : !people.length ? <Empty title="No users" text="Try another search."/> : <div className="dash-table-wrap"><table className="dash-table"><thead><tr><th>Person</th><th>Email</th><th>Subscription</th><th>Role</th></tr></thead><tbody>{people.map(p => <tr key={p.id}><td><strong>{p.name}</strong><span>@{p.username}</span></td><td>{p.email || 'Not given'}</td><td><Subscription person={p}/></td><td>{p.id === user.id ? <span className="dash-self">{p.account} · you</span> : <Select compact label={`Role for ${p.username}`} value={p.account || 'normal'} onChange={v => setAccount(p.id, v)} options={optionsOf(ACCOUNTS)}/>}</td></tr>)}</tbody></table></div>}
    </>}
    {tab === 'orders' && (lo ? <Loading/> : eo ? <ErrorState message={eo}/> : !(orders?.orders || []).length ? <Empty title="No Premium orders" text="Every purchase through the gateway appears here."/> : <ul className="order-grid">{orders.orders.map(o => <li key={o.id}>
      <button type="button" className="order-card" onClick={() => setOpen(o)}>
        <span className="order-card-body">
          <strong>{o.name}</strong>
          <span>{planById(o.plan)?.label || 'Premium'} · {o.user?.username ? `@${o.user.username}` : o.email}</span>
          <span>{when(o.createdAt)}</span>
        </span>
        <span className={`order-status is-${o.status}`}>{o.status}</span>
      </button>
    </li>)}</ul>)}
    {tab === 'countries' && <>
      <div className="dash-usage-head">
        <p>
          Accounts by country, next to how many of them studied anything in the window. A country
          with people studying and no Premium on sale is the case for opening it: there are
          {` ${usage?.totals.unsellableStudying ?? 0} `}such
          {usage?.totals.unsellableStudying === 1 ? ' person' : ' people'} across
          {` ${usage?.totals.unsellableCountries ?? 0} `}
          {usage?.totals.unsellableCountries === 1 ? 'country' : 'countries'} right now.
        </p>
        <div className="dash-usage-window">
          <span>Window</span>
          <Select compact label="Window" value={days} onChange={setDays}
            options={optionsOf([7, 30, 90, 365], d => `Last ${d} days`)}/>
        </div>
      </div>
      {lu ? <Loading/> : eu ? <ErrorState message={eu}/> : !usage?.rows.length ? <Empty title="No accounts yet" text="Countries appear here as people sign up."/> : <div className="dash-table-wrap"><table className="dash-table"><thead><tr>
        <th>Country</th><th>Accounts</th><th>Studied</th><th>Reviews</th><th>Paying</th><th>Selling</th>
      </tr></thead><tbody>{usage.rows.map(r => <tr key={r.country}>
        <td><strong>{r.country}</strong><span>{r.code}</span></td>
        <td>{r.accounts.toLocaleString()}</td>
        {/* Studied is the one to read first. Accounts count people who arrived; this counts the
            ones who came back. */}
        <td>{r.studying.toLocaleString()}{r.accounts ? <span>{Math.round(r.studying / r.accounts * 100)}% of them</span> : null}</td>
        <td>{r.reviews.toLocaleString()}</td>
        <td>{r.premium.toLocaleString()}</td>
        <td>{r.sellable ? <span className="sub-pill is-active">On sale</span> : <span className="dash-muted">Not on sale</span>}</td>
      </tr>)}</tbody></table></div>}
    </>}
    {/* Both are split bundles, so the fallback covers the fetch of the code as well as the data. */}
    {tab === 'analytics' && <Suspense fallback={<Loading/>}><DashboardAnalytics/></Suspense>}
    {tab === 'settings' && <Suspense fallback={<Loading/>}><DashboardSettings/></Suspense>}
    <Modal wide open={!!open} onClose={() => setOpen(null)} title={open ? `Premium request from ${open.name}` : ''} description="The billing details on this order, as the buyer gave them.">
      {open && <div className="order-detail">
        <dl className="order-detail-list">
          <div><dt>Status</dt><dd><span className={`order-status is-${open.status}`}>{open.status}</span></dd></div>
          {/* The amount is read off the order rather than looked up from the plan: prices differ by
              country and change over time, and what matters when approving one is what was charged. */}
          <div><dt>Plan</dt><dd>{planById(open.plan) ? `${planById(open.plan).label} · ${planById(open.plan).days ? `${planById(open.plan).days} days` : 'no end date'}` : open.plan}</dd></div>
          <div><dt>Charged</dt><dd>{charged(open)}</dd></div>
          <div><dt>Account</dt><dd>{open.user?.username ? `@${open.user.username}` : 'Deleted user'}</dd></div>
          <div><dt>Email</dt><dd>{open.email}</dd></div>
          <div><dt>Phone</dt><dd>{open.phone}</dd></div>
          <div><dt>Country</dt><dd>{open.country}</dd></div>
          <div><dt>Address</dt><dd>{open.address}</dd></div>
          <div><dt>Submitted</dt><dd>{when(open.createdAt)}</dd></div>
        </dl>
      </div>}
      {open?.status === 'pending' ? <div className="modal-actions"><Button className="secondary" onClick={() => decide(open.id, 'declined')}>Decline</Button><Button className="primary" onClick={() => decide(open.id, 'approved')}>Approve Premium</Button></div>
        : open && <div className="modal-actions"><Button className="secondary" onClick={() => setOpen(null)}>Close</Button></div>}
    </Modal>
  </>;
}
