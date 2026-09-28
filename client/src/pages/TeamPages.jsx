import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Users, GraduationCap, Plus, Crown, Copy, Link2, Trash2, UserMinus, ShieldCheck, Clock3,
  ClipboardList, CalendarClock, ArrowUpRight, BarChart3, Ticket, LogIn,
} from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../services/api';
import { reportError, messageFor } from '../services/errors';
import { useApp, useQuery } from '../hooks/useApp';
import { useMoney } from '../hooks/useMoney';
import { sellsTo } from '../../../shared/pricing.js';
import { Button, Field, Modal, Loading, Empty, ErrorState, Avatar, FolderIcon, Menu } from '../components/ui';
import FolderModal from '../components/FolderModal';
import PaymentForm from '../components/PaymentForm';
import { NotOnSaleHere, PaymentAside } from './PremiumPage';
import { TEAM_KINDS, TEAM_PLANS, SEATS, teamPlanById, clampSeats } from '../../../shared/teams.js';

const KIND_ICON = { classroom: GraduationCap, team: Users };
const day = value => new Date(value).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

/** One badge that says, in words, whether a team can currently be used. */
function SeatPill({ team }) {
  if (!team.plan) return <span className="sub-pill is-expired">No seats yet</span>;
  if (!team.active) return <span className="sub-pill is-expired">Plan lapsed</span>;
  if (team.daysLeft != null && team.daysLeft <= 7) return <span className="sub-pill is-soon">{team.daysLeft} day{team.daysLeft === 1 ? '' : 's'} left</span>;
  return <span className="sub-pill is-active">{team.memberCount}/{team.seats} seats</span>;
}

export function TeamsPage() {
  const { refresh } = useApp();
  const { data, loading, error } = useQuery('/teams');
  const [creating, setCreating] = useState(false), [joining, setJoining] = useState(false);
  if (loading) return <Loading/>;
  if (error) return <ErrorState message={error}/>;
  const teams = data?.teams || [];
  return <>
    <div className="page-heading">
      <div><span className="eyebrow">TOGETHER</span><h1>Classrooms and teams</h1><p>Buy a seat for each person. Everyone gets the full toolkit inside the team's folders, and keeps their own study progress.</p></div>
      <div className="page-actions">
        <Button className="secondary" onClick={() => setJoining(true)}><LogIn size={16}/> Join with a code</Button>
        <Button className="primary" onClick={() => setCreating(true)}><Plus size={16}/> New team</Button>
      </div>
    </div>
    {teams.length === 0 ? <Empty title="No teams yet" text="Create a classroom for your students, or join one with a code from your teacher." action={<Button className="primary" onClick={() => setCreating(true)}><Plus size={16}/> Create a team</Button>}/>
      : <div className="team-grid">{teams.map(t => {
        const Icon = KIND_ICON[t.kind] || Users;
        return <Link key={t.id} to={`/teams/${t.id}`} className="team-card">
          <span className="team-card-icon"><Icon size={20}/></span>
          <strong>{t.name}</strong>
          <small>{t.roleLabel}{t.description ? ` · ${t.description}` : ''}</small>
          <div className="team-card-foot"><SeatPill team={t}/>{t.planLabel && <span className="dash-muted">{t.planLabel}</span>}</div>
        </Link>;
      })}</div>}
    {creating && <CreateTeamModal onClose={() => setCreating(false)} onDone={id => { setCreating(false); refresh(); }}/>}
    {joining && <JoinTeamModal onClose={() => setJoining(false)} onDone={() => { setJoining(false); refresh(); }}/>}
  </>;
}

