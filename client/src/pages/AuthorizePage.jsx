import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Bot, ShieldCheck, Undo2 } from 'lucide-react';
import { useApp } from '../hooks/useApp';
import { api } from '../services/api';
import { Button, ErrorState, Loading } from '../components/ui';
import { BRAND } from '../../../shared/brand.js';

/**
 * The approval screen an assistant sends someone to.
 *
 * Everything on it is written on the assumption that the person arrived here from another
 * application and is deciding whether to trust it — which means the interesting content is not
 * what is being granted so much as what cannot be:
 *
 *  - The application's name is whatever it called itself when it registered, so it is presented
 *    as a claim rather than as a fact. The host the result is sent to is the part we can vouch
 *    for, and it is the part worth reading, so it is shown.
 *  - The permissions are described in the same words the server enforces them by, because a
 *    consent screen whose wording has drifted from the code is worse than none.
 *
 * Nothing is granted by loading this page. The decision is a separate request.
 */
export default function AuthorizePage() {
  const { user } = useApp();
  const [params] = useSearchParams();
  const query = Object.fromEntries(params);
  const [state, setState] = useState({ loading: true });
  const [busy, setBusy] = useState('');
  const [picked, setPicked] = useState(null);

  useEffect(() => {
    let live = true;
    api(`/oauth/consent?${params}`)
      .then(data => live && setState({ data }))
      .catch(error => live && setState({ error: error.message }));
    return () => { live = false; };
  }, [params]);

  /**
   * Send the answer, then leave.
   *
   * `window.location.href` rather than the router, because the destination belongs to the
   * application that sent us here. It is always one the client registered in advance — the server
   * refuses to describe, let alone approve, a request pointing anywhere else — so this cannot be
   * turned into an open redirect by editing the address bar.
   */
  async function decide(approve) {
    setBusy(approve ? 'yes' : 'no');
    try {
      const { redirect } = await api('/oauth/consent', { method: 'POST', body: { ...query, approve, ...(approve ? { granted: chosen } : {}) } });
      window.location.href = redirect;
    } catch (e) { setState(s => ({ ...s, error: e.message })); setBusy(''); }
  }

  if (state.loading) return <div className="consent-page"><Loading/></div>;

  if (state.error && !state.data) {
    return <div className="consent-page"><div className="consent-card">
      <h1>That request does not look right</h1>
      <ErrorState message={state.error}/>
      <p className="muted">Nothing has been connected. Go back to the application and try again — if it keeps happening, the application is sending us something we cannot verify, and you should not approve it.</p>
      <Link className="button secondary" to="/settings?section=assistants">Back to settings</Link>
    </div></div>;
  }

  const { client, scopes, entitled, enabled } = state.data;
  const blocked = !enabled || !entitled;
  const options = state.data.available || scopes.map(s => ({ ...s, requested: true }));
  const chosen = picked ?? options.filter(s => s.requested).map(s => s.id);
  const toggle = id => setPicked(chosen.includes(id) ? chosen.filter(x => x !== id) : options.map(o => o.id).filter(x => x === id || chosen.includes(x)));
  const canEdit = chosen.includes('cards:edit');

  return <div className="consent-page"><div className="consent-card">
    <div className="consent-head">
      <Bot size={26}/>
      <h1>Connect to {BRAND.name}?</h1>
      {/* "calling itself" is doing real work here: the name is self-declared at registration. */}
      <p>An application calling itself <strong>{client.name || 'an assistant'}</strong> wants access to your collections.</p>
    </div>

    <dl className="consent-facts">
      <div><dt>Signed in as</dt><dd>@{user.username}</dd></div>
      <div><dt>Results are sent to</dt><dd><code>{client.redirectHost}</code></dd></div>
    </dl>

    {blocked
      ? <div className="consent-blocked">
        {enabled
          ? <><p>Connecting an assistant is part of Premium.</p><Link className="button primary" to="/premium">See Premium</Link></>
          : <p>Assistant connections are switched off at the moment. Nothing in your library is affected.</p>}
        <Button className="secondary" onClick={() => decide(false)} loading={busy === 'no'}>Go back to the application</Button>
      </div>
      : <>
        <h2>Choose what it may do</h2>
        <ul className="consent-scopes">{options.map(s => <li key={s.id}>
          <label>
            <input type="checkbox" checked={chosen.includes(s.id)} onChange={() => toggle(s.id)}/>
            <span><strong>{s.label}{s.optIn && <em className="consent-optional">Optional</em>}{!s.requested && !s.optIn && <em className="consent-optional">Not requested</em>}</strong><small>{s.detail}</small></span>
          </label>
        </li>)}</ul>

        <div className="consent-note">
          <ShieldCheck size={17}/>
          <p>{canEdit
            ? 'It can add cards and edit them one at a time in private collections. Every edit is kept in the card’s history. It can never delete anything, publish, or see your email or payment details.'
            : 'It can only add. It cannot delete a card, change one you already have, see your email or payment details, or publish anything.'}
          {' '}<Undo2 size={13} className="consent-inline-icon"/> Everything it adds is listed in your settings and can be undone in one click, and you can disconnect it at any time.</p>
        </div>

        <div className="consent-actions">
          <Button className="primary" loading={busy === 'yes'} disabled={!!busy || !chosen.length} onClick={() => decide(true)}>Approve</Button>
          <Button className="secondary" loading={busy === 'no'} disabled={!!busy} onClick={() => decide(false)}>Cancel</Button>
        </div>
        {state.error && <ErrorState message={state.error}/>}
        <p className="muted consent-foot">Only approve this if you just asked {client.name || 'this application'} to connect.</p>
      </>}
  </div></div>;
}
