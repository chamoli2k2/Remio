import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bot, Copy, Check, Plug, Undo2, ShieldCheck, TriangleAlert, ChevronDown, CircleCheck, Sparkles } from 'lucide-react';
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
 *
 * The connecting half is written for someone who has never heard of MCP. They pick the app they
 * use and follow its own menu names, with the address to paste sitting inside the step that needs
 * it; the panel then watches for the connection arriving, so "did it work?" answers itself.
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

async function copyText(text, done) {
  try { await navigator.clipboard.writeText(text); done?.(); toast.success('Copied'); }
  catch { toast.error('Could not copy — select the text and copy it by hand.'); }
}

/** A value with its own copy button, used for the address, config snippets and prompts alike. */
function CopyRow({ value, label, block = false, onCopy }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => { if (!copied) return undefined; const t = setTimeout(() => setCopied(false), 2000); return () => clearTimeout(t); }, [copied]);
  return <div className={`assistant-token-row ${block ? 'is-block' : ''}`}>
    {block ? <pre>{value}</pre> : <code>{value}</code>}
    <Button type="button" aria-label={label} onClick={() => copyText(value, () => { setCopied(true); onCopy?.(); })}>
      {copied ? <Check size={15}/> : <Copy size={15}/>}<span>{copied ? 'Copied' : 'Copy'}</span>
    </Button>
  </div>;
}

/**
 * Where each app keeps its connector settings, in that app's own words.
 *
 * Kept to the menu names a person will actually see, because "add the MCP server URL" means
 * nothing to most people and "Settings → Connectors → Add custom connector" is a thing they can
 * follow with the window open. Apps rename these menus now and then, which is why every guide
 * ends with what to look for rather than only where.
 */
const APPS = [
  {
    id: 'claude', label: 'Claude', where: 'claude.ai, the desktop app, or the phone app',
    steps: (url, onCopy) => [
      <>Open Claude and go to <b>Settings</b> → <b>Connectors</b>.</>,
      <>Click <b>Add custom connector</b>.</>,
      <>Type <b>{BRAND.name}</b> as the name, and paste this address:<CopyRow value={url} label="Copy connector address" onCopy={onCopy}/></>,
      <>Click <b>Add</b>, then <b>Connect</b>. A {BRAND.name} page opens — click <b>Approve</b>.</>,
      <>Start a new chat. In the tools menu under the message box, make sure <b>{BRAND.name}</b> is switched on.</>,
    ],
    tip: 'No “Connectors” in your settings? Custom connectors depend on your Claude plan, and the menu may be called “Integrations” on older versions.',
  },
  {
    id: 'chatgpt', label: 'ChatGPT', where: 'chatgpt.com on a computer',
    steps: (url, onCopy) => [
      <>Open ChatGPT on the web and go to <b>Settings</b> → <b>Apps &amp; Connectors</b>.</>,
      <>Open <b>Advanced settings</b> and switch on <b>Developer mode</b>.</>,
      <>Back in Apps &amp; Connectors, click <b>Create</b>. Name it <b>{BRAND.name}</b> and paste this address:<CopyRow value={url} label="Copy connector address" onCopy={onCopy}/></>,
      <>Choose <b>OAuth</b> for authentication, tick that you trust the app, and click <b>Create</b>. A {BRAND.name} page opens — click <b>Approve</b>.</>,
      <>In a chat, click <b>+</b> → <b>More</b> and pick <b>{BRAND.name}</b>.</>,
    ],
    tip: 'Developer mode is needed for ChatGPT to add cards for you, and it is only offered on some ChatGPT plans.',
  },
  {
    id: 'other', label: 'Cursor & others', where: 'Cursor, VS Code, Windsurf, or any app that supports MCP',
    steps: (url, onCopy) => [
      <>Open your app’s <b>MCP</b> or <b>Tools</b> settings and choose to add a new server. In Cursor that is <b>Settings</b> → <b>MCP</b> → <b>Add new MCP server</b>.</>,
      <>If it asks for a URL, paste this:<CopyRow value={url} label="Copy connector address" onCopy={onCopy}/></>,
      <>If it asks for a JSON file instead, paste this:<CopyRow block value={JSON.stringify({ mcpServers: { [BRAND.slug]: { url } } }, null, 2)} label="Copy configuration" onCopy={onCopy}/></>,
      <>Save. Your app opens a {BRAND.name} page — click <b>Approve</b>.</>,
    ],
    tip: 'If your app cannot open a sign-in page, use a token instead — it is under “Advanced” at the bottom of this panel.',
  },
];

