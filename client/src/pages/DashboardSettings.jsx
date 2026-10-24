import { useMemo, useState } from 'react';
import { History, RotateCcw, Save, Search, ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../services/api';
import { reportError } from '../services/errors';
import { useApp, useQuery } from '../hooks/useApp';
import { Button, Loading, ErrorState, Empty } from '../components/ui';
import { isSuperadmin } from '../../../shared/account.js';

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

/** Matches a setting by what it is called and what its help says, which is how people remember one. */
const matches = (key, spec, term) => [key, spec.label, spec.help].some(v => String(v || '').toLowerCase().includes(term));

/**
 * One group at a time, chosen from a list beside it, rather than every group stacked into a single
 * page that had to be scrolled to find anything. A search box reaches across all of them, because
 * "where is the image limit" is a question about a setting, not about which group it lives in.
 *
 * Unsaved edits survive switching groups. They are held per key, not per group, so the save bar
 * keeps counting them wherever the page is showing.
 */
export default function DashboardSettings({ group: initialGroup = '', onShowHistory }) {
  const { user, refresh } = useApp();
  const { data, loading, error, refetch } = useQuery('/admin/settings');
  const [active, setActive] = useState(initialGroup);
  const [search, setSearch] = useState('');
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

  const keysOf = id => Object.keys(specs).filter(k => specs[k].group === id);
  const term = search.trim().toLowerCase();
  const shownGroups = groups.filter(g => keysOf(g.id).length);
  const current = shownGroups.find(g => g.id === active) || shownGroups[0];
  // Searching shows every group with a match; otherwise only the chosen one.
  const visible = term
    ? shownGroups.map(g => ({ ...g, keys: keysOf(g.id).filter(k => matches(k, specs[k], term)) })).filter(g => g.keys.length)
    : current ? [{ ...current, keys: keysOf(current.id) }] : [];

  return <div className="dash-settings">
    <nav className="dash-set-nav" aria-label="Setting groups">
      <label className="folder-search dash-set-search"><Search size={15}/><input aria-label="Search settings" placeholder="Find a setting" value={search} onChange={e => setSearch(e.target.value)}/></label>
      {shownGroups.map(g => {
        const keys = keysOf(g.id);
        const unsaved = keys.filter(k => dirty.includes(k)).length;
        const edited = keys.filter(k => overridden.includes(k)).length;
        return <button key={g.id} type="button" className={!term && current?.id === g.id ? 'active' : ''} aria-current={!term && current?.id === g.id ? 'true' : undefined}
          onClick={() => { setActive(g.id); setSearch(''); if (window.scrollY > 120) window.scrollTo({ top: 0, behavior: 'smooth' }); }}>
          <span>{g.label}</span>
          {unsaved ? <b title="Unsaved changes">{unsaved}</b> : edited ? <em title="Changed from the shipped default">{edited}</em> : null}
        </button>;
      })}
      {onShowHistory && <button type="button" className="dash-set-nav-history" onClick={onShowHistory}><History size={14}/> Change history</button>}
    </nav>

    <div className="dash-set-main">
    {!mayEdit && <div className="dash-set-readonly"><ShieldAlert size={18}/>
      <span>You can read every setting here, but only a superadmin can change one. Prices and switches
        are the kind of thing worth two people agreeing on.</span></div>}

    {term && !visible.length && <Empty title="No setting matches" text="Try a different word, such as “price”, “limit” or “assistant”."/>}

    {visible.map(group => {
      const keys = group.keys;
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
    </div>
  </div>;
}
