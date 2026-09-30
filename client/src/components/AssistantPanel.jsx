import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Bot, Copy, Check, Plug, Undo2, ShieldCheck, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import { useApp, useQuery, useStore } from '../hooks/useApp';
import { api } from '../services/api';
import { Button, Field, ErrorState, Loading } from './ui';
import { SCOPES, SCOPE_IDS } from '../../../shared/agent.js';
import { BRAND } from '../../../shared/brand.js';

/**
 * Connecting an assistant, and reviewing what it did.
 *
 * Two halves of one idea, kept on one panel on purpose. The review list is not a separate feature
 * bolted on afterwards; it is the thing that makes handing a model write access to your library a
 * reasonable decision, and putting it anywhere else would let somebody connect an assistant
 * without ever noticing they can undo it.
 */

const ago = value => {
  if (!value) return 'never';
  const mins = Math.round((Date.now() - new Date(value)) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days < 30 ? `${days} d ago` : new Date(value).toLocaleDateString();
};

/** Shown once, and said so plainly, because the next screen genuinely cannot show it again. */
function NewToken({ token, onDone }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try { await navigator.clipboard.writeText(token); setCopied(true); toast.success('Copied'); }
    catch { toast.error('Could not copy — select the text and copy it by hand.'); }
  }
  return <div className="assistant-token">
    <p><strong>Copy this now.</strong> It is the only time it can be shown. If you lose it, disconnect this one and make another.</p>
    <div className="assistant-token-row">
      <code>{token}</code>
      <Button onClick={copy} aria-label="Copy token">{copied ? <Check size={15}/> : <Copy size={15}/>}</Button>
    </div>
    <Button className="secondary" onClick={onDone}>Done</Button>
  </div>;
}