function CreateTeamModal({ onClose, onDone }) {
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: '', kind: 'classroom', description: '' });
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function submit(e) {
    e.preventDefault(); setBusy(true); setError('');
    try { const d = await api('/teams', { method: 'POST', body: form }); onDone(d.team.id); navigate(`/teams/${d.team.id}`); }
    catch (err) { setError(messageFor(err)); } finally { setBusy(false); }
  }
  return <Modal open onClose={onClose} title="Start a team" description="A classroom or a study team. You can buy seats once it exists.">
    <form className="form-stack" onSubmit={submit}>
      <Field label="What is this?"><div className="visibility-options">{TEAM_KINDS.map(k => {
        const Icon = KIND_ICON[k.id];
        return <button key={k.id} type="button" aria-pressed={form.kind === k.id} className={form.kind === k.id ? 'selected' : ''} onClick={() => setForm(f => ({ ...f, kind: k.id }))}><Icon size={19}/><span><strong>{k.label}</strong><small>{k.blurb}</small></span></button>;
      })}</div></Field>
      <Field label="Name"><input autoFocus required minLength={2} maxLength={60} placeholder={form.kind === 'classroom' ? 'e.g. Physics 101' : 'e.g. Med school study group'} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}/></Field>
      <Field label="Description · optional"><textarea maxLength={300} rows={2} placeholder="What will this group study?" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}/></Field>
      {error && <ErrorState message={error}/>}
      <div className="modal-actions"><Button type="button" className="secondary" onClick={onClose}>Cancel</Button><Button className="primary" loading={busy} type="submit">Create <Plus size={16}/></Button></div>
    </form>
  </Modal>;
}

