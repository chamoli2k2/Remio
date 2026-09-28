import { useState } from 'react';
import { Flag, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { Modal, Field, Button, ErrorState } from './ui';
import Select from './Select';
import { api } from '../services/api';
import { messageFor } from '../services/errors';
import { useApp } from '../hooks/useApp';

/** The grounds a notice can be given on, in the words somebody reporting would actually use. */
const REASONS = [
  { value: 'illegal', label: 'It is illegal' },
  { value: 'infringement', label: 'It copies my work without permission' },
  { value: 'privacy', label: 'It exposes private information' },
  { value: 'harmful', label: 'It is abusive, hateful, or dangerous' },
  { value: 'spam', label: 'It is spam or an advertisement' },
  { value: 'other', label: 'Something else' },
];

/**
 * Reporting a published collection.
 *
 * Open to people who are not signed in, because a public folder can be read without an account
 * and the person best placed to notice a problem may not have one. An address is asked for rather
 * than required: it is only used to say what was decided, which is the part of a notice-and-action
 * process that most often gets skipped.
 */
export default function ReportModal({ folder, onClose }) {
  const { user } = useApp();
  const [reason, setReason] = useState('illegal');
  const [detail, setDetail] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      await api(`/folders/${folder.id}/report`, { method: 'POST', body: { reason, detail, email: user ? '' : email } });
      toast.success('Thank you. Someone will look at this.');
      onClose();
    } catch (err) { setError(messageFor(err)); } finally { setBusy(false); }
  }

  return <Modal open onClose={onClose} title={`Report “${folder.title}”`}
    description="Tell us what is wrong with this collection and a person will review it.">
    <form className="form-stack" onSubmit={submit}>
      <Field label="What is the problem?">
        <Select label="Reason" value={reason} onChange={setReason} options={REASONS}/>
      </Field>
      <Field label="Anything else we should know · optional" hint="A link, a page number, or which cards are the problem all help.">
        <textarea maxLength={1000} rows={4} placeholder="Describe the problem" value={detail} onChange={e => setDetail(e.target.value)}/>
      </Field>
      {!user && <Field label="Your email · optional" hint="Only used to tell you what we decided. We will not add you to anything.">
        <input type="email" autoComplete="email" placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)}/>
      </Field>}
      {error && <ErrorState message={error}/>}
      <p className="report-note"><ShieldCheck size={15}/> <span>
        Reports are read by a person, not a filter. If we agree, the collection is unpublished and
        its owner is told why — and they can reply if they think we got it wrong. Please do not
        report something simply because you disagree with it.
      </span></p>
      <div className="modal-actions">
        <Button type="button" className="secondary" onClick={onClose}>Cancel</Button>
        <Button className="primary" type="submit" loading={busy}><Flag size={15}/> Send report</Button>
      </div>
    </form>
  </Modal>;
}
