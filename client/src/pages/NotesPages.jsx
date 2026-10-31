import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Plus, Search, Archive, ArchiveRestore, ArrowLeft, Pencil, Share2, Trash2, Users, LockKeyhole, Pin, FilePlus2, NotebookPen, Check, ShieldCheck, Library, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../services/api';
import { messageFor, reportError } from '../services/errors';
import { useApp, useQuery } from '../hooks/useApp';
import { Avatar, Button, Empty, ErrorState, Field, FolderIcon, icons, Loading, Menu, Modal } from '../components/ui';
import Select from '../components/Select';
import NoteEditor from '../components/NoteEditor';
import { snippetOf } from '../../../shared/notes.js';

const COLORS = ['violet', 'blue', 'orange', 'green', 'pink', 'slate'];
const ICONS = [...new Set([...Object.keys(icons).slice(0, 6), 'book'])];
const ago = iso => {
  const s = Math.max(0, (Date.now() - new Date(iso)) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
};
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** What differs between a collection and a notebook in the shared modals. */
const KINDS = {
  collection: { label: 'collection', Label: 'Collection', api: id => `/note-collections${id ? `/${id}` : ''}`, link: id => `/notes/c/${id}`, icon: 'layers', placeholder: 'e.g. Semester 3', blurb: 'Group notebooks that belong together. Sharing a collection shares every notebook in it.', inside: 'notebook' },
  notebook: { label: 'notebook', Label: 'Notebook', api: id => `/notebooks${id ? `/${id}` : ''}`, link: id => `/notes/${id}`, icon: 'book', placeholder: 'e.g. Organic chemistry', blurb: 'Keep pages about one subject together.', inside: 'page' },
};

function DetailsModal({ kind, item, collectionId, collections, onClose, onSaved }) {
  const k = KINDS[kind]; const navigate = useNavigate(); const { refresh } = useApp();
  const [form, setForm] = useState({ title: item?.title || '', description: item?.description || '', color: item?.color || 'violet', icon: item?.icon || k.icon });
  const [moveTo, setMoveTo] = useState(item?.collection?.id || '');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const update = (key, v) => setForm(f => ({ ...f, [key]: v }));
  async function submit(e) {
    e.preventDefault(); setBusy(true); setError('');
    try {
      const body = item ? { ...form, version: item.version, ...(moveTo ? { collection: moveTo } : {}) } : { ...form, ...(kind === 'notebook' ? { collection: collectionId } : {}) };
      const d = await api(k.api(item?.id), { method: item ? 'PATCH' : 'POST', body });
      const saved = d[kind];
      toast.success(item ? `${k.Label} updated` : `Your new ${k.label} is ready`);
      refresh('/note-collections', '/notebooks'); onSaved?.(saved); onClose();
      if (!item) navigate(k.link(saved.id));
    } catch (err) { setError(messageFor(err)); } finally { setBusy(false); }
  }
  const movable = kind === 'notebook' && item?.role === 'owner' && (collections || []).filter(c => c.role === 'owner').length > 1;
  return <Modal open onClose={onClose} title={item ? `Edit ${k.label}` : `A new ${k.label}`} description={`${k.blurb} ${kind === 'collection' ? 'Only you can see it until you share it.' : 'Everyone who can open its collection can open it.'}`}>
    <form className="form-stack" onSubmit={submit}>
      <div className={`folder-preview ${form.color}`}><span className="folder-icon"><FolderIcon name={form.icon} size={28}/></span><strong>{form.title || `Your new ${k.label}`}</strong></div>
      <Field label={`${k.Label} name`}><input autoFocus required maxLength={80} placeholder={k.placeholder} value={form.title} onChange={e => update('title', e.target.value)}/></Field>
      <Field label="Description · optional"><textarea maxLength={500} rows={2} placeholder="What goes in here?" value={form.description} onChange={e => update('description', e.target.value)}/></Field>
      {movable && <div className="field"><span className="input-label">Collection</span><Select label="Collection" value={moveTo} onChange={setMoveTo} options={collections.filter(c => c.role === 'owner').map(c => ({ value: c.id, label: c.title }))}/></div>}
      <div className="appearance-row">
        <div><span className="input-label">Color</span><div className="color-picker">{COLORS.map(c => <button key={c} type="button" className={`color-swatch ${c} ${form.color === c ? 'selected' : ''}`} aria-label={`${c} color`} aria-pressed={form.color === c} onClick={() => update('color', c)}>{form.color === c && <Check size={14}/>}</button>)}</div></div>
        <div><span className="input-label">Icon</span><div className="icon-picker">{ICONS.map(icon => <button key={icon} type="button" className={`icon-button ${form.icon === icon ? 'selected' : ''}`} aria-label={`${icon} icon`} aria-pressed={form.icon === icon} onClick={() => update('icon', icon)}><FolderIcon name={icon} size={18}/></button>)}</div></div>
      </div>
      {error && <ErrorState message={error}/>}
      <div className="modal-actions"><Button type="button" className="secondary" onClick={onClose}>Cancel</Button><Button className="primary" type="submit" loading={busy}>{item ? 'Save changes' : `Create ${k.label}`} <Plus size={16}/></Button></div>
    </form>
  </Modal>;
}

function ShareModal({ kind, item: initial, onClose, onSaved }) {
  const k = KINDS[kind];
  const [item, setItem] = useState(initial), [username, setUsername] = useState(''), [role, setRole] = useState('viewer'), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const owner = item.role === 'owner';
  async function member(name, value) {
    setBusy(true); setError('');
    try {
      const d = await api(`${k.api(item.id)}/members`, { method: 'POST', body: { username: name.replace(/^@/, '').toLowerCase().trim(), role: value } });
      setItem(d[kind]); onSaved?.(d[kind]); setUsername('');
      toast.success(value === 'remove' ? 'Access removed' : `${k.Label} access updated`);
    } catch (e) { setError(messageFor(e)); } finally { setBusy(false); }
  }
  const description = kind === 'collection'
    ? 'Everyone you add here can open every notebook in this collection, including ones added later.'
    : item.collection ? `People with access to “${item.collection.title}” can already open this. Add someone here to share only this notebook.` : 'Only the people you add here can open it.';
  return <Modal open onClose={onClose} title={`Share “${item.title}”`} description={description}>
    <div className="form-stack">
      {owner && <form className="invite-form" onSubmit={e => { e.preventDefault(); member(username, role); }}>
        <label className="username-input"><span>@</span><input aria-label="Username to share with" required placeholder="Add by username" value={username} onChange={e => setUsername(e.target.value)} pattern="@?[a-zA-Z0-9_]{3,24}"/></label>
        <Select compact label="Invite role" value={role} onChange={setRole} options={[{ value: 'viewer', label: 'Can read' }, { value: 'editor', label: 'Can edit' }]}/>
        <Button className="primary" loading={busy} type="submit">Add</Button>
      </form>}
      <div><span className="input-label">People with access</span>
        <div className="member-row"><Avatar user={item.owner}/><div><strong>{item.owner?.name}</strong><small>@{item.owner?.username}</small></div><span className="muted">Owner</span></div>
        {item.members.map(m => <div className="member-row" key={m.user.id}><Avatar user={m.user}/><div><strong>{m.user.name}</strong><small>@{m.user.username}</small></div>
          {owner ? <Select compact disabled={busy} label={`Role for ${m.user.username}`} value={m.role} onChange={v => member(m.user.username, v)} options={[{ value: 'viewer', label: 'Can read' }, { value: 'editor', label: 'Can edit' }, { value: 'remove', label: 'Remove access' }]}/> : <span className="muted">{m.role === 'editor' ? 'Can edit' : 'Can read'}</span>}
        </div>)}
      </div>
      {error && <ErrorState message={error}/>}
      <div className="sharing-note"><ShieldCheck size={17}/><span>{kind === 'collection' ? 'Editors can add notebooks and write pages. Only you can delete or share.' : 'If two people edit the same page at once, the second save is held back so nobody’s work is overwritten.'}</span></div>
      <div className="modal-actions"><span/><Button className="primary" onClick={onClose}>Done <Check size={17}/></Button></div>
    </div>
  </Modal>;
}

function DeleteModal({ kind, item, onClose, onDeleted }) {
  const k = KINDS[kind]; const { refresh } = useApp();
  const [confirm, setConfirm] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function submit(e) {
    e.preventDefault(); setBusy(true); setError('');
    try { await api(k.api(item.id), { method: 'DELETE', body: { confirm } }); toast.success(`${k.Label} deleted`); onClose(); onDeleted(); refresh('/note-collections', '/notebooks', '/notes/'); }
    catch (err) { setError(messageFor(err)); setBusy(false); }
  }
  const what = kind === 'collection' ? 'Every notebook in it, with all their pages, pictures and drawings, is removed' : 'Every page, picture and drawing in it is removed';
  return <Modal open onClose={onClose} title={`Delete “${item.title}”?`} description={`${what} for everyone it is shared with. This cannot be undone.`}>
    <form className="form-stack" onSubmit={submit}>
      <Field label={`Type ${item.title} to confirm`}><input autoFocus autoComplete="off" value={confirm} onChange={e => setConfirm(e.target.value)} placeholder={item.title}/></Field>
      {error && <ErrorState message={error}/>}
      <div className="modal-actions"><Button type="button" className="secondary" onClick={onClose}>Cancel</Button><Button className="danger-button" type="submit" loading={busy} disabled={confirm !== item.title}>Delete {k.label}</Button></div>
    </form>
  </Modal>;
}

const access = x => x.role === 'owner' ? (x.members.length ? <><Users size={12}/> Shared</> : <><LockKeyhole size={12}/> Private</>) : <><Users size={12}/> {x.owner?.name}</>;

function CollectionTile({ collection: c }) {
  return <Link to={`/notes/c/${c.id}`} className={`notebook-tile is-collection ${c.color}`}>
    <span className="collection-stack" aria-hidden="true"/>
    <span className="notebook-tile-icon"><FolderIcon name={c.icon} size={20}/></span>
    <strong>{c.title}</strong>
    <p>{c.description || 'A collection of notebooks.'}</p>
    <span className="notebook-tile-foot"><span>{plural(c.notebookCount, 'notebook')}</span><span>{access(c)}</span><span>{ago(c.updatedAt)}</span></span>
  </Link>;
}

function NotebookTile({ notebook: n, showCollection, inCollection }) {
  return <Link to={`/notes/${n.id}`} className={`notebook-tile ${n.color}`}>
    <span className="notebook-spine"/>
    <span className="notebook-tile-icon"><FolderIcon name={n.icon} size={20}/></span>
    <strong>{n.title}</strong>
    <p>{n.description || 'A place for your pages.'}</p>
    <span className="notebook-tile-foot">
      <span>{plural(n.noteCount, 'page')}</span>
      {showCollection && n.collection ? <span><Library size={12}/> {n.collection.title}</span> : inCollection ? (n.members.length > 0 && <span><Users size={12}/> Also shared with {n.members.length}</span>) : <span>{access(n)}</span>}
      <span>{ago(n.updatedAt)}</span>
    </span>
  </Link>;
}

function SearchResults({ term }) {
  const results = useQuery(`/notes/search?q=${encodeURIComponent(term)}`, null, { staleAfter: 0 });
  return <section className="note-results" aria-label="Search results">
    {results.loading ? <Loading/> : results.error ? <ErrorState message={results.error}/> : !results.data?.notes?.length
      ? <Empty title="No pages match" text={`Nothing in your notes mentions “${term}”.`}/>
      : results.data.notes.map(n => <Link key={n.id} to={`/notes/${n.notebook}/${n.id}`} className="note-result">
        <span className={`folder-dot ${n.notebookColor}`}/><div><strong>{n.title || 'Untitled page'}</strong><small>{n.notebookTitle} · {ago(n.updatedAt)}</small>{n.snippet && <p>{n.snippet}</p>}</div>
      </Link>)}
  </section>;
}

/** The Notes tab: collections first, then notebooks someone shared on their own, then archived ones. */
export function NotesPage() {
  const [create, setCreate] = useState(false), [archived, setArchived] = useState(false), [q, setQ] = useState(''), [term, setTerm] = useState('');
  useEffect(() => { const t = setTimeout(() => setTerm(q.trim()), 250); return () => clearTimeout(t); }, [q]);
  const tree = useQuery('/note-collections');
  const old = useQuery('/notebooks?archived=1', null, { enabled: archived });
  const collections = tree.data?.collections || [], shared = tree.data?.sharedNotebooks || [];
  const mine = collections.filter(c => c.role === 'owner'), theirs = collections.filter(c => c.role !== 'owner');
  const { loading, error } = archived ? old : tree;
  return <>
    <div className="page-heading"><div><div className="eyebrow">YOUR WORKSPACE</div><h1>Notes</h1><p>Collections hold notebooks, and notebooks hold your pages, with pictures and drawings alongside.</p></div><Button className="primary" onClick={() => setCreate(true)}><Plus size={18}/> New collection</Button></div>
    <div className="library-toolbar">
      <div className="tabs" role="tablist" aria-label="Notes filters">
        <button role="tab" aria-selected={!archived} className={!archived ? 'active' : ''} onClick={() => setArchived(false)}>Collections{!archived && <span>{collections.length}</span>}</button>
        <button role="tab" aria-selected={archived} className={archived ? 'active' : ''} onClick={() => setArchived(true)}>Archived notebooks</button>
      </div>
      <div className="toolbar-right"><div className="folder-search"><Search size={16}/><input type="search" aria-label="Search all your notes" placeholder="Search all notes" maxLength={100} value={q} onChange={e => setQ(e.target.value)}/></div></div>
    </div>
    {term.length >= 2 ? <SearchResults term={term}/>
      : loading ? <Loading/> : error ? <ErrorState message={error}/>
      : archived ? (!old.data?.notebooks?.length
        ? <Empty title="Nothing archived" text="Notebooks you archive wait here, read-only, until you restore them."/>
        : <div className="notebook-grid">{old.data.notebooks.map(n => <NotebookTile key={n.id} notebook={n} showCollection/>)}</div>)
      : !collections.length && !shared.length
        ? <Empty title="Start your first collection" text="A collection holds notebooks, like a shelf for one semester or one project. Each notebook holds pages of notes." action={<Button className="primary" onClick={() => setCreate(true)}><NotebookPen size={17}/> Create a collection</Button>}/>
        : <>
          {mine.length > 0 && <div className="notebook-grid">{mine.map(c => <CollectionTile key={c.id} collection={c}/>)}</div>}
          {theirs.length > 0 && <><h2 className="notebook-section">Collections shared with you</h2><div className="notebook-grid">{theirs.map(c => <CollectionTile key={c.id} collection={c}/>)}</div></>}
          {shared.length > 0 && <><h2 className="notebook-section">Notebooks shared with you</h2><div className="notebook-grid">{shared.map(n => <NotebookTile key={n.id} notebook={n}/>)}</div></>}
        </>}
    {create && <DetailsModal kind="collection" onClose={() => setCreate(false)}/>}
  </>;
}

export function CollectionPage() {
  const { id } = useParams(); const navigate = useNavigate();
  const { data, loading, error, setData } = useQuery(`/note-collections/${id}`, null, { staleAfter: 5_000 });
  const [modal, setModal] = useState('');
  if (loading) return <Loading/>;
  if (error) return <Empty title="This collection isn’t available" text={error} action={<Link to="/notes" className="button primary">Back to notes</Link>}/>;
  const { collection, notebooks } = data;
  const owner = collection.role === 'owner', canAdd = ['owner', 'editor'].includes(collection.role);
  const setCollection = c => setData({ ...data, collection: { ...c, notebookCount: notebooks.length } });
  const items = [
    owner && { label: 'Edit collection', icon: <Pencil size={15}/>, action: () => setModal('edit') },
    { label: owner ? 'Share collection' : 'People with access', icon: <Share2 size={15}/>, action: () => setModal('share') },
    owner && { label: 'Delete collection', icon: <Trash2 size={15}/>, danger: true, action: () => setModal('delete') },
  ];
  return <div className="notebook-page">
    <header className={`notebook-head ${collection.color}`}>
      <Link to="/notes" className="icon-button" aria-label="All collections" title="All collections"><ArrowLeft size={18}/></Link>
      <span className="notebook-tile-icon"><FolderIcon name={collection.icon} size={18}/></span>
      <div><h1>{collection.title}</h1><small>{plural(notebooks.length, 'notebook')}{collection.role !== 'owner' ? ` · ${collection.owner?.name}’s collection` : collection.members.length ? ` · Shared with ${collection.members.length}` : ' · Private'}</small></div>
      <div className="notebook-head-actions">
        {canAdd && <Button className="primary small" onClick={() => setModal('new')}><Plus size={15}/> New notebook</Button>}
        <Menu items={items} label={`Options for ${collection.title}`}/>
      </div>
    </header>
    {collection.description && <p className="collection-description">{collection.description}</p>}
    {!notebooks.length
      ? <Empty title="No notebooks yet" text={canAdd ? 'Add a notebook for each subject or topic in this collection.' : 'Notebooks added by the owner and editors appear here.'} action={canAdd && <Button className="primary" onClick={() => setModal('new')}><NotebookPen size={17}/> Create a notebook</Button>}/>
      : <div className="notebook-grid">{notebooks.map(n => <NotebookTile key={n.id} notebook={n} inCollection/>)}</div>}
    {modal === 'new' && <DetailsModal kind="notebook" collectionId={collection.id} onClose={() => setModal('')}/>}
    {modal === 'edit' && <DetailsModal kind="collection" item={collection} onClose={() => setModal('')} onSaved={setCollection}/>}
    {modal === 'share' && <ShareModal kind="collection" item={collection} onClose={() => setModal('')} onSaved={setCollection}/>}
    {modal === 'delete' && <DeleteModal kind="collection" item={collection} onClose={() => setModal('')} onDeleted={() => navigate('/notes')}/>}
  </div>;
}

export function NotebookPage() {
  const { id, noteId } = useParams(); const navigate = useNavigate(); const { refresh } = useApp();
  const { data, loading, error, refetch, setData } = useQuery(`/notebooks/${id}`, null, { staleAfter: 5_000 });
  const [modal, setModal] = useState(''), [filter, setFilter] = useState(''), [creating, setCreating] = useState(false);
  const tree = useQuery('/note-collections', null, { enabled: modal === 'edit' });
  // Saves land after the render that started them, so they patch whatever the list is by then.
  const current = useRef(data); current.current = data;
  const patch = fn => setData(fn(current.current));
  if (loading) return <Loading/>;
  if (error) return <Empty title="This notebook isn’t available" text={error} action={<Link to="/notes" className="button primary">Back to notes</Link>}/>;
  const { notebook, notes } = data;
  const canEdit = !notebook.archived && ['owner', 'editor'].includes(notebook.role);
  const owner = notebook.role === 'owner';
  const home = notebook.collection?.role ? notebook.collection : null;
  const up = home ? `/notes/c/${home.id}` : '/notes';
  const visible = filter.trim() ? notes.filter(n => `${n.title} ${n.snippet} ${n.tags.join(' ')}`.toLowerCase().includes(filter.trim().toLowerCase())) : notes;
  const setNotebook = nb => patch(d => ({ ...d, notebook: { ...nb, noteCount: d.notes.length } }));

  async function newPage() {
    setCreating(true);
    try {
      const r = await api(`/notebooks/${id}/notes`, { method: 'POST', body: { title: '', body: '' } });
      patch(d => ({ ...d, notes: [{ ...r.note, snippet: '' }, ...d.notes] })); refresh('/notebooks', '/note-collections');
      navigate(`/notes/${id}/${r.note.id}`);
    } catch (e) { reportError(e); } finally { setCreating(false); }
  }
  async function archive(value) {
    try { const d = await api(`/notebooks/${id}/archive`, { method: 'PATCH', body: { archived: value } }); setNotebook(d.notebook); refresh('/notebooks', '/note-collections'); toast.success(value ? 'Notebook archived. It is read-only until restored.' : 'Notebook restored'); }
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
      <Link to={up} className="icon-button" aria-label={home ? `Back to ${home.title}` : 'All notes'} title={home ? `Back to ${home.title}` : 'All notes'}><ArrowLeft size={18}/></Link>
      <span className="notebook-tile-icon"><FolderIcon name={notebook.icon} size={18}/></span>
      <div>{home && <nav className="notes-crumbs" aria-label="Breadcrumb"><Link to="/notes">Notes</Link><ChevronRight size={12}/><Link to={up}>{home.title}</Link></nav>}<h1>{notebook.title}</h1><small>{notes.length} {notes.length === 1 ? 'page' : 'pages'}{notebook.archived ? ' · Archived' : ''}{home ? (notebook.members.length ? ` · Also shared with ${notebook.members.length}` : '') : notebook.role !== 'owner' ? ` · ${notebook.owner?.name}’s notebook` : notebook.members.length ? ` · Shared with ${notebook.members.length}` : ' · Private'}</small></div>
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
    {modal === 'edit' && <DetailsModal kind="notebook" item={notebook} collections={tree.data?.collections} onClose={() => setModal('')} onSaved={setNotebook}/>}
    {modal === 'share' && <ShareModal kind="notebook" item={notebook} onClose={() => { setModal(''); refetch(); }} onSaved={setNotebook}/>}
    {modal === 'delete' && <DeleteModal kind="notebook" item={notebook} onClose={() => setModal('')} onDeleted={() => navigate(up)}/>}
  </div>;
}