function JoinTeamModal({ onClose, onDone }) {
  const navigate = useNavigate();
  const [code, setCode] = useState(''), [peek, setPeek] = useState(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  // Looking the code up first means the person sees what they are joining before they take a seat.
  async function look() {
    setBusy(true); setError(''); setPeek(null);
    try { setPeek(await api(`/teams/code/${encodeURIComponent(code.trim().toUpperCase())}`)); }
    catch (err) { setError(messageFor(err)); } finally { setBusy(false); }
  }
  async function join() {
    setBusy(true); setError('');
    try { const d = await api('/teams/join', { method: 'POST', body: { code: code.trim().toUpperCase() } }); toast.success(`You joined ${d.team.name}`); onDone(); navigate(`/teams/${d.team.id}`); }
    catch (err) { setError(messageFor(err)); } finally { setBusy(false); }
  }
  return <Modal open onClose={onClose} title="Join with a code" description="Your teacher or team owner can send you one.">
    <form className="form-stack" onSubmit={e => { e.preventDefault(); peek ? join() : look(); }}>
      <Field label="Invite code" hint="Eight letters and numbers.">
        <input autoFocus required minLength={6} maxLength={16} placeholder="ABCD2345" className="code-input" value={code} onChange={e => { setCode(e.target.value.toUpperCase()); setPeek(null); }}/>
      </Field>
      {peek && <div className="inline-note"><strong>{peek.team.name}</strong>. You will join as a {peek.roleLabel.toLowerCase()}.</div>}
      {error && <ErrorState message={error}/>}
      <div className="modal-actions"><Button type="button" className="secondary" onClick={onClose}>Cancel</Button><Button className="primary" loading={busy} type="submit">{peek ? 'Take my seat' : 'Look it up'} <ArrowUpRight size={16}/></Button></div>
    </form>
  </Modal>;
}

/** An invite link lands here, so the code is confirmed on screen before a seat is taken. */
export function TeamJoinLinkPage() {
  const { code } = useParams();
  const navigate = useNavigate();
  const { refresh } = useApp();
  const { data, loading, error } = useQuery(`/teams/code/${encodeURIComponent(code)}`);
  const [busy, setBusy] = useState(false), [failed, setFailed] = useState('');
  if (loading) return <Loading/>;
  if (error) return <Empty title="That invite is not open" text={error} action={<Link className="button primary" to="/teams">Your teams</Link>}/>;
  async function join() {
    setBusy(true); setFailed('');
    try { const d = await api('/teams/join', { method: 'POST', body: { code } }); toast.success(`You joined ${d.team.name}`); refresh(); navigate(`/teams/${d.team.id}`); }
    catch (e) { setFailed(messageFor(e)); } finally { setBusy(false); }
  }
  const Icon = KIND_ICON[data.team.kind] || Users;
  return <section className="join-invite">
    <span className="team-card-icon"><Icon size={24}/></span>
    <h1>{data.team.name}</h1>
    <p>You have been invited as a {data.roleLabel.toLowerCase()}. Taking a seat unlocks the full toolkit inside this team's folders. Your own library is not affected.</p>
    {failed && <ErrorState message={failed}/>}
    <div className="modal-actions"><Link className="button secondary" to="/teams">Not now</Link><Button className="primary" loading={busy} onClick={join}><LogIn size={16}/> Take my seat</Button></div>
  </section>;
}

export function TeamPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user, refresh } = useApp();
  const { data, loading, error } = useQuery(`/teams/${id}`);
  const [inviting, setInviting] = useState(false), [buying, setBuying] = useState(false);
  const [addingFolder, setAddingFolder] = useState(false), [assigning, setAssigning] = useState(false);
  if (loading) return <Loading/>;
  if (error) return <ErrorState message={error}/>;
  const { team, members, folders, assignments } = data;
  const isOwner = team.role === 'owner';
  const isTeacher = team.role === 'owner' || team.role === 'teacher';
  const Icon = KIND_ICON[team.kind] || Users;

  async function remove(person) {
    if (!confirm(`Remove ${person.name} from ${team.name}? Their seat is freed straight away.`)) return;
    try { await api(`/teams/${id}/members/${person.id}`, { method: 'DELETE' }); toast.success(`${person.name} was removed`); refresh(); }
    catch (e) { reportError(e); }
  }
  async function setRole(person, role) {
    try { await api(`/teams/${id}/members/${person.id}`, { method: 'PATCH', body: { role } }); refresh(); }
    catch (e) { reportError(e); }
  }
  async function leave() {
    if (!confirm(`Leave ${team.name}? Your own folders and study history stay with you.`)) return;
    try { await api(`/teams/${id}/members/${user.id}`, { method: 'DELETE' }); refresh(); navigate('/teams'); }
    catch (e) { reportError(e); }
  }

  return <>
    <div className="page-heading">
      <div>
        <span className="eyebrow">{team.kind === 'classroom' ? 'CLASSROOM' : 'TEAM'}</span>
        <h1><span className="team-title-icon"><Icon size={22}/></span> {team.name}</h1>
        <p>{team.description || 'Everyone here gets the full toolkit inside this team’s folders.'}</p>
        <div className="team-meta"><SeatPill team={team}/><span className="dash-muted">You are the {team.roleLabel.toLowerCase()}</span>{team.expiresAt && <span className="dash-muted"><Clock3 size={13}/> renews {day(team.expiresAt)}</span>}</div>
      </div>
      <div className="page-actions">
        {isTeacher && team.active && <Button className="secondary" onClick={() => setInviting(true)}><Ticket size={16}/> Invite</Button>}
        {isOwner && <Button className="primary" onClick={() => setBuying(true)}><Crown size={16}/> {team.active ? 'Manage seats' : 'Buy seats'}</Button>}
        {!isOwner && <Button className="secondary" onClick={leave}><UserMinus size={16}/> Leave</Button>}
      </div>
    </div>

    {!team.active && <div className="inline-note">{isOwner ? 'Buy seats to invite people and unlock the toolkit in this team’s folders.' : 'This team’s plan has lapsed. Ask the owner to renew it.'}</div>}

    <div className="team-columns">
      <section className="team-panel">
        <div className="premium-card-head premium-card-head-inline"><h2>Folders</h2>{isTeacher && team.active && <button className="text-button" onClick={() => setAddingFolder(true)}><Plus size={15}/> Add a folder</button>}</div>
        {folders.length === 0 ? <p className="dash-muted">No team folders yet. Anything added here is readable by everyone on the roster.</p>
          : <ul className="team-list">{folders.map(f => <li key={f.id}><Link to={`/folders/${f.id}`} className="team-list-row"><span className={`team-list-icon ${f.color}`}><FolderIcon name={f.icon} size={16}/></span><span className="team-list-text"><strong>{f.title}</strong><small>{f.cardCount} card{f.cardCount === 1 ? '' : 's'}</small></span><ArrowUpRight size={15}/></Link></li>)}</ul>}
      </section>

      <section className="team-panel">
        <div className="premium-card-head premium-card-head-inline"><h2>Assignments</h2>{isTeacher && folders.length > 0 && <button className="text-button" onClick={() => setAssigning(true)}><Plus size={15}/> Set one</button>}</div>
        {assignments.length === 0 ? <p className="dash-muted">Nothing set. An assignment points the group at one folder and, if you like, a date.</p>
          : <ul className="team-list">{assignments.map(a => <li key={a.id}><div className="team-list-row">
            <span className="team-list-icon violet"><ClipboardList size={16}/></span>
            <span className="team-list-text"><strong>{a.title}</strong><small>{a.folder?.title}{a.dueAt ? ` · due ${day(a.dueAt)}` : ''}</small></span>
            {a.folder && <Link className="text-button" to={`/folders/${a.folder.id}/study`}>Study</Link>}
            {isTeacher && <Menu label={`Assignment ${a.title}`} items={[{ label: 'Remove', icon: <Trash2 size={15}/>, danger: true, action: async () => { try { await api(`/teams/${id}/assignments/${a.id}`, { method: 'DELETE' }); refresh(); } catch (e) { reportError(e); } } }]}/>}
          </div></li>)}</ul>}
        {assignments.some(a => a.instructions) && <p className="dash-muted team-instructions">{assignments.find(a => a.instructions).instructions}</p>}
      </section>
    </div>

    <div className="premium-card-head premium-card-head-inline"><h2>Roster</h2><span className="dash-muted">{team.memberCount} of {team.seats || 0} seats{team.seatsLeft ? ` · ${team.seatsLeft} free` : ''}</span></div>
    <div className="dash-table-wrap"><table className="dash-table">
      <thead><tr><th>Person</th><th>Role</th><th>Joined</th>{isTeacher && <th aria-label="Actions"/>}</tr></thead>
      <tbody>{members.map(m => <tr key={m.id}>
        <td><div className="dash-person"><Avatar user={m} small/><span><strong>{m.name}</strong><span className="dash-muted">@{m.username}</span></span></div></td>
        <td>{isOwner && m.role !== 'owner'
          ? <select aria-label={`Role for ${m.username}`} value={m.role} onChange={e => setRole(m, e.target.value)}><option value="student">{team.kind === 'classroom' ? 'Student' : 'Member'}</option><option value="teacher">{team.kind === 'classroom' ? 'Teacher' : 'Manager'}</option></select>
          : <span className="dash-muted">{m.roleLabel}</span>}</td>
        <td><span className="dash-muted">{day(m.joinedAt)}</span></td>
        {isTeacher && <td>{m.role !== 'owner' && <button className="text-button danger" onClick={() => remove(m)}><UserMinus size={15}/> Remove</button>}</td>}
      </tr>)}</tbody>
    </table></div>

    {isTeacher && <section className="team-report">
      <span className="team-card-icon"><BarChart3 size={20}/></span>
      <div>
        <h2>See how {team.kind === 'classroom' ? 'the class' : 'everyone'} is getting on</h2>
        <p>Who has covered the material, how well it is sticking, and what each person still has due. Everyone keeps their own study progress; the report only reads it.</p>
      </div>
      <Link className="button secondary" to={`/teams/${id}/progress`}><BarChart3 size={15}/> Open the report</Link>
    </section>}

    {inviting && <InviteModal teamId={id} kind={team.kind} onClose={() => setInviting(false)}/>}
    {buying && <SeatsModal team={team} onClose={() => setBuying(false)} onDone={() => { setBuying(false); refresh(); }}/>}
    {assigning && <AssignModal teamId={id} folders={folders} onClose={() => setAssigning(false)} onDone={() => { setAssigning(false); refresh(); }}/>}
    {addingFolder && <FolderModal onClose={() => setAddingFolder(false)} createPath={`/teams/${id}/folders`} onSaved={() => { setAddingFolder(false); refresh(); }}/>}
  </>;
}

