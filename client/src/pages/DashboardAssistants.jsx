import { useEffect, useState } from 'react';
import { Power, Search, Settings2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../services/api';
import { reportError } from '../services/errors';
import { useApp, useQuery, useStore } from '../hooks/useApp';
import { Button, Loading, ErrorState, Empty, Modal, Field } from '../components/ui';
import { isSuperadmin } from '../../../shared/account.js';
import { SCOPES } from '../../../shared/agent.js';
import { Pager, useDebounced } from './DashboardHistory';

/**
 * Connected assistants across every account: whether the feature is on, how much it is being
 * used, and a way to cut off one connection that looks wrong without touching the person's
 * account or anything it already wrote.
 */

const when = iso => iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'Never';
const num = n => Number(n || 0).toLocaleString();

function RevokeModal({ grant, onClose, onDone }) {
  const [note, setNote] = useState(''), [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault(); setBusy(true);
    try {
      await api(`/admin/assistants/${grant.id}`, { method: 'DELETE', body: { note: note.trim() } });
      toast.success(`Disconnected ${grant.name} from @${grant.user?.username}`);
      onDone();
    } catch (err) { reportError(err); setBusy(false); }
  }
  return <Modal open onClose={onClose} title={`Disconnect ${grant.name}?`}
    description={`It stops working for @${grant.user?.username} straight away. The cards it already wrote stay, and they can still undo them.`}>
    <form className="form-stack" onSubmit={submit}>
      <Field label="Why · optional" hint="Kept in the change history.">
        <input autoFocus maxLength={200} value={note} onChange={e => setNote(e.target.value)} placeholder="Unusual volume of cards"/>
      </Field>
      <div className="modal-actions">
        <Button type="button" className="secondary" onClick={onClose}>Cancel</Button>
        <Button className="danger-button" type="submit" loading={busy}>Disconnect</Button>
      </div>
    </form>
  </Modal>;
}

export default function DashboardAssistants({ onOpenSettings }) {
  const { user, refresh } = useApp();
  const store = useStore();
  const [page, setPage] = useState(1);
  const [typed, setTyped] = useState('');
  const q = useDebounced(typed.trim());
  useEffect(() => setPage(1), [q]);
  const [revoking, setRevoking] = useState(null);
  const [switching, setSwitching] = useState(false);

  const params = new URLSearchParams({ page: String(page), ...(q ? { q } : {}) });
  const { data, loading, error, refetch } = useQuery(`/admin/assistants?${params}`);
  if (loading && !data) return <Loading/>;
  if (error) return <ErrorState message={error}/>;

  const { enabled, limits, totals, connections = [], recent = [] } = data;

  /** The master switch, here as well as in Settings, because this is where someone will look for it. */
  async function toggle() {
    setSwitching(true);
    try {
      await api('/admin/settings', { method: 'PATCH', body: { values: { 'agent.enabled': !enabled }, note: `${enabled ? 'Switched off' : 'Switched on'} from the Assistants page` } });
      store.invalidate('/admin');
      refresh();
      toast.success(enabled ? 'Assistant connections are off. Nobody can use one until you switch them back on.' : 'Assistant connections are on.');
    } catch (e) { reportError(e); } finally { setSwitching(false); }
  }

  return <section className="dash-section">
    <header className="dash-section-head">
      <div>
        <h2>AI assistants <span className={`sub-pill ${enabled ? 'is-active' : 'is-expired'}`}>{enabled ? 'On' : 'Off'}</span></h2>
        <p>People with Premium can connect Claude, ChatGPT or another app to add cards for them. Assistants can only add, never delete.</p>
      </div>
      <div className="dash-filters">
        {isSuperadmin(user) && <Button className={enabled ? 'secondary' : 'primary'} loading={switching} onClick={toggle}><Power size={15}/> {enabled ? 'Switch off for everyone' : 'Switch on'}</Button>}
        <Button className="ghost" onClick={() => onOpenSettings('agent')}><Settings2 size={15}/> Change limits</Button>
      </div>
    </header>

    <div className="dash-an-figures">
      <div><strong>{num(totals.active)}</strong><span>Assistants connected</span></div>
      <div><strong>{num(totals.people)}</strong><span>People using one</span></div>
      <div><strong>{num(totals.cardsToday)}</strong><span>Cards added today</span></div>
      <div><strong>{num(totals.imagesToday)}</strong><span>Images fetched today</span></div>
      <div><strong>{num(totals.cardsWeek)}</strong><span>Cards kept this week{totals.undoneWeek ? ` · ${num(totals.undoneWeek)} batches undone` : ''}</span></div>
    </div>
    <p className="dash-an-note">Each person may add up to <b>{num(limits.cardsPerDay)}</b> cards and <b>{num(limits.imagesPerDay)}</b> images a day, connect <b>{num(limits.grantsPerUser)}</b> assistants, and a connection lasts <b>{num(limits.tokenDays)}</b> days before it has to be approved again.</p>

    <div className="dash-subhead">
      <h3>Connections</h3>
      <label className="folder-search dash-filter-search"><Search size={15}/><input aria-label="Search connections by person" placeholder="Search by name or username" value={typed} onChange={e => setTyped(e.target.value)}/></label>
    </div>
    {!connections.length
      ? <Empty title={q ? 'Nobody matches' : 'No assistants connected'} text={q ? 'Try another name.' : 'Connections appear here as people link Claude, ChatGPT or another app.'}/>
      : <>
        <div className="dash-table-wrap"><table className="dash-table">
          <thead><tr><th>Person</th><th>Assistant</th><th>Can</th><th>Last used</th><th>Expires</th><th aria-label="Disconnect"/></tr></thead>
          <tbody>{connections.map(g => <tr key={g.id}>
            <td><strong>{g.user?.name || 'Deleted user'}</strong><span>@{g.user?.username || 'unknown'}</span></td>
            <td><strong>{g.name}</strong><span>{g.createdVia === 'oauth' ? 'Approved in the app' : 'Personal token'}</span></td>
            <td><span>{g.scopes.map(s => SCOPES[s]?.label).filter(Boolean).join(', ')}</span></td>
            <td className="dash-nowrap">{when(g.lastUsedAt)}</td>
            <td className="dash-nowrap">{g.expired ? <span className="sub-pill is-expired">Expired</span> : when(g.expiresAt)}</td>
            <td><Button className="secondary small" onClick={() => setRevoking(g)}>Disconnect</Button></td>
          </tr>)}</tbody>
        </table></div>
        <Pager page={data.page} pages={data.pages} total={data.total} noun="connection" onPage={setPage}/>
      </>}

    <h3 className="dash-subhead-title">Latest activity</h3>
    {!recent.length
      ? <p className="dash-an-note">Nothing written by an assistant yet.</p>
      : <ul className="assistant-batches">{recent.map(b => <li key={b.id}>
        <div>
          <strong>{b.cards ? `${b.cards} card${b.cards === 1 ? '' : 's'}` : b.images ? `${b.images} image${b.images === 1 ? '' : 's'}` : 'A change'} in {b.collection}</strong>
          <small>@{b.user} · {b.assistant} · {when(b.at)}</small>
        </div>
        {b.undone && <span className="assistant-undone">Undone by them</span>}
      </li>)}</ul>}

    {revoking && <RevokeModal grant={revoking} onClose={() => setRevoking(null)} onDone={() => { setRevoking(null); refetch(); }}/>}
  </section>;
}
