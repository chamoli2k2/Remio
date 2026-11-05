import { useEffect, useState } from 'react';
import { Bot, History, Undo2 } from 'lucide-react';
import { api } from '../services/api';
import { messageFor } from '../services/errors';
import { Button, ErrorState, Modal } from './ui';

const when = value => { try { return new Date(value).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }); } catch { return ''; } };

/**
 * What this page said before it was last changed, newest first, with a button to put one back.
 *
 * Restoring does not write anything itself: it hands the old title, text and tags to the editor,
 * which saves them like any other edit — against the current version, so it cannot overwrite a
 * change somebody else made in the meantime, and keeping the text it replaces as a new entry here.
 */
export default function NoteHistory({ noteId, open, onClose, onRestore }) {
  const [state, setState] = useState({ loading: true, rows: [], error: '' });
  const [busy, setBusy] = useState('');
  useEffect(() => {
    if (!open) return undefined;
    let live = true;
    setState({ loading: true, rows: [], error: '' });
    api(`/notes/${noteId}/revisions`)
      .then(d => live && setState({ loading: false, rows: d.revisions, error: '' }))
      .catch(e => live && setState({ loading: false, rows: [], error: messageFor(e) }));
    return () => { live = false; };
  }, [open, noteId]);

  async function restore(row) {
    setBusy(row.id);
    try { const d = await api(`/notes/${noteId}/revisions/${row.id}`); onRestore(d.revision); onClose(); }
    catch (e) { setState(s => ({ ...s, error: messageFor(e) })); } finally { setBusy(''); }
  }

  return <Modal open={open} onClose={onClose} title="Earlier versions" description="Each one is what the page said just before a change. Restoring one replaces what is on the page now, and keeps that as an earlier version too.">
    {state.error && <ErrorState message={state.error}/>}
    {state.loading ? <p className="muted">Loading…</p>
      : !state.rows.length && !state.error ? <p className="muted">No earlier versions yet. They appear once the page has been changed.</p>
      : <ul className="note-history">{state.rows.map(r => <li key={r.id}>
        <div>
          <strong>{r.title || 'Untitled page'}</strong>
          <small>{r.via === 'assistant' ? <><Bot size={12}/> Before a change by {r.by || 'an assistant'}</> : <><History size={12}/> Before a change{r.by ? ` by ${r.by}` : ''}</>} · {when(r.createdAt)} · {r.chars.toLocaleString('en')} characters</small>
          {r.snippet && <p>{r.snippet}</p>}
        </div>
        <Button className="secondary small" loading={busy === r.id} onClick={() => restore(r)}><Undo2 size={14}/> Restore</Button>
      </li>)}</ul>}
  </Modal>;
}