function InviteModal({ teamId, kind, onClose }) {
  const [role, setRole] = useState('student'), [code, setCode] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const { data, loading, refetch } = useQuery(`/teams/${teamId}/invites`);
  async function make() {
    setBusy(true); setError('');
    try { const d = await api(`/teams/${teamId}/invites`, { method: 'POST', body: { role } }); setCode(d.code); refetch(); }
    catch (err) { setError(messageFor(err)); } finally { setBusy(false); }
  }
  const link = code ? `${location.origin}/teams/join/${code}` : '';
  const copy = async (text, what) => { try { await navigator.clipboard.writeText(text); toast.success(`${what} copied`); } catch { setError('Clipboard unavailable. Select the text and copy it.'); } };
  return <Modal open onClose={onClose} title="Invite people" description="Each person who joins takes one seat.">
    <div className="form-stack">
      <Field label="They join as"><div className="visibility-options">{[['student', kind === 'classroom' ? 'Student' : 'Member', 'Studies the team folders.'], ['teacher', kind === 'classroom' ? 'Teacher' : 'Manager', 'Can invite, assign, and see the report.']].map(([value, label, hint]) =>
        <button key={value} type="button" aria-pressed={role === value} className={role === value ? 'selected' : ''} onClick={() => { setRole(value); setCode(''); }}><Users size={19}/><span><strong>{label}</strong><small>{hint}</small></span></button>)}
      </div></Field>
      {code ? <>
        <div className="invite-code"><span>{code}</span><button className="icon-button" aria-label="Copy code" onClick={() => copy(code, 'Code')}><Copy size={16}/></button></div>
        <Button className="secondary" onClick={() => copy(link, 'Link')}><Link2 size={16}/> Copy the join link</Button>
        <p className="premium-fineprint"><ShieldCheck size={14}/> Write this down now. We only keep a hash of it, so it cannot be shown again.</p>
      </> : <Button className="primary" loading={busy} onClick={make}><Ticket size={16}/> Make an invite code</Button>}
      {error && <ErrorState message={error}/>}
      {!loading && data?.invites?.length > 0 && <div>
        <span className="input-label">Open invites</span>
        <ul className="team-list">{data.invites.map(i => <li key={i.id}><div className="team-list-row">
          <span className="team-list-text"><strong>{i.roleLabel}</strong><small>{i.uses} used{i.maxUses ? ` of ${i.maxUses}` : ''}{i.expiresAt ? ` · expires ${day(i.expiresAt)}` : ''}</small></span>
          <button className="text-button danger" onClick={async () => { try { await api(`/teams/${teamId}/invites/${i.id}`, { method: 'DELETE' }); setCode(c => c); toast.success('Invite revoked'); } catch (e) { reportError(e); } }}><Trash2 size={15}/> Revoke</button>
        </div></li>)}</ul>
      </div>}
      <div className="modal-actions"><Button className="primary" onClick={onClose}>Done</Button></div>
    </div>
  </Modal>;
}

