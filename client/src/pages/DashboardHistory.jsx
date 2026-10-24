import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { useQuery } from '../hooks/useApp';
import { Button, Loading, ErrorState, Empty } from '../components/ui';
import Select from '../components/Select';

/**
 * Who changed what, kept because editable settings without a record of the edit is a liability.
 *
 * Its own page rather than the foot of the settings form, and paged rather than one long table:
 * the log only grows, and an answer to "who turned that off last Tuesday" should not depend on
 * scrolling past every edit since.
 */

const when = iso => iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '';

const KINDS = [
  { value: '', label: 'All changes' },
  { value: 'settings', label: 'Settings' },
  { value: 'account', label: 'Accounts' },
  { value: 'assistant', label: 'AI assistants' },
];

const ACTIONS = {
  'settings.update': 'Changed a setting',
  'settings.reset': 'Reset to default',
  'account.deleted': 'Deleted an account',
  'agent.revoked': 'Disconnected an assistant',
};

/** A stored value as a person would say it, rather than as JSON. */
function show(value) {
  if (value === true) return 'On';
  if (value === false) return 'Off';
  if (value === null || value === undefined) return '—';
  if (value === '') return '(empty)';
  if (Array.isArray(value)) return value.length ? value.join(', ') : '(none)';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/**
 * One line per field that moved. Settings are recorded as `{ key: value }` on both sides, so they
 * read as "label: before → after" using the label the settings page itself shows.
 */
function Change({ before, after, specs }) {
  const objects = before && after && typeof before === 'object' && typeof after === 'object' && !Array.isArray(before);
  if (!objects) {
    if (before == null && after == null) return <span className="dash-muted">—</span>;
    return <span className="dash-change"><s>{show(before)}</s> → <b>{show(after)}</b></span>;
  }
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];
  return <ul className="dash-changes">{keys.map(k => <li key={k}>
    <span className="dash-change-key" title={k}>{specs[k]?.label || k}</span>
    <span className="dash-change"><s>{show(before[k])}</s> → <b>{show(after[k])}</b></span>
  </li>)}</ul>;
}

/** Page numbers with the ends always shown and a gap marked, so 40 pages do not become 40 buttons. */
function pageList(page, pages) {
  const out = new Set([1, pages, page - 1, page, page + 1]);
  const list = [...out].filter(n => n >= 1 && n <= pages).sort((a, b) => a - b);
  return list.flatMap((n, i) => (i && n - list[i - 1] > 1 ? ['gap', n] : [n]));
}

export function Pager({ page, pages, total, noun, onPage }) {
  if (pages <= 1) return total ? <p className="dash-pager-count">{total} {noun}{total === 1 ? '' : 's'}</p> : null;
  return <nav className="dash-pager" aria-label="Pages">
    <span className="dash-pager-count">{total} {noun}s · page {page} of {pages}</span>
    <div>
      <Button className="ghost small" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page"><ChevronLeft size={15}/></Button>
      {pageList(page, pages).map((n, i) => n === 'gap'
        ? <span key={`gap${i}`} className="dash-pager-gap">…</span>
        : <button key={n} type="button" className={n === page ? 'active' : ''} aria-current={n === page ? 'page' : undefined} onClick={() => onPage(n)}>{n}</button>)}
      <Button className="ghost small" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page"><ChevronRight size={15}/></Button>
    </div>
  </nav>;
}

/** Waits until typing pauses, so a search is one request rather than one per letter. */
export function useDebounced(value, ms = 300) {
  const [settled, setSettled] = useState(value);
  useEffect(() => { const t = setTimeout(() => setSettled(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return settled;
}

export default function DashboardHistory() {
  const [page, setPage] = useState(1);
  const [kind, setKind] = useState('');
  const [typed, setTyped] = useState('');
  const q = useDebounced(typed.trim());
  useEffect(() => setPage(1), [kind, q]);

  const params = new URLSearchParams({ page: String(page), pageSize: '20', ...(kind ? { kind } : {}), ...(q ? { q } : {}) });
  const { data, loading, error } = useQuery(`/admin/audit?${params}`);
  // Already cached whenever the settings page has been opened, and only used for labels.
  const { data: settings } = useQuery('/admin/settings');
  const specs = settings?.specs || {};
  const entries = data?.entries || [];

  return <section className="dash-section">
    <header className="dash-section-head">
      <div><h2>Change history</h2><p>Every configuration change and staff action, newest first.</p></div>
      <div className="dash-filters">
        <label className="folder-search dash-filter-search"><Search size={15}/><input aria-label="Search the history" placeholder="Search who, what or why" value={typed} onChange={e => setTyped(e.target.value)}/></label>
        <Select compact label="Kind of change" value={kind} onChange={setKind} options={KINDS}/>
      </div>
    </header>
    {loading && !data ? <Loading/> : error ? <ErrorState message={error}/> : !entries.length
      ? <Empty title={q || kind ? 'Nothing matches' : 'Nothing changed yet'} text={q || kind ? 'Try another search or kind of change.' : 'Every configuration change is recorded here, with who made it and what it was before.'}/>
      : <>
        <div className="dash-table-wrap">
          <table className="dash-table dash-history">
            <thead><tr><th>When</th><th>Who</th><th>What</th><th>Change</th><th>Note</th></tr></thead>
            <tbody>{entries.map(e => <tr key={e.id}>
              <td className="dash-nowrap">{when(e.at)}</td>
              <td>@{e.actor}</td>
              <td><strong>{ACTIONS[e.action] || e.action}</strong>{e.target && <span>{e.target.split(', ').map(k => specs[k]?.label || k).join(', ')}</span>}</td>
              <td><Change before={e.before} after={e.after} specs={specs}/></td>
              <td>{e.note || <span className="dash-muted">—</span>}</td>
            </tr>)}</tbody>
          </table>
        </div>
        <Pager page={data.page} pages={data.pages} total={data.total} noun="change" onPage={setPage}/>
      </>}
  </section>;
}