const PROMPTS = [
  `Make 15 flashcards from this PDF and save them to a new ${BRAND.name} collection called “Biology”.`,
  `Turn my notes below into ${BRAND.name} flashcards, with a question on the front and a short answer on the back.`,
  `Add 10 flashcards about the French Revolution to my History collection in ${BRAND.name}.`,
  `Show me my ${BRAND.name} collections.`,
];

/**
 * Watches for a new connection after the address is copied, so success is something the person
 * sees here rather than something they have to go and check.
 *
 * Polls rather than listening, because the connection is made by another app talking to the
 * server and there is no event on this page to hear. Every five seconds for five minutes, then
 * it gives up quietly — the list below still updates whenever the panel is next opened.
 */
function useConnectionWatch(grants, refetch) {
  const [since, setSince] = useState(null);
  const known = useRef(new Set());
  const [arrived, setArrived] = useState(null);

  const start = () => {
    known.current = new Set(grants.map(g => g.id));
    setArrived(null);
    setSince(Date.now());
  };
  useEffect(() => {
    if (!since) return undefined;
    const timer = setInterval(() => {
      if (Date.now() - since > 5 * 60_000) { setSince(null); return; }
      refetch();
    }, 5000);
    return () => clearInterval(timer);
  }, [since, refetch]);
  useEffect(() => {
    if (!since) return;
    const fresh = grants.find(g => !known.current.has(g.id));
    if (fresh) { setArrived(fresh); setSince(null); }
  }, [grants, since]);
  return { watching: !!since, arrived, start, dismiss: () => setArrived(null) };
}

function Guide({ endpoint, grants, refetch }) {
  const [app, setApp] = useState(grants.length ? '' : 'claude');
  const watch = useConnectionWatch(grants, refetch);
  const chosen = APPS.find(a => a.id === app);

  return <div className="assistant-guide">
    {watch.arrived && <div className="assistant-success" role="status">
      <CircleCheck size={20}/>
      <div><strong>{watch.arrived.name || 'Your assistant'} is connected.</strong><p>Go back to it and try one of the requests below.</p></div>
      <Button className="ghost small" onClick={watch.dismiss}>OK</Button>
    </div>}

    <p className="assistant-step-title"><span>1</span> Which assistant do you use?</p>
    <div className="assistant-apps" role="tablist" aria-label="Choose your assistant">
      {APPS.map(a => <button key={a.id} type="button" role="tab" aria-selected={app === a.id} className={app === a.id ? 'active' : ''} onClick={() => setApp(app === a.id ? '' : a.id)}>
        <strong>{a.label}</strong><small>{a.where}</small>
      </button>)}
    </div>

    {chosen && <>
      <p className="assistant-step-title"><span>2</span> Connect it — about a minute</p>
      <ol className="assistant-steps">{chosen.steps(endpoint, watch.start).map((step, i) => <li key={i}>{step}</li>)}</ol>
      <p className="muted assistant-tip">{chosen.tip}</p>
      {watch.watching && <div className="assistant-waiting" role="status"><span className="assistant-pulse" aria-hidden="true"/> Waiting for {chosen.label} to connect… finish the steps above and this will update by itself.</div>}

      <p className="assistant-step-title"><span>3</span> Ask it for cards</p>
      <ul className="assistant-prompts">{PROMPTS.map(p => <li key={p}><CopyRow value={p} label="Copy this request"/></li>)}</ul>
    </>}
  </div>;
}

/** Shown once, and said so plainly, because the next screen genuinely cannot show it again. */
function NewToken({ token, endpoint, onDone }) {
  const config = JSON.stringify({ mcpServers: { [BRAND.slug]: { url: endpoint, headers: { Authorization: `Bearer ${token}` } } } }, null, 2);
  return <div className="assistant-token">
    <p><strong>Copy this now.</strong> It is the only time it can be shown. If you lose it, disconnect this one and make another.</p>
    <CopyRow value={token} label="Copy token"/>
    <p className="muted">Or paste this whole block into an app that takes a JSON configuration:</p>
    <CopyRow block value={config} label="Copy configuration with token"/>
    <Button className="secondary" onClick={onDone}>Done</Button>
  </div>;
}