function SeatsModal({ team, onClose, onDone }) {
  const navigate = useNavigate();
  const { money, seatRate } = useMoney();
  const [plan, setPlan] = useState(team.plan || 'team-yearly');
  const [seats, setSeats] = useState(Math.max(team.seats || 0, team.memberCount, SEATS.min));
  const [quote, setQuote] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  // The price comes from the server, because proration depends on state the client cannot see.
  async function getQuote() {
    setBusy(true); setError(''); setQuote(null);
    try { setQuote(await api(`/teams/${team.id}/quote`, { method: 'POST', body: { plan, seats: clampSeats(seats) } })); }
    catch (err) { setError(messageFor(err)); } finally { setBusy(false); }
  }
  const chosen = teamPlanById(plan);
  const KIND = { 'team-new': 'First purchase', 'team-renew': 'Renewal', 'team-seats': 'Extra seats, prorated' };
  return <Modal open onClose={onClose} title={team.active ? 'Manage seats' : 'Buy seats'} description="One seat per person, including you.">
    <div className="form-stack">
      <Field label="Plan"><div className="plan-picker">{TEAM_PLANS.map(p => <label key={p.id} className={`plan-option ${plan === p.id ? 'is-chosen' : ''}`}>
        <input type="radio" name="team-plan" value={p.id} checked={plan === p.id} onChange={() => { setPlan(p.id); setQuote(null); }}/>
        <span className="plan-top"><strong>{p.label}</strong>{p.id === 'team-yearly' && <span className="plan-tag">Best value</span>}</span>
        <span className="plan-price">{money(seatRate(p.id))}</span>
        <span className="plan-term">per seat · {p.days} days</span>
        <span className="plan-blurb">{p.blurb}</span>
      </label>)}</div></Field>
      <Field label="Seats" hint={`Between ${SEATS.min} and ${SEATS.max}. You currently have ${team.seats || 0} and ${team.memberCount} in use.`}>
        <input type="number" min={SEATS.min} max={SEATS.max} value={seats} onChange={e => { setSeats(e.target.value); setQuote(null); }}/>
      </Field>
      {quote ? <div className="quote-box">
        <span className="dash-muted">{KIND[quote.kind] || 'Total'}</span>
        <strong className="premium-amount">{money(quote.amount)}</strong>
        <small>{quote.seats} seat{quote.seats === 1 ? '' : 's'} · {quote.planLabel}{quote.kind === 'team-seats' ? ' · charged only for the days left in this term' : ''}</small>
      </div> : <p className="dash-muted">{chosen ? `About ${money(seatRate(chosen.id) * clampSeats(seats))} before any proration. Check the exact price next.` : ''}</p>}
      {error && <ErrorState message={error}/>}
      <div className="modal-actions">
        <Button type="button" className="secondary" onClick={onClose}>Cancel</Button>
        {quote
          ? <Button className="primary" onClick={() => { onDone(); navigate(`/teams/${team.id}/checkout?plan=${plan}&seats=${quote.seats}`); }}><Crown size={16}/> Pay {money(quote.amount)}</Button>
          : <Button className="primary" loading={busy} onClick={getQuote}>Check the price <ArrowUpRight size={16}/></Button>}
      </div>
    </div>
  </Modal>;
}

