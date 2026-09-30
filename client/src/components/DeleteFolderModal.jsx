import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../services/api';
import { reportError } from '../services/errors';
import { Button, Modal, Field, ErrorState } from './ui';

/**
 * Permanent folder deletion, gated on typing the title.
 *
 * The server re-checks the name against the live title, so skipping this dialog (or sending the
 * wrong string) does not delete anything. Matching is exact after trim, as shown on the folder.
 */
export default function DeleteFolderModal({ folder, onClose, onDeleted }) {
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const matches = confirm.trim() === folder.title;
  const cards = folder.cardCount ?? 0;

  async function submit(e) {
    e.preventDefault();
    if (!matches) return;
    setBusy(true);
    setError('');
    try {
      const result = await api(`/folders/${folder.id}`, { method: 'DELETE', body: { confirm } });
      toast.success(`“${result.title}” and ${result.cards === 1 ? '1 card' : `${result.cards} cards`} deleted`);
      onDeleted(result);
    } catch (err) {
      setError(err.message);
      reportError(err);
      setBusy(false);
    }
  }

  return <Modal open onClose={onClose} title={`Delete “${folder.title}”?`}
    description="This permanently deletes the folder and every card in it. It cannot be undone.">
    <form className="form-stack" onSubmit={submit}>
      <div className="danger-note">
        <p>Every flashcard in this collection goes with it, including pictures, study history, and anything an assistant added here.</p>
        {cards > 0 && <p>{cards === 1 ? '1 card' : `${cards} cards`} will be removed.</p>}
      </div>
      <Field label={`Type ${folder.title} to confirm`}>
        <input autoFocus autoComplete="off" value={confirm} onChange={e => setConfirm(e.target.value)} placeholder={folder.title}/>
      </Field>
      {error && <ErrorState message={error}/>}
      <div className="modal-actions">
        <Button type="button" className="secondary" onClick={onClose}>Keep folder</Button>
        <Button className="danger-button" type="submit" loading={busy} disabled={!matches}><Trash2 size={16}/> Delete forever</Button>
      </div>
    </form>
  </Modal>;
}
