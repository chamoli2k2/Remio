import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Plus, Search, Archive, ArchiveRestore, ArrowLeft, Pencil, Share2, Trash2, Users, LockKeyhole, Pin, FilePlus2, NotebookPen, Check, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../services/api';
import { messageFor, reportError } from '../services/errors';
import { useApp, useQuery } from '../hooks/useApp';
import { Avatar, Button, Empty, ErrorState, Field, FolderIcon, icons, Loading, Menu, Modal } from '../components/ui';
import Select from '../components/Select';
import NoteEditor from '../components/NoteEditor';
import { snippetOf } from '../../../shared/notes.js';

const COLORS = ['violet', 'blue', 'orange', 'green', 'pink', 'slate'];
const ago = iso => {
  const s = Math.max(0, (Date.now() - new Date(iso)) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
};

function NotebookModal({ notebook, onClose, onSaved }) {
  const navigate = useNavigate(); const { refresh } = useApp();
  const [form, setForm] = useState({ title: notebook?.title || '', description: notebook?.description || '', color: notebook?.color || 'violet', icon: notebook?.icon || 'book' });
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const update = (k, v) => setForm(f => ({ ...f, [k]: v }));
  async function submit(e) {
    e.preventDefault(); setBusy(true); setError('');
    try {
      const d = await api(notebook ? `/notebooks/${notebook.id}` : '/notebooks', { method: notebook ? 'PATCH' : 'POST', body: { ...form, ...(notebook ? { version: notebook.version } : {}) } });
      toast.success(notebook ? 'Notebook updated' : 'Your new notebook is ready');
      refresh('/notebooks'); onSaved?.(d.notebook); onClose();
      if (!notebook) navigate(`/notes/${d.notebook.id}`);
    } catch (err) { setError(messageFor(err)); } finally { setBusy(false); }
  }
  return <Modal open onClose={onClose} title={notebook ? 'Edit notebook' : 'A new notebook'} description="Keep pages about one subject together. Only you can see it until you share it.">
    <form className="form-stack" onSubmit={submit}>
      <div className={`folder-preview ${form.color}`}><span className="folder-icon"><FolderIcon name={form.icon} size={28}/></span><strong>{form.title || 'Your new notebook'}</strong></div>
      <Field label="Notebook name"><input autoFocus required maxLength={80} placeholder="e.g. Organic chemistry" value={form.title} onChange={e => update('title', e.target.value)}/></Field>
      <Field label="Description · optional"><textarea maxLength={500} rows={2} placeholder="What goes in here?" value={form.description} onChange={e => update('description', e.target.value)}/></Field>
      <div className="appearance-row">
        <div><span className="input-label">Color</span><div className="color-picker">{COLORS.map(c => <button key={c} type="button" className={`color-swatch ${c} ${form.color === c ? 'selected' : ''}`} aria-label={`${c} color`} aria-pressed={form.color === c} onClick={() => update('color', c)}>{form.color === c && <Check size={14}/>}</button>)}</div></div>
        <div><span className="input-label">Icon</span><div className="icon-picker">{Object.keys(icons).slice(0, 6).concat('book').filter((v, i, a) => a.indexOf(v) === i).map(icon => <button key={icon} type="button" className={`icon-button ${form.icon === icon ? 'selected' : ''}`} aria-label={`${icon} icon`} aria-pressed={form.icon === icon} onClick={() => update('icon', icon)}><FolderIcon name={icon} size={18}/></button>)}</div></div>
      </div>
      {error && <ErrorState message={error}/>}
      <div className="modal-actions"><Button type="button" className="secondary" onClick={onClose}>Cancel</Button><Button className="primary" type="submit" loading={busy}>{notebook ? 'Save changes' : 'Create notebook'} <Plus size={16}/></Button></div>
    </form>
  </Modal>;
}

function NotebookShareModal({ notebook: initial, onClose, onSaved }) {
  const [notebook, setNotebook] = useState(initial), [username, setUsername] = useState(''), [role, setRole] = useState('viewer'), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const owner = notebook.role === 'owner';
  async function member(name, value) {
    setBusy(true); setError('');
    try {
      const d = await api(`/notebooks/${notebook.id}/members`, { method: 'POST', body: { username: name.replace(/^@/, '').toLowerCase().trim(), role: value } });
      setNotebook(d.notebook); onSaved?.(d.notebook); setUsername('');
      toast.success(value === 'remove' ? 'Access removed' : 'Notebook access updated');
    } catch (e) { setError(messageFor(e)); } finally { setBusy(false); }
  }
  return <Modal open onClose={onClose} title={`Share “${notebook.title}”`} description="Notebooks are private. Only the people you add here can open them.">
    <div className="form-stack">
      {owner && <form className="invite-form" onSubmit={e => { e.preventDefault(); member(username, role); }}>
        <label className="username-input"><span>@</span><input aria-label="Username to share with" required placeholder="Add by username" value={username} onChange={e => setUsername(e.target.value)} pattern="@?[a-zA-Z0-9_]{3,24}"/></label>
        <Select compact label="Invite role" value={role} onChange={setRole} options={[{ value: 'viewer', label: 'Can read' }, { value: 'editor', label: 'Can edit' }]}/>
        <Button className="primary" loading={busy} type="submit">Add</Button>
      </form>}
      <div><span className="input-label">People with access</span>
        <div className="member-row"><Avatar user={notebook.owner}/><div><strong>{notebook.owner?.name}</strong><small>@{notebook.owner?.username}</small></div><span className="muted">Owner</span></div>
        {notebook.members.map(m => <div className="member-row" key={m.user.id}><Avatar user={m.user}/><div><strong>{m.user.name}</strong><small>@{m.user.username}</small></div>
          {owner ? <Select compact disabled={busy} label={`Role for ${m.user.username}`} value={m.role} onChange={v => member(m.user.username, v)} options={[{ value: 'viewer', label: 'Can read' }, { value: 'editor', label: 'Can edit' }, { value: 'remove', label: 'Remove access' }]}/> : <span className="muted">{m.role === 'editor' ? 'Can edit' : 'Can read'}</span>}
        </div>)}
      </div>
      {error && <ErrorState message={error}/>}
      <div className="sharing-note"><ShieldCheck size={17}/><span>If two people edit the same page at once, the second save is held back so nobody’s work is overwritten.</span></div>
      <div className="modal-actions"><span/><Button className="primary" onClick={onClose}>Done <Check size={17}/></Button></div>
    </div>
  </Modal>;
}

function DeleteNotebookModal({ notebook, onClose }) {
  const navigate = useNavigate(); const { refresh } = useApp();
  const [confirm, setConfirm] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function submit(e) {
    e.preventDefault(); setBusy(true); setError('');
    try { await api(`/notebooks/${notebook.id}`, { method: 'DELETE', body: { confirm } }); toast.success('Notebook deleted'); onClose(); navigate('/notes'); refresh('/notebooks', '/notes/'); }
    catch (err) { setError(messageFor(err)); setBusy(false); }
  }
  return <Modal open onClose={onClose} title={`Delete “${notebook.title}”?`} description="Every page, picture and drawing in it is removed for everyone it is shared with. This cannot be undone.">
    <form className="form-stack" onSubmit={submit}>
      <Field label={`Type ${notebook.title} to confirm`}><input autoFocus autoComplete="off" value={confirm} onChange={e => setConfirm(e.target.value)} placeholder={notebook.title}/></Field>
      {error && <ErrorState message={error}/>}
      <div className="modal-actions"><Button type="button" className="secondary" onClick={onClose}>Cancel</Button><Button className="danger-button" type="submit" loading={busy} disabled={confirm !== notebook.title}>Delete notebook</Button></div>
    </form>
  </Modal>;
}

function NotebookTile({ notebook: n }) {
  return <Link to={`/notes/${n.id}`} className={`notebook-tile ${n.color}`}>
    <span className="notebook-spine"/>
    <span className="notebook-tile-icon"><FolderIcon name={n.icon} size={20}/></span>
    <strong>{n.title}</strong>
    <p>{n.description || 'A place for your pages.'}</p>
    <span className="notebook-tile-foot">
      <span>{n.noteCount} {n.noteCount === 1 ? 'page' : 'pages'}</span>
      <span>{n.role === 'owner' ? (n.members.length ? <><Users size={12}/> Shared</> : <><LockKeyhole size={12}/> Private</>) : <><Users size={12}/> {n.owner?.name}</>}</span>
      <span>{ago(n.updatedAt)}</span>
    </span>
  </Link>;
}

export function NotesPage() {
  const [create, setCreate] = useState(false), [archived, setArchived] = useState(false), [q, setQ] = useState(''), [term, setTerm] = useState('');
  useEffect(() => { const t = setTimeout(() => setTerm(q.trim()), 250); return () => clearTimeout(t); }, [q]);
  const { data, loading, error } = useQuery(`/notebooks${archived ? '?archived=1' : ''}`);
  const results = useQuery(term.length >= 2 ? `/notes/search?q=${encodeURIComponent(term)}` : null, null, { staleAfter: 0 });
  const notebooks = data?.notebooks || [];
  const mine = notebooks.filter(n => n.role === 'owner'), shared = notebooks.filter(n => n.role !== 'owner');
  return <>
    <div className="page-heading"><div><div className="eyebrow">YOUR WORKSPACE</div><h1>Notes</h1><p>Write things down in your own words, with pictures and drawings alongside.</p></div><Button className="primary" onClick={() => setCreate(true)}><Plus size={18}/> New notebook</Button></div>
    <div className="library-toolbar">
      <div className="tabs" role="tablist" aria-label="Notebook filters">
        <button role="tab" aria-selected={!archived} className={!archived ? 'active' : ''} onClick={() => setArchived(false)}>Notebooks{!archived && <span>{notebooks.length}</span>}</button>
        <button role="tab" aria-selected={archived} className={archived ? 'active' : ''} onClick={() => setArchived(true)}>Archived</button>
      </div>
      <div className="toolbar-right"><div className="folder-search"><Search size={16}/><input type="search" aria-label="Search all your notes" placeholder="Search all notes" maxLength={100} value={q} onChange={e => setQ(e.target.value)}/></div></div>
    </div>
    {term.length >= 2 ? <section className="note-results" aria-label="Search results">
      {results.loading ? <Loading/> : results.error ? <ErrorState message={results.error}/> : !results.data?.notes?.length
        ? <Empty title="No pages match" text={`Nothing in your notebooks mentions “${term}”.`}/>
        : results.data.notes.map(n => <Link key={n.id} to={`/notes/${n.notebook}/${n.id}`} className="note-result">
          <span className={`folder-dot ${n.notebookColor}`}/><div><strong>{n.title || 'Untitled page'}</strong><small>{n.notebookTitle} · {ago(n.updatedAt)}</small>{n.snippet && <p>{n.snippet}</p>}</div>
        </Link>)}
    </section>
      : loading ? <Loading/> : error ? <ErrorState message={error}/> : !notebooks.length
        ? <Empty title={archived ? 'Nothing archived' : 'Start your first notebook'} text={archived ? 'Notebooks you archive wait here, read-only, until you restore them.' : 'A notebook holds pages of notes: lecture notes, summaries, sketches of an idea.'} action={!archived && <Button className="primary" onClick={() => setCreate(true)}><NotebookPen size={17}/> Create a notebook</Button>}/>
        : <>
          {mine.length > 0 && <div className="notebook-grid">{mine.map(n => <NotebookTile key={n.id} notebook={n}/>)}</div>}
          {shared.length > 0 && <><h2 className="notebook-section">Shared with you</h2><div className="notebook-grid">{shared.map(n => <NotebookTile key={n.id} notebook={n}/>)}</div></>}
        </>}
    {create && <NotebookModal onClose={() => setCreate(false)}/>}
  </>;
}

export function NotebookPage() {
  const { id, noteId } = useParams(); const navigate = useNavigate(); const { refresh } = useApp();
  const { data, loading, error, refetch, setData } = useQuery(`/notebooks/${id}`, null, { staleAfter: 5_000 });
  const [modal, setModal] = useState(''), [filter, setFilter] = useState(''), [creating, setCreating] = useState(false);
  // Saves land after the render that started them, so they patch whatever the list is by then.
  const current = useRef(data); current.current = data;
  const patch = fn => setData(fn(current.current));
  if (loading) return <Loading/>;
  if (error) return <Empty title="This notebook isn’t available" text={error} action={<Link to="/notes" className="button primary">Back to notes</Link>}/>;
  const { notebook, notes } = data;
  const canEdit = !notebook.archived && ['owner', 'editor'].includes(notebook.role);
  const owner = notebook.role === 'owner';
  const visible = filter.trim() ? notes.filter(n => `${n.title} ${n.snippet} ${n.tags.join(' ')}`.toLowerCase().includes(filter.trim().toLowerCase())) : notes;
  const setNotebook = nb => patch(d => ({ ...d, notebook: { ...nb, noteCount: d.notes.length } }));

  async function newPage() {
    setCreating(true);
    try {
      const r = await api(`/notebooks/${id}/notes`, { method: 'POST', body: { title: '', body: '' } });
      patch(d => ({ ...d, notes: [{ ...r.note, snippet: '' }, ...d.notes] })); refresh('/notebooks');
      navigate(`/notes/${id}/${r.note.id}`);
    } catch (e) { reportError(e); } finally { setCreating(false); }
  }
  async function archive(value) {
    try { const d = await api(`/notebooks/${id}/archive`, { method: 'PATCH', body: { archived: value } }); setNotebook(d.notebook); refresh('/notebooks'); toast.success(value ? 'Notebook archived. It is read-only until restored.' : 'Notebook restored'); }
    catch (e) { reportError(e); }
  }
  const onSaved = note => patch(d => ({ ...d, notes: d.notes.map(n => n.id === note.id ? { ...n, ...note, body: undefined, snippet: snippetOf(note.body) } : n) }));
  const onDeleted = gone => { patch(d => ({ ...d, notes: d.notes.filter(n => n.id !== gone) })); navigate(`/notes/${id}`, { replace: true }); };
  const items = [
    owner && { label: 'Edit notebook', icon: <Pencil size={15}/>, action: () => setModal('edit') },
    { label: owner ? 'Share notebook' : 'People with access', icon: <Share2 size={15}/>, action: () => setModal('share') },
    owner && { label: notebook.archived ? 'Restore notebook' : 'Archive notebook', icon: notebook.archived ? <ArchiveRestore size={15}/> : <Archive size={15}/>, action: () => archive(!notebook.archived) },
    owner && { label: 'Delete notebook', icon: <Trash2 size={15}/>, danger: true, action: () => setModal('delete') },
  ];

  return <div className={`notebook-page ${noteId ? 'has-note' : ''}`}>
    <header className={`notebook-head ${notebook.color}`}>
      <Link to="/notes" className="icon-button" aria-label="All notebooks" title="All notebooks"><ArrowLeft size={18}/></Link>
      <span className="notebook-tile-icon"><FolderIcon name={notebook.icon} size={18}/></span>
      <div><h1>{notebook.title}</h1><small>{notes.length} {notes.length === 1 ? 'page' : 'pages'}{notebook.archived ? ' · Archived' : ''}{notebook.role !== 'owner' ? ` · ${notebook.owner?.name}’s notebook` : notebook.members.length ? ` · Shared with ${notebook.members.length}` : ' · Private'}</small></div>
      <div className="notebook-head-actions">
        {notebook.archived && owner && <Button className="secondary small" onClick={() => archive(false)}><ArchiveRestore size={15}/> Restore</Button>}
        <Menu items={items} label={`Options for ${notebook.title}`}/>
      </div>
    </header>
    <div className="notebook-body">
      <aside className="note-list" aria-label="Pages">
        <div className="note-list-tools">
          {canEdit && <Button className="primary small" loading={creating} onClick={newPage}><FilePlus2 size={15}/> New page</Button>}
          {notes.length > 5 && <input type="search" aria-label="Filter pages" placeholder="Filter pages" value={filter} onChange={e => setFilter(e.target.value)}/>}
        </div>
        {!notes.length ? <p className="note-list-empty">{canEdit ? 'No pages yet. Start one to begin writing.' : 'No pages yet.'}</p>
          : <nav>{visible.map(n => <Link key={n.id} to={`/notes/${id}/${n.id}`} className={`note-link ${n.id === noteId ? 'active' : ''}`} aria-current={n.id === noteId ? 'page' : undefined}>
            <strong>{n.pinned && <Pin size={12}/>}{n.title || 'Untitled page'}</strong>
            <span>{n.snippet || 'Empty page'}</span>
            <small>{ago(n.updatedAt)}{n.updatedBy && notebook.members.length ? ` · ${n.updatedBy.name}` : ''}</small>
          </Link>)}</nav>}
      </aside>
      <section className="note-pane">
        {noteId
          ? <><Link to={`/notes/${id}`} className="text-button note-back"><ArrowLeft size={15}/> All pages</Link><NoteEditor key={noteId} notebook={notebook} noteId={noteId} onSaved={onSaved} onDeleted={onDeleted}/></>
          : <div className="note-pane-empty"><NotebookPen size={28}/><h3>{notes.length ? 'Pick a page to read or edit' : 'An empty notebook'}</h3><p>{canEdit ? 'Pages save themselves as you type.' : 'Pages added by the owner and editors appear here.'}</p>{canEdit && <Button className="primary" loading={creating} onClick={newPage}><FilePlus2 size={16}/> New page</Button>}</div>}
      </section>
    </div>
    {modal === 'edit' && <NotebookModal notebook={notebook} onClose={() => setModal('')} onSaved={setNotebook}/>}
    {modal === 'share' && <NotebookShareModal notebook={notebook} onClose={() => { setModal(''); refetch(); }} onSaved={setNotebook}/>}
    {modal === 'delete' && <DeleteNotebookModal notebook={notebook} onClose={() => setModal('')}/>}
  </div>;
}