function AssignModal({ teamId, folders, onClose, onDone }) {
  const [form, setForm] = useState({ folderId: folders[0]?.id || '', title: '', instructions: '', dueAt: '' });
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function submit(e) {
    e.preventDefault(); setBusy(true); setError('');
    try {
      await api(`/teams/${teamId}/assignments`, { method: 'POST', body: { ...form, title: form.title || undefined, dueAt: form.dueAt ? new Date(form.dueAt).toISOString() : null } });
      toast.success('Everyone has been told.'); onDone();
    } catch (err) { setError(messageFor(err)); } finally { setBusy(false); }
  }
  return <Modal open onClose={onClose} title="Set an assignment" description="Points the group at one folder. Everyone gets a notification.">
    <form className="form-stack" onSubmit={submit}>
      <Field label="Folder"><select required value={form.folderId} onChange={e => setForm(f => ({ ...f, folderId: e.target.value }))}>{folders.map(f => <option key={f.id} value={f.id}>{f.title}</option>)}</select></Field>
      <Field label="Title · optional" hint="Defaults to the folder name."><input maxLength={80} placeholder="e.g. Chapter 1" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}/></Field>
      <Field label="Due · optional"><input type="date" value={form.dueAt} onChange={e => setForm(f => ({ ...f, dueAt: e.target.value }))}/></Field>
      <Field label="Instructions · optional"><textarea maxLength={500} rows={3} placeholder="Anything they should know." value={form.instructions} onChange={e => setForm(f => ({ ...f, instructions: e.target.value }))}/></Field>
      {error && <ErrorState message={error}/>}
      <div className="modal-actions"><Button type="button" className="secondary" onClick={onClose}>Cancel</Button><Button className="primary" loading={busy} type="submit"><CalendarClock size={16}/> Set it</Button></div>
    </form>
  </Modal>;
}

