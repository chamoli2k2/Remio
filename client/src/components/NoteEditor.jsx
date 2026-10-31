import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Bold, Italic, Heading2, List, ListChecks, Code, Sigma, ImagePlus, PenLine, Pencil, Eye, PenSquare, Pin, PinOff, Trash2, X, CloudOff, CircleCheck, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../services/api';
import { messageFor } from '../services/errors';
import { useApp, useQuery } from '../hooks/useApp';
import { Button, ErrorState, Loading } from './ui';
import { PlainText } from './CollabText';
import RichText from './RichText';
import Img from './Img';
import DrawingView from './DrawingView';
const DrawingEditor = lazy(() => import('./DrawingEditor'));
import { NOTE_LIMITS, embedLine, embedsIn, segmentsOf } from '../../../shared/notes.js';
import { BRAND } from '../../../shared/brand.js';

const SAVE_AFTER = 1500;
const fieldsOf = note => ({ title: note.title || '', body: note.body || '', tags: note.tags || [], pinned: !!note.pinned });
const same = (a, b) => a.title === b.title && a.body === b.body && a.pinned === b.pinned && a.tags.join('\n') === b.tags.join('\n');

/** The page as a reader sees it: Markdown, with pictures and drawings where their lines sit. */
export function NotePreview({ body, basePath, onEditDrawing }) {
  const parts = segmentsOf(body);
  if (!parts.length) return <p className="preview-empty">Nothing on this page yet.</p>;
  return <div className="note-preview">{parts.map((p, i) => p.kind === 'text' ? <RichText key={i} text={p.text}/>
    : p.kind === 'media' ? <figure key={i} className="note-figure"><Img id={p.id} alt={p.caption || 'Picture'} sizes="(max-width: 760px) 92vw, 720px"/>{p.caption && <figcaption>{p.caption}</figcaption>}</figure>
    : <figure key={i} className="note-figure is-drawing">
      <DrawingView basePath={basePath} id={p.id} label={p.caption || 'Drawing'}/>
      {onEditDrawing && <button type="button" className="button secondary small note-figure-edit" onClick={() => onEditDrawing(p.id)}><Pencil size={14}/> Edit drawing</button>}
      {p.caption && <figcaption>{p.caption}</figcaption>}
    </figure>)}</div>;
}

/**
 * One page, saved by itself a moment after typing stops.
 *
 * Every save carries the version it was based on. If someone else saved in between, the server
 * refuses and sends their page back; this person keeps what they typed and chooses which to keep.
 * The draft also sits in this tab's storage, so a reload or a lost connection loses nothing.
 */
