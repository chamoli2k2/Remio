import { useMemo, useState } from 'react';
import { RotateCcw, Save, ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../services/api';
import { reportError } from '../services/errors';
import { useApp, useQuery } from '../hooks/useApp';
import { Button, Loading, ErrorState, Empty } from '../components/ui';
import { isSuperadmin } from '../../../shared/account.js';

const when = iso => iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '';
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * One setting, rendered from its own declaration rather than from a form written by hand.
 *
 * The server sends the type, the bounds, and the help text along with the value, so a new setting
 * appears here the moment it is declared and there is no second copy of the rules to drift. The
 * bounds on the inputs are a convenience only — the server checks the same numbers again, because
 * a limit that exists only in a form is not a limit.
 */
function SettingRow({ id, spec, value, dirty, overridden, disabled, onChange }) {
  const label = <span className="dash-set-label">{spec.label}{overridden && <em title="Changed from the shipped default">edited</em>}{dirty && <b title="Not saved yet">unsaved</b>}</span>;
  if (spec.type === 'boolean') return <label className={`dash-set dash-set-toggle ${dirty ? 'is-dirty' : ''}`}>
    <input type="checkbox" checked={!!value} disabled={disabled} onChange={e => onChange(id, e.target.checked)}/>
    <span>{label}{spec.help && <small>{spec.help}</small>}</span>
  </label>;
  if (spec.type === 'countries') {
    // A checklist rather than a multi-select: there are five choices that matter and a multi-select
    // hides what is picked behind a scroll, which is the wrong trade for a list that decides where
    // money can be taken. Countries with no pricing region are not offered at all.
    const chosen = new Set(value || []);
    return <div className={`dash-set ${dirty ? 'is-dirty' : ''}`}>
      {label}{spec.help && <small>{spec.help}</small>}
      <div className="dash-set-countries">
        {(spec.options || []).filter(o => o.region).map(o => <label key={o.value}>
          <input type="checkbox" checked={chosen.has(o.value)} disabled={disabled}
            onChange={e => onChange(id, e.target.checked ? [...chosen, o.value] : [...chosen].filter(c => c !== o.value))}/>
          {o.label}
        </label>)}
      </div>
    </div>;
  }
  return <div className={`dash-set ${dirty ? 'is-dirty' : ''}`}>
    {label}
    {spec.type === 'text'
      ? <input type="text" value={value ?? ''} maxLength={spec.maxLength} disabled={disabled} onChange={e => onChange(id, e.target.value)}/>
      : <span className="dash-set-number">
          <input type="number" value={value ?? ''} min={spec.min} max={spec.max} step={spec.step || 1} disabled={disabled} onChange={e => onChange(id, e.target.value)}/>
          {spec.unit && <i>{spec.unit}</i>}
        </span>}
    {spec.help ? <small>{spec.help}</small> : spec.type === 'number' ? <small>Between {spec.min} and {spec.max}.</small> : null}
  </div>;
}

/** Who changed what, kept because editable settings without a record of the edit is a liability. */
function AuditTrail() {
  const { data, loading, error } = useQuery('/admin/audit');
  if (loading) return <Loading/>;
  if (error) return <ErrorState message={error}/>;
  const entries = data?.entries || [];
  if (!entries.length) return <Empty title="Nothing changed yet" text="Every configuration change is recorded here, with who made it and what it was before."/>;
  return <div className="dash-table-wrap">
    <table className="dash-table">
      <thead><tr><th>When</th><th>Who</th><th>What</th><th>Change</th><th>Note</th></tr></thead>
      <tbody>{entries.map(e => <tr key={e.id}>
        <td>{when(e.at)}</td>
        <td>{e.actor}</td>
        <td><strong>{e.action}</strong>{e.target && <span>{e.target}</span>}</td>
        <td className="dash-audit-change">{e.before === null && e.after === null
          ? <span className="dash-muted">—</span>
          : <><code>{JSON.stringify(e.before)}</code> → <code>{JSON.stringify(e.after)}</code></>}</td>
        <td>{e.note || <span className="dash-muted">—</span>}</td>
      </tr>)}</tbody>
    </table>
  </div>;
}

export default function DashboardSettings() {
  const { user, refresh } = useApp();
  const { data, loading, error, refetch } = useQuery('/admin/settings');
  // Only the keys actually touched are held here, so the form shows saved values for everything
  // else even if somebody else changes one while this page is open.
  const [edits, setEdits] = useState({});
  const [problems, setProblems] = useState({});
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const mayEdit = isSuperadmin(user);

  const effective = useMemo(() => ({ ...(data?.values || {}), ...edits }), [data, edits]);
  const dirty = useMemo(() => Object.keys(edits).filter(k => !same(edits[k], data?.values?.[k])), [edits, data]);

  if (loading) return <Loading/>;
  if (error) return <ErrorState message={error}/>;

  const { groups = [], specs = {}, overridden = [], fallbacks = {} } = data || {};
  const change = (key, value) => { setEdits(e => ({ ...e, [key]: value })); setProblems(p => ({ ...p, [key]: undefined })); };

  async function save() {
    // Only what moved is sent. Posting the whole form would record an audit entry for every field
    // and make the trail useless for answering what actually changed at midnight.
    const values = Object.fromEntries(dirty.map(k => [k, edits[k]]));
    setSaving(true);
    try {
      await api('/admin/settings', { method: 'PATCH', body: { values, note: note.trim() } });
      setEdits({}); setProblems({}); setNote(''); refetch(); refresh();
      toast.success(`Saved ${dirty.length} change${dirty.length === 1 ? '' : 's'}`);
    } catch (e) {
      // The server answers with a problem per field, which belongs next to the field rather than in
      // a toast that does not say which number was wrong.
      if (e.details && ['SETTINGS_INVALID', 'SETTINGS_CONFLICT'].includes(e.code)) {
        setProblems(e.details);
        toast.error(e.code === 'SETTINGS_CONFLICT' ? 'Those values conflict with each other.' : 'Some values were refused. See the notes below them.');
      }
      else reportError(e);
    } finally { setSaving(false); }
  }

  async function reset(keys) {
    try {
      await api('/admin/settings/reset', { method: 'POST', body: { keys } });
      setEdits(e => { const next = { ...e }; for (const k of keys) delete next[k]; return next; });
      refetch(); refresh(); toast.success(keys.length === 1 ? 'Back to the shipped default' : `${keys.length} settings reset`);
    } catch (e) { reportError(e); }
  }

  return <>
    {!mayEdit && <div className="dash-set-readonly"><ShieldAlert size={18}/>
      <span>You can read every setting here, but only a superadmin can change one. Prices and switches
        are the kind of thing worth two people agreeing on.</span></div>}

    {groups.map(group => {
      const keys = Object.keys(specs).filter(k => specs[k].group === group.id);
      if (!keys.length) return null;
      const edited = keys.filter(k => overridden.includes(k));
      return <section key={group.id} className="dash-set-group">
        <header>
          <div><h2>{group.label}</h2><p>{group.blurb}</p></div>
          {/* Resetting a whole group is one click because the shipped values are always a safe
              place to land: they are the constants the app ran on before any of this existed. */}
          {mayEdit && edited.length > 0 && <Button className="ghost small" onClick={() => reset(edited)}>
            <RotateCcw size={15}/> Reset {edited.length}</Button>}
        </header>
        <div className="dash-set-grid">
          {keys.map(key => <div key={key} className="dash-set-cell">
            <SettingRow id={key} spec={specs[key]} value={effective[key]} disabled={!mayEdit || saving}
              dirty={dirty.includes(key)} overridden={overridden.includes(key)} onChange={change}/>
            {problems[key] && <p className="dash-set-error">{problems[key]}</p>}
            {overridden.includes(key) && mayEdit && <button type="button" className="dash-set-revert"
              onClick={() => reset([key])}>Back to {JSON.stringify(fallbacks[key])}</button>}
          </div>)}
        </div>
      </section>;
    })}

    {/* Pinned rather than at the foot of a long form, so the count of unsaved changes stays visible
        while scrolling through seven groups of them. */}
    {mayEdit && dirty.length > 0 && <div className="dash-set-bar" role="status">
      <span><strong>{dirty.length}</strong> unsaved change{dirty.length === 1 ? '' : 's'}</span>
      <input type="text" placeholder="Why, in a few words (optional)" value={note} maxLength={200} onChange={e => setNote(e.target.value)}/>
      <Button className="ghost" onClick={() => { setEdits({}); setProblems({}); }} disabled={saving}>Discard</Button>
      <Button loading={saving} onClick={save}><Save size={16}/> Save</Button>
    </div>}

    <section className="dash-set-group">
      <header><div><h2>Change history</h2><p>Every configuration change, newest first.</p></div></header>
      <AuditTrail/>
    </section>
  </>;
}
