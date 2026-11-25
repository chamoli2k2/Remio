import { useState } from 'react';
import { Gift, Copy, Share2, Check, Pencil, Users, Clock3, Crown } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../services/api';
import { reportError } from '../services/errors';
import { useQuery } from '../hooks/useApp';
import { Avatar, Button, ErrorState, Loading } from '../components/ui';
import { referralLink } from '../../../shared/referrals.js';
import { shareInvite } from '../services/shareInvite';

export default function InvitePage() {
  const { data, error, loading, refetch } = useQuery('/referrals');
  const [editing, setEditing] = useState(false), [draft, setDraft] = useState(''), [busy, setBusy] = useState(false), [problem, setProblem] = useState(''), [redeem, setRedeem] = useState('');
  if (loading) return <Loading/>;
  if (error || !data) return <ErrorState message={error || 'Could not load your invites.'}/>;
  const { program } = data, link = referralLink(window.location.origin, data.code);
  const copy = async (text, done) => { try { await navigator.clipboard.writeText(text); toast.success(done); } catch { toast.error('Copy failed. Select the text and copy it.'); } };
  async function saveCode(e) {
    e.preventDefault(); setBusy(true); setProblem('');
    try { await api('/referrals/code', { method: 'PUT', body: { code: draft } }); await refetch(); setEditing(false); toast.success('Your code is updated.'); }
    catch (err) { setProblem(err.message); } finally { setBusy(false); }
  }
  async function useCode(e) {
    e.preventDefault(); setBusy(true);
    try { await api('/referrals/redeem', { method: 'POST', body: { code: redeem } }); setRedeem(''); await refetch(); toast.success('Code added. Study on 7 different days to unlock your reward.'); }
    catch (err) { reportError(err); } finally { setBusy(false); }
  }
  const inv = data.invitedBy;
  return <div className="invite-page">
    <div className="page-heading"><div><span className="eyebrow">INVITE FRIENDS</span><h1>Study together, earn Premium</h1><p>A friend who studies on {program.activeDaysRequired} different days gets {program.refereeRewardDays} days of Premium. You earn more days with every friend who sticks with it.</p></div></div>

    <section className="invite-hero">
      <div>
        <span className="invite-label">YOUR INVITE CODE</span>
        {editing
          ? <form className="invite-edit" onSubmit={saveCode}><input autoFocus value={draft} onChange={e => setDraft(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} minLength={program.codeMin} maxLength={program.codeMax} aria-label="New invite code"/><Button type="submit" className="primary" loading={busy}>Save</Button><button type="button" className="text-button" onClick={() => { setEditing(false); setProblem(''); }}>Cancel</button></form>
          : <div className="invite-code"><strong>{data.code}</strong><button className="icon-button" aria-label="Choose your own code" title="Choose your own code" onClick={() => { setDraft(data.code); setEditing(true); }}><Pencil size={16}/></button></div>}
        {problem && <p className="invite-problem">{problem}</p>}
        <p className="invite-link" title={link}>{link}</p>
      </div>
      <div className="invite-actions">
        <Button className="primary" onClick={() => shareInvite({ code: data.code })}><Share2 size={16}/> Share invite</Button>
        <Button className="secondary" onClick={() => copy(link, 'Link copied.')}><Copy size={16}/> Copy link</Button>
      </div>
    </section>

    <div className="invite-grid">
      <section className="invite-card">
        <h2>Your rewards</h2>
        <p className="muted">Rewards are Premium days, never cash. They stop at {program.cap} study partners, so the most you can earn is {data.program.milestones.reduce((s, m) => s + m.days, 0)} days.</p>
        <ol className="invite-ladder">{data.milestones.map(m => <li key={m.qualified} className={m.reached ? 'is-reached' : ''}><span className="invite-step">{m.reached ? <Check size={14}/> : m.qualified}</span><div><strong>{m.label}</strong><small>{m.qualified === 1 ? '1 friend' : `${m.qualified} friends`} who study {program.activeDaysRequired} days</small></div><span className="invite-days">+{m.days} days</span></li>)}</ol>
        <p className="invite-total"><Crown size={15}/> {data.earnedDays} days earned{data.capReached ? ' · you reached the maximum' : data.next ? ` · ${data.next.remaining} more friend${data.next.remaining === 1 ? '' : 's'} for +${data.next.days} days` : ''}</p>
      </section>

      <section className="invite-card">
        <h2>Your friends</h2>
        {data.invitees.length === 0
          ? <p className="muted invite-empty"><Users size={18}/> Nobody has joined with your code yet. Share it with the people you study with.</p>
          : <ul className="invite-people">{data.invitees.map(p => <li key={p.username}><Avatar user={p} small/><div><strong>{p.name}</strong><small>@{p.username}</small></div>{p.status === 'qualified' ? <span className="invite-badge is-done"><Check size={13}/> Rewarded</span> : <span className="invite-badge"><Clock3 size={13}/> {Math.min(p.activeDays || 0, program.activeDaysRequired)}/{program.activeDaysRequired} days</span>}</li>)}</ul>}
      </section>
    </div>

    {inv && <section className="invite-card invite-from"><h2>You joined through {inv.name}</h2>
      <p className="muted">{inv.status === 'qualified' ? `You earned ${inv.rewardDays} days of Premium. Enjoy it.` : `Study on ${program.activeDaysRequired} different days to unlock ${inv.rewardDays} days of Premium.`}</p>
      {inv.status !== 'qualified' && <div className="invite-bar" role="progressbar" aria-valuemin={0} aria-valuemax={program.activeDaysRequired} aria-valuenow={inv.activeDays || 0}><span style={{ width: `${Math.min(100, ((inv.activeDays || 0) / program.activeDaysRequired) * 100)}%` }}/></div>}
    </section>}

    {data.canRedeem && <section className="invite-card"><h2><Gift size={18}/> Have a friend's code?</h2>
      <p className="muted">Add it within your first {program.redeemWindowDays} days to get {program.refereeRewardDays} days of Premium after {program.activeDaysRequired} days of studying.</p>
      <form className="invite-edit" onSubmit={useCode}><input value={redeem} onChange={e => setRedeem(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} placeholder="FRIEND123" maxLength={program.codeMax} aria-label="Friend's invite code"/><Button type="submit" className="primary" loading={busy} disabled={redeem.length < program.codeMin}>Add code</Button></form>
    </section>}
  </div>;
}