export default function NoteEditor({ notebook, noteId, onSaved, onDeleted }) {
  const { user } = useApp();
  const basePath = `/notebooks/${notebook.id}`;
  const draftKey = `${BRAND.storage.draft}:note:${user.id}:${noteId}`;
  const { data, error, loading, setData } = useQuery(`/notes/${noteId}`, null, { staleAfter: 0 });
  const cached = useRef(data); cached.current = data;
  const setCached = fn => setData(fn(cached.current));
  const canEdit = !notebook.archived && ['owner', 'editor'].includes(data?.role || notebook.role);

  const [form, setForm] = useState(null), [mode, setMode] = useState('write'), [status, setStatus] = useState('saved');
  const [conflict, setConflict] = useState(null), [saveError, setSaveError] = useState(''), [uploading, setUploading] = useState(false), [drawing, setDrawing] = useState(null), [tag, setTag] = useState('');
  const textRef = useRef(null);
  const saved = useRef(null), version = useRef(0), latest = useRef(null), inFlight = useRef(false), timer = useRef(0);
  latest.current = form;
  // Held in a ref so a parent re-rendering does not rebuild `save`, which would flush on every render.
  const savedHandler = useRef(onSaved); savedHandler.current = onSaved;

  // Seeded once per page. A draft left from an earlier visit wins if it was based on the version
  // still on the server; if the page moved on since, both are shown and the person picks.
  useEffect(() => {
    if (!data?.note || form) return;
    const server = fieldsOf(data.note);
    saved.current = server; version.current = data.note.version;
    let draft = null;
    try { draft = JSON.parse(sessionStorage.getItem(draftKey)); } catch { /* unreadable draft: start from the server copy */ }
    if (draft?.form && !same(draft.form, server)) {
      setForm(draft.form); setStatus('dirty');
      if (draft.base !== data.note.version) { version.current = draft.base; setConflict(data.note); setStatus('conflict'); }
    } else setForm(server);
    if (!['owner', 'editor'].includes(data.role) || notebook.archived) setMode('preview');
  }, [data, form, draftKey, notebook.archived]);

  // The first render may come from cache; a newer copy arriving underneath replaces it as long as
  // nothing has been typed yet.
  useEffect(() => {
    if (!data?.note || !form || !saved.current || data.note.version <= version.current) return;
    if (!same(latest.current, saved.current) || inFlight.current) return;
    saved.current = fieldsOf(data.note); version.current = data.note.version; setForm(fieldsOf(data.note));
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = useCallback(async () => {
    clearTimeout(timer.current);
    const current = latest.current;
    if (!current || !saved.current || inFlight.current || same(current, saved.current)) return;
    inFlight.current = true; setStatus('saving'); setSaveError('');
    const patch = { version: version.current };
    for (const k of ['title', 'body', 'pinned']) if (current[k] !== saved.current[k]) patch[k] = current[k];
    if (current.tags.join('\n') !== saved.current.tags.join('\n')) patch.tags = current.tags;
    try {
      const r = await api(`/notes/${noteId}`, { method: 'PATCH', body: patch });
      version.current = r.note.version; saved.current = fieldsOf({ ...saved.current, ...patch, ...r.note });
      setCached(c => ({ ...c, note: r.note }));
      savedHandler.current?.(r.note);
      if (same(latest.current, saved.current)) { setStatus('saved'); try { sessionStorage.removeItem(draftKey); } catch {} }
      else { setStatus('dirty'); timer.current = setTimeout(save, SAVE_AFTER); }
    } catch (e) {
      if (e.code === 'VERSION_CONFLICT' && e.details?.note) { setConflict(e.details.note); setStatus('conflict'); }
      else { setStatus('error'); setSaveError(messageFor(e)); }
    } finally { inFlight.current = false; }
  }, [noteId, draftKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!form || !saved.current) return undefined;
    try { sessionStorage.setItem(draftKey, JSON.stringify({ base: version.current, form })); } catch { /* storage full: the server copy still autosaves */ }
    if (same(form, saved.current)) return undefined;
    if (conflict) return undefined;
    setStatus(s => (s === 'saving' ? s : 'dirty'));
    clearTimeout(timer.current);
    timer.current = setTimeout(save, SAVE_AFTER);
    return () => clearTimeout(timer.current);
  }, [form, conflict, save, draftKey]);

  // Leaving the page or the tab saves what is pending rather than waiting out the timer.
  const conflicted = useRef(false); conflicted.current = !!conflict;
  useEffect(() => {
    const flush = () => { if (!conflicted.current) save(); };
    window.addEventListener('pagehide', flush);
    return () => { window.removeEventListener('pagehide', flush); flush(); };
  }, [save]);

  const update = patch => setForm(f => ({ ...f, ...patch }));
  const wrap = (before, after, fallback) => textRef.current?.wrap(before, after, fallback);
  const insertLine = line => (textRef.current ? wrap(`\n${line}\n`, '', '') : setForm(f => ({ ...f, body: `${f.body.replace(/\s*$/, '')}\n\n${line}\n` })));

  function keepMine() { version.current = conflict.version; saved.current = fieldsOf(conflict); setConflict(null); setStatus('dirty'); }
  function takeTheirs() { version.current = conflict.version; saved.current = fieldsOf(conflict); setForm(fieldsOf(conflict)); setConflict(null); setStatus('saved'); try { sessionStorage.removeItem(draftKey); } catch {} }

  async function upload(file) {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { toast.error('Choose an image smaller than 5 MB.'); return; }
    if (embedsIn(latest.current.body).filter(e => e.kind === 'media').length >= NOTE_LIMITS.imagesPerNote) { toast.error(`A page can hold up to ${NOTE_LIMITS.imagesPerNote} images.`); return; }
    setUploading(true);
    try {
      const fd = new FormData(); fd.append('image', file);
      const r = await api(`${basePath}/images`, { method: 'POST', body: fd });
      insertLine(embedLine('media', r.id, file.name.replace(/\.[a-z0-9]+$/i, '').slice(0, 80)));
    } catch (e) { toast.error(messageFor(e)); } finally { setUploading(false); }
  }
  const onPaste = e => { const file = [...(e.clipboardData?.items || [])].find(i => i.type.startsWith('image/'))?.getAsFile(); if (file) { e.preventDefault(); upload(file); } };
  const onKeyDown = e => {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); save(); }
    else if (mod && !e.shiftKey && e.key === 'b') { e.preventDefault(); wrap('**', '**', 'bold'); }
    else if (mod && !e.shiftKey && e.key === 'i') { e.preventDefault(); wrap('_', '_', 'italic'); }
  };
  function drawingSaved(id) {
    const old = drawing?.id;
    if (old) update({ body: latest.current.body.replaceAll(`(drawing:${old})`, `(drawing:${id})`) });
    else insertLine(embedLine('drawing', id, 'Drawing'));
    setDrawing(null);
  }
  function addTag() {
    const next = tag.trim().toLowerCase().replace(/^#/, '').slice(0, 30);
    if (next && !form.tags.includes(next) && form.tags.length < NOTE_LIMITS.tags) update({ tags: [...form.tags, next] });
    setTag('');
  }
  async function remove() {
    if (!window.confirm(`Delete “${form.title || 'Untitled page'}”? Its pictures and drawings go with it.`)) return;
    clearTimeout(timer.current); saved.current = null;
    try { await api(`/notes/${noteId}`, { method: 'DELETE' }); try { sessionStorage.removeItem(draftKey); } catch {} toast.success('Page deleted'); onDeleted?.(noteId); }
    catch (e) { toast.error(messageFor(e)); }
  }

  if (loading && !form) return <Loading/>;
  if (error && !form) return <ErrorState message={error}/>;
  if (!form) return <Loading/>;
  const statusLabel = { saved: <><CircleCheck size={13}/> Saved</>, dirty: 'Unsaved changes', saving: <><Loader2 className="spin" size={13}/> Saving…</>, conflict: 'Not saved: someone else edited this page', error: <><CloudOff size={13}/> Not saved</> }[status];
  const embeds = embedsIn(form.body);

  return <article className="note-editor">
    {conflict && <div className="note-conflict" role="alert">
      <div><strong>{conflict.updatedBy?.name || 'Someone'} saved this page while you were editing.</strong><span>Your version is still here and has not been saved.</span></div>
      <div><Button className="secondary small" onClick={takeTheirs}>Load their version</Button><Button className="primary small" onClick={keepMine}>Keep mine</Button></div>
    </div>}
    <div className="note-head">
      <input className="note-title" aria-label="Page title" placeholder="Untitled page" maxLength={NOTE_LIMITS.title} value={form.title} readOnly={!canEdit} onChange={e => update({ title: e.target.value })}/>
      <div className="note-head-actions">
        <span className={`note-status is-${status}`} aria-live="polite">{canEdit ? statusLabel : notebook.archived ? 'Archived · read only' : 'View only'}</span>
        {canEdit && <button type="button" className="icon-button" aria-pressed={form.pinned} title={form.pinned ? 'Unpin page' : 'Pin to the top'} aria-label={form.pinned ? 'Unpin page' : 'Pin page'} onClick={() => update({ pinned: !form.pinned })}>{form.pinned ? <PinOff size={17}/> : <Pin size={17}/>}</button>}
        {canEdit && <button type="button" className="icon-button" title="Delete page" aria-label="Delete page" onClick={remove}><Trash2 size={17}/></button>}
      </div>
    </div>
    {saveError && status === 'error' && <div className="note-save-error"><ErrorState message={saveError}/><Button className="secondary small" onClick={save}>Try again</Button></div>}
    <div className="note-tags">{form.tags.map(t => <span className="tag" key={t}>{t}{canEdit && <button type="button" aria-label={`Remove ${t} tag`} onClick={() => update({ tags: form.tags.filter(v => v !== t) })}><X size={12}/></button>}</span>)}
      {canEdit && form.tags.length < NOTE_LIMITS.tags && <input aria-label="Add a tag" placeholder="+ tag" value={tag} maxLength={30} onChange={e => setTag(e.target.value)} onBlur={addTag} onKeyDown={e => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag(); } }}/>}
    </div>
    {canEdit && <div className="editor-toolbar note-toolbar" role="toolbar" aria-label="Page formatting">
      <div className="note-mode" role="tablist" aria-label="Editor mode">
        <button type="button" role="tab" aria-selected={mode === 'write'} className={mode === 'write' ? 'is-active' : ''} onClick={() => setMode('write')}><PenSquare size={14}/> Write</button>
        <button type="button" role="tab" aria-selected={mode === 'preview'} className={mode === 'preview' ? 'is-active' : ''} onClick={() => setMode('preview')}><Eye size={14}/> Preview</button>
      </div>
      {mode === 'write' && <>
        <button type="button" title="Bold (⌘B)" aria-label="Bold" onClick={() => wrap('**', '**', 'bold')}><Bold size={14}/></button>
        <button type="button" title="Italic (⌘I)" aria-label="Italic" onClick={() => wrap('_', '_', 'italic')}><Italic size={14}/></button>
        <button type="button" title="Heading" aria-label="Heading" onClick={() => wrap('\n## ', '', 'Heading')}><Heading2 size={14}/></button>
        <button type="button" title="Bulleted list" aria-label="Bulleted list" onClick={() => wrap('\n- ', '', 'Item')}><List size={14}/></button>
        <button type="button" title="Checklist" aria-label="Checklist" onClick={() => wrap('\n- [ ] ', '', 'To do')}><ListChecks size={14}/></button>
        <button type="button" title="Code" aria-label="Code" onClick={() => wrap('`', '`', 'code')}><Code size={14}/></button>
        <button type="button" title="Math · LaTeX between $…$" aria-label="Math" onClick={() => wrap('$', '$', '\\frac{a}{b}')}><Sigma size={14}/></button>
      </>}
      <span className="note-toolbar-gap"/>
      <label className="upload-button"><ImagePlus size={15}/>{uploading ? 'Uploading…' : 'Image'}<input type="file" accept="image/png,image/jpeg,image/webp" disabled={uploading} onChange={e => { upload(e.target.files[0]); e.target.value = ''; }}/></label>
      <button type="button" className="upload-button" onClick={() => setDrawing({ id: null })}><PenLine size={15}/> Draw</button>
    </div>}
    {mode === 'write' && canEdit
      ? <div className="note-write" onKeyDown={onKeyDown}>
        <PlainText ref={textRef} value={form.body} onChange={v => update({ body: v })} onPaste={onPaste} aria-label="Page text" maxLength={NOTE_LIMITS.body} placeholder="Start writing. Markdown works: **bold**, - lists, ## headings, $math$. Paste a screenshot to add it."/>
        {embeds.length > 0 && <div className="note-attachments" aria-label="Pictures and drawings on this page">{embeds.map((e, i) => <div className="note-attachment" key={`${e.id}-${i}`}>
          {e.kind === 'media' ? <Img id={e.id} alt={e.caption || 'Picture'} sizes="120px" width={120}/> : <button type="button" className="note-attachment-drawing" title="Edit drawing" onClick={() => setDrawing({ id: e.id })}><DrawingView basePath={basePath} id={e.id} label={e.caption || 'Drawing'}/></button>}
          <span>{e.caption || (e.kind === 'media' ? 'Picture' : 'Drawing')}</span>
        </div>)}</div>}
        <small className="note-count">{form.body.length.toLocaleString()} / {NOTE_LIMITS.body.toLocaleString()}</small>
      </div>
      : <NotePreview body={form.body} basePath={basePath} onEditDrawing={canEdit ? id => setDrawing({ id }) : null}/>}
    {drawing && <Suspense fallback={null}><DrawingEditor basePath={basePath} target="page" drawingId={drawing.id} title={drawing.id ? 'Edit drawing' : 'New drawing'} onClose={() => setDrawing(null)} onSave={drawingSaved}/></Suspense>}
  </article>;
}