function ConnectForm({ onCreated, max, count }) {
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState(SCOPE_IDS);
  const toggle = id => setScopes(s => (s.includes(id) ? s.filter(x => x !== id) : SCOPE_IDS.filter(x => s.includes(x) || x === id)));
  const full = count >= max;

  if (!open) {
    return <Button className="secondary" disabled={full} onClick={() => setOpen(true)}>
      <Plug size={16}/> {full ? `Limit of ${max} reached` : 'Create a connection token'}
    </Button>;
  }
  return <form className="form-stack assistant-form" onSubmit={async e => {
    e.preventDefault(); setBusy(true); setError('');
    try {
      const d = await api('/agent/grants', { method: 'POST', body: { name: name.trim(), scopes } });
      onCreated(d.token); setOpen(false); setName('');
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }}>
    <Field label="What are you connecting?" hint="Just a label, so you can tell them apart later.">
      <input required maxLength={60} value={name} onChange={e => setName(e.target.value)} placeholder="Claude Desktop"/>
    </Field>
    <fieldset className="assistant-scopes">
      <legend>What it may do</legend>
      {SCOPE_IDS.map(id => <label key={id}>
        <input type="checkbox" checked={scopes.includes(id)} onChange={() => toggle(id)}/>
        <span><strong>{SCOPES[id].label}</strong><small>{SCOPES[id].detail}</small></span>
      </label>)}
    </fieldset>
    {error && <ErrorState message={error}/>}
    <div className="assistant-actions">
      <Button className="primary" type="submit" loading={busy} disabled={!scopes.length}>Create token</Button>
      <Button className="secondary" type="button" onClick={() => { setOpen(false); setError(''); }}>Cancel</Button>
    </div>
  </form>;
}

/**
 * A batch in a few words: what it added, or what it did if it added nothing.
 *
 * Setting a cover writes no cards, so the count alone would describe it as "0 cards" — which
 * reads like a failure rather than the thing that happened.
 */
function summarise({ cardCount, imageCount, cover }) {
  const parts = [];
  if (cardCount) parts.push(`${cardCount} ${cardCount === 1 ? 'card' : 'cards'}`);
  if (cover) parts.push(cardCount ? 'a cover' : 'A cover');
  else if (imageCount) parts.push(`${imageCount} ${imageCount === 1 ? 'image' : 'images'}`);
  return parts.join(' and ') || 'Nothing';
}

/** What assistants have written lately, and the button that takes it back. */
function Batches() {
  // Keyed by its own path, like every other query here, so the plain GET needs no loader and a
  // prefix invalidation of '/agent' reaches it.
  const { data, error } = useQuery('/agent/batches');
  const store = useStore();
  const [busy, setBusy] = useState('');
  if (error) return <ErrorState message={error}/>;
  const batches = data?.batches || [];
  if (!batches.length) return <p className="muted">Nothing yet. Anything an assistant adds will be listed here so you can check it, and undo it if it is not what you wanted.</p>;

  return <ul className="assistant-batches">{batches.map(b => <li key={b.id}>
    <div>
      <strong>{summarise(b)}</strong>
      {' in '}
      {b.collectionId ? <Link to={`/folders/${b.collectionId}`}>{b.collection}</Link> : <span>{b.collection}</span>}
      <small>{b.by} · {ago(b.createdAt)}</small>
    </div>
    {b.undoneAt
      ? <span className="assistant-undone">Undone</span>
      : <Button className="secondary" loading={busy === b.id} onClick={async () => {
        setBusy(b.id);
        try {
          const d = await api(`/agent/batches/${b.id}/undo`, { method: 'POST' });
          const images = d.imagesRemoved ? ` and ${d.imagesRemoved} ${d.imagesRemoved === 1 ? 'image' : 'images'}` : '';
          toast.success(`Removed ${d.removed} ${d.removed === 1 ? 'card' : 'cards'}${images} from ${d.collection}`);
          // Prefixes, so one call each covers the list and the usage counter above it, and every
          // cached collection page and library listing — all of which just lost cards.
          store.invalidate('/agent', '/folders');
        } catch (e) { toast.error(e.message); } finally { setBusy(''); }
      }}><Undo2 size={15}/> Undo</Button>}
  </li>)}</ul>;
}

export default function AssistantPanel() {
  const { user } = useApp();
  const { data, loading, error } = useQuery('/agent');
  const store = useStore();
  const [fresh, setFresh] = useState('');
  const [copiedUrl, setCopiedUrl] = useState(false);

  if (loading && !data) return <section className="settings-panel"><Loading/></section>;
  if (error) return <section className="settings-panel"><ErrorState message={error}/></section>;
  if (!data?.enabled) return null;

  const { grants = [], usage, endpoint, entitled, maxGrants } = data;
  const reload = () => store.invalidate('/agent');

  return <section className="settings-panel assistant-panel">
    <h2><Bot size={18}/> AI assistants</h2>
    <p>Connect Claude or ChatGPT and ask it to turn a PDF, an article or your notes into cards. It writes them straight into your library.</p>

    {!entitled
      ? <div className="assistant-locked">
        <p>Connecting an assistant is part of Premium.</p>
        <Link className="button primary" to="/premium">See Premium</Link>
      </div>
      : <>
        <div className="assistant-endpoint">
          <Field label={`${BRAND.name} connector URL`} hint="Paste this into your assistant's connector settings. It will ask you to approve the connection here.">
            <div className="assistant-token-row">
              <code>{endpoint}</code>
              <Button aria-label="Copy connector URL" onClick={async () => {
                try { await navigator.clipboard.writeText(endpoint); setCopiedUrl(true); toast.success('Copied'); }
                catch { toast.error('Could not copy — select the text and copy it by hand.'); }
              }}>{copiedUrl ? <Check size={15}/> : <Copy size={15}/>}</Button>
            </div>
          </Field>
        </div>

        {/*
          * Said before anything is connected rather than buried in a help page, because it is the
          * one thing a person should know before pointing a model at their library: a document
          * can carry instructions, and the defence is that there is nothing dangerous to
          * instruct. Better they read why it is safe than trust that it is.
          */}
        <div className="assistant-note">
          <ShieldCheck size={17}/>
          <p>An assistant can only <strong>add</strong>. It cannot delete a card, change one you already have, or publish anything — so if a document you feed it tries to tell it to, there is nothing there to do. Pictures are downloaded from ordinary web addresses, re-encoded into our own file before they are kept, and only ever added to a private collection. Everything it writes is listed below and can be undone.</p>
        </div>

        {fresh
          ? <NewToken token={fresh} onDone={() => { setFresh(''); reload(); }}/>
          : <ConnectForm max={maxGrants} count={grants.length} onCreated={t => { setFresh(t); reload(); }}/>}

        <h3>Connected</h3>
        {!grants.length
          ? <p className="muted">Nothing connected yet.</p>
          : <ul className="assistant-grants">{grants.map(g => <li key={g.id}>
            <div>
              <strong>{g.name}</strong>
              <small>
                {g.scopes.map(s => SCOPES[s]?.label).filter(Boolean).join(' · ')}
                {' — last used '}{ago(g.lastUsedAt)}
                {g.expired && <span className="assistant-expired"> · expired</span>}
              </small>
            </div>
            <Button className="secondary" onClick={async () => {
              try { await api(`/agent/grants/${g.id}`, { method: 'DELETE' }); toast.success(`${g.name} disconnected`); reload(); }
              catch (e) { toast.error(e.message); }
            }}>Disconnect</Button>
          </li>)}</ul>}

        {grants.length > 1 && <Button className="secondary assistant-cut" onClick={async () => {
          try { await api('/agent/grants', { method: 'DELETE' }); toast.success('All assistants disconnected'); reload(); }
          catch (e) { toast.error(e.message); }
        }}><TriangleAlert size={15}/> Disconnect all</Button>}

        <h3>What they have written</h3>
        {/* Two allowances, because fetching a picture costs something writing text does not.
            The image one is only worth the words once it is switched on. */}
        <p className="muted assistant-usage">
          {usage.used} of {usage.limit} cards added today
          {usage.images?.limit ? `, and ${usage.images.used} of ${usage.images.limit} images fetched` : ''}.
          {' '}The allowance resets at midnight UTC, and undoing gives it back.
        </p>
        <Batches/>
      </>}
    <p className="muted assistant-who">Connections belong to @{user.username} and act only on collections you own or can edit.</p>
  </section>;
}