/** Seats are paid for with the same form as a personal plan; only the endpoints differ. */
export function TeamCheckoutPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useApp();
  const { money } = useMoney();
  const [params] = useSearchParams();
  // Checked before the quote is even asked for. The server refuses the order anyway, but a seat
  // price quoted in a currency the owner cannot be charged in is a promise we cannot keep.
  const forSale = sellsTo(user);
  const plan = params.get('plan') || 'team-yearly';
  const seats = clampSeats(params.get('seats'));
  const { data, loading, error } = useQuery(`team-checkout:${id}:${plan}:${seats}`, () => Promise.all([
    api(`/teams/${id}/quote`, { method: 'POST', body: { plan, seats } }),
    api(`/teams/${id}/billing`),
  ]).then(([quote, billing]) => ({ quote, ...billing })));
  if (!forSale) return <NotOnSaleHere what="Team seats"/>;
  if (loading) return <Loading/>;
  if (error) return <ErrorState message={error}/>;
  const { quote, order, methods = [] } = data;
  const KIND = { 'team-new': 'First purchase', 'team-renew': 'Renewal', 'team-seats': 'Extra seats, prorated to the days left' };
  if (order?.status === 'pending') return <section className="premium-pending">
    <span className="premium-pending-icon"><Clock3 size={22}/></span>
    <div><h2>Waiting for confirmation</h2><p>{order.seats} seats are reserved. They turn on as soon as the payment is verified.</p><Link className="text-button" to={`/teams/${id}`}>Back to the team</Link></div>
  </section>;
  return <>
    <div className="page-heading">
      <div><span className="eyebrow">SEATS</span><h1>{quote.seats} seat{quote.seats === 1 ? '' : 's'}, {quote.planLabel.toLowerCase()}</h1><p>{KIND[quote.kind]} · {money(quote.perSeat)} per seat. Everyone on the roster gets the full toolkit inside this team’s folders.</p></div>
      <div className="page-actions"><Link className="button secondary" to={`/teams/${id}`}>Back to team</Link></div>
    </div>
    <div className="premium-checkout">
      <div className="premium-form-wrap">
        <PaymentForm
          methods={methods}
          amount={quote.amount}
          summary={`${quote.seats} seats · ${quote.planLabel}`}
          label="Submit request"
          instantLabel="Pay for the seats"
          extra={{ plan, seats: quote.seats }}
          manualPath={`/teams/${id}/order`}
          checkoutPath={`/teams/${id}/checkout`}
          cancelPath={`/teams/${id}/order`}
          onDone={() => navigate(`/teams/${id}`)}
        />
      </div>
      <PaymentAside
        amount={quote.amount}
        lines={[[`${quote.seats} seat${quote.seats === 1 ? '' : 's'}`, `${money(quote.perSeat)} each`], ['Plan', quote.planLabel], ['Purchase', KIND[quote.kind]]]}
        steps={SEAT_STEPS}
      />
    </div>
  </>;
}
const SEAT_STEPS = ['Confirm your billing details.', 'Pay in the secure Razorpay window.', 'Invite people to their seats right away.'];

/** The teacher's read on the class. It reports the learners' own progress rather than a copy of it. */
export function TeamProgressPage() {
  const { id } = useParams();
  const [folderId, setFolderId] = useState('');
  const { data, loading, error } = useQuery(`/teams/${id}/progress${folderId ? `?folderId=${folderId}` : ''}`);
  if (loading) return <Loading/>;
  if (error) return <ErrorState message={error}/>;
  const { team, folders, rows, totalCards } = data;
  return <>
    <div className="page-heading">
      <div><span className="eyebrow">REPORT</span><h1>{team.name}</h1><p>Coverage is how much of {folderId ? 'this folder' : 'the team’s material'} each person has seen at least once. {totalCards} card{totalCards === 1 ? '' : 's'} in scope.</p></div>
      <div className="page-actions">
        <select aria-label="Folder" value={folderId} onChange={e => setFolderId(e.target.value)}><option value="">All team folders</option>{folders.map(f => <option key={f.id} value={f.id}>{f.title}</option>)}</select>
        <Link className="button secondary" to={`/teams/${id}`}>Back to team</Link>
      </div>
    </div>
    {totalCards === 0 ? <Empty title="Nothing to report yet" text="Add cards to a team folder and the group's progress will show up here."/>
      : <div className="dash-table-wrap"><table className="dash-table">
        <thead><tr><th>Person</th><th>Coverage</th><th>Reviews</th><th>Accuracy</th><th>Due now</th><th>Last studied</th></tr></thead>
        <tbody>{rows.map(r => <tr key={r.id}>
          <td><div className="dash-person"><Avatar user={r} small/><span><strong>{r.name}</strong><span className="dash-muted">{r.roleLabel}</span></span></div></td>
          <td><div className="coverage"><span className="coverage-bar"><span style={{ width: `${r.coverage}%` }}/></span><span className="dash-muted">{r.studied}/{totalCards}</span></div></td>
          <td>{r.reviews}</td>
          <td>{r.accuracy == null ? <span className="dash-muted">Not yet</span> : <span className={`sub-pill ${r.accuracy >= 80 ? 'is-active' : r.accuracy >= 50 ? 'is-soon' : 'is-expired'}`}>{r.accuracy}%</span>}</td>
          <td>{r.due ? r.due : <span className="dash-muted">0</span>}</td>
          <td><span className="dash-muted">{r.lastReviewedAt ? day(r.lastReviewedAt) : 'not yet'}</span></td>
        </tr>)}</tbody>
      </table></div>}
  </>;
}