function ConnectForm({ onCreated, max, count }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState(SCOPE_IDS);
  const toggle = id => setScopes(s => (s.includes(id) ? s.filter(x => x !== id) : SCOPE_IDS.filter(x => s.includes(x) || x === id)));
  if (count >= max) return <p className="muted">You have connected {max} assistants, which is the limit. Disconnect one you no longer use to make another.</p>;
  return <form className="form-stack assistant-form" onSubmit={async e => {
    e.preventDefault(); setBusy(true); setError('');
    try {
      const d = await api('/agent/grants', { method: 'POST', body: { name: name.trim(), scopes } });
      onCreated(d.token); setName('');
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }}>
    <Field label="What are you connecting?" hint="Just a label, so you can tell them apart later.">
      <input required maxLength={60} value={name} onChange={e => setName(e.target.value)} placeholder="My notes app"/>
    </Field>
    <fieldset className="assistant-scopes">
      <legend>What it may do</legend>
      {SCOPE_IDS.map(id => <label key={id}>
        <input type="checkbox" checked={scopes.includes(id)} onChange={() => toggle(id)}/>
        <span><strong>{SCOPES[id].label}</strong><small>{SCOPES[id].detail}</small></span>
      </label>)}
    </fieldset>
    {error && <ErrorState message={error}/>}
    <Button className="primary" type="submit" loading={busy} disabled={!scopes.length}><Plug size={16}/> Create token</Button>
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
  const { data, loading, error, refetch } = useQuery('/agent');
  const store = useStore();
  const [fresh, setFresh] = useState('');
  const [advanced, setAdvanced] = useState(false);

  if (loading && !data) return <section className="settings-panel"><Loading/></section>;
  if (error) return <section className="settings-panel"><ErrorState message={error}/></section>;
  if (!data?.enabled) return null;

  const { grants = [], usage, endpoint, entitled, maxGrants } = data;
  const reload = () => store.invalidate('/agent');

  return <section className="settings-panel assistant-panel" id="assistants">
    <h2><Bot size={18}/> AI assistants</h2>
    <p>Connect Claude or ChatGPT, then just ask it to <em>“make flashcards from this PDF”</em>. The cards go straight into your library.</p>

    {!entitled
      ? <div className="assistant-locked">
        <p><Sparkles size={16}/> Connecting an assistant is part of Premium.</p>
        <Link className="button primary" to="/premium">See Premium</Link>
      </div>
      : <>
        <Guide endpoint={endpoint} grants={grants} refetch={refetch}/>

        {/*
          * Said before anything is connected rather than buried in a help page, because it is the
          * one thing a person should know before pointing a model at their library: a document
          * can carry instructions, and the defence is that there is nothing dangerous to
          * instruct. Better they read why it is safe than trust that it is.
          */}
        <div className="assistant-note">
          <ShieldCheck size={17}/>
          <p>An assistant can only <strong>add</strong>. It cannot delete a card, change one you already have, or publish anything. Pictures it adds are re-made into our own file first, and only go into private collections. Everything it writes is listed below and can be undone.</p>
        </div>

        <h3>Connected{grants.length ? ` · ${grants.length}` : ''}</h3>
        {!grants.length
          ? <p className="muted">Nothing connected yet. Follow the steps above and your assistant will appear here.</p>
          : <ul className="assistant-grants">{grants.map(g => <li key={g.id}>
            <div>
              <strong>{g.name}</strong>
              <small>
                {g.scopes.map(s => SCOPES[s]?.label).filter(Boolean).join(' · ')}
                {' — last used '}{ago(g.lastUsedAt)}
                {g.expired && <span className="assistant-expired"> · expired, connect it again</span>}
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

        <div className="assistant-advanced">
          <button type="button" className="text-button" aria-expanded={advanced} onClick={() => setAdvanced(v => !v)}>
            <ChevronDown size={15} className={advanced ? 'is-open' : ''}/> Advanced: connect with a token instead
          </button>
          {advanced && <>
            <p className="muted">For apps that cannot open a {BRAND.name} sign-in page. You paste a secret token into the app instead — treat it like a password.</p>
            {fresh
              ? <NewToken token={fresh} endpoint={endpoint} onDone={() => { setFresh(''); reload(); }}/>
              : <ConnectForm max={maxGrants} count={grants.length} onCreated={t => { setFresh(t); reload(); }}/>}
          </>}
        </div>
      </>}
    <p className="muted assistant-who">Connections belong to @{user.username} and act only on collections you own or can edit.</p>
  </section>;
}
