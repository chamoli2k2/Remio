import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, ArrowLeft, Check, Layers, Target, BookOpen, GraduationCap, LockKeyhole, Flame, Trophy, CalendarDays, Sun, Clock, TrendingUp, Sparkles, MailCheck, MailWarning, Trash2 } from 'lucide-react';
import Heatmap from '../components/Heatmap';
import { toast } from 'sonner';
import { useApp, useQuery } from '../hooks/useApp';
import { api } from '../services/api';
import { Button, Field, ErrorState, Loading, Avatar } from '../components/ui';
import ThemeToggle from '../components/ThemeToggle';
import ConfirmEmailFirst, { ResendLinkButton } from '../components/ConfirmEmailFirst';
import { BRAND } from '../../../shared/brand.js';
import { COUNTRIES, DEFAULT_COUNTRY, countryByCode, countryOf } from '../../../shared/countries.js';
export function AuthPage({ mode = 'login' }) {
  const { setUser, error: connectionError } = useApp(); const navigate = useNavigate(); const signup = mode === 'signup'; const setSignup = v => navigate((v ? '/signup' : '/login') + window.location.search, { replace: true }); const [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function submit(e) { e.preventDefault(); setBusy(true); setError(''); const body = Object.fromEntries(new FormData(e.currentTarget)); try { const d = await api(signup ? '/auth/signup' : '/auth/login', { method: 'POST', body }); setUser(d.user); } catch (e) { setError(e.message); } finally { setBusy(false); } }
  return <div className="auth-page"><div className="auth-story"><Link className="brand" to="/"><img src="/favicon.svg" alt=""/><span className="brand-word">{BRAND.name}<span className="brand-period">.</span></span></Link><div><span className="eyebrow">A SPACE FOR YOUR CURIOSITY</span><h1>Learn a little.<br/>Remember<br/>a lot.</h1><p>Collect what matters. Make it memorable.<br/>Learn better, together.</p><div className="auth-benefits"><span><Check size={17}/> Your notes, beautifully organized</span><span><Check size={17}/> Study at your own pace</span><span><Check size={17}/> Share a little knowledge</span></div></div><span>One card at a time.</span></div><div className="auth-form"><Link to="/" className="back-link auth-back"><ArrowLeft size={15}/> Back to home</Link><ThemeToggle className="auth-theme-toggle"/><div><h2>{signup ? 'Make yourself at home.' : 'Welcome back.'}</h2><p>{signup ? 'Your next chapter starts with a flashcard.' : 'Your learning space is right where you left it.'}</p>{connectionError && <ErrorState message={connectionError}/>}<form className="form-stack" onSubmit={submit}>{signup ? <><Field label="Full name"><input required name="name" maxLength={60} autoComplete="name" placeholder="Your name"/></Field><Field label="Unique username" hint="3–24 letters, numbers, or underscores."><input required name="username" pattern="[a-zA-Z0-9_]{3,24}" autoComplete="username" placeholder="your_username"/></Field><Field label="Email"><input required type="email" name="email" autoComplete="email" placeholder="you@example.com"/></Field><Field label="Country" hint="Everything free works everywhere. This only sets the currency if you ever buy Premium."><select required name="country" defaultValue={countryByCode(DEFAULT_COUNTRY)?.name} autoComplete="country-name">{COUNTRIES.map(c => <option key={c.code} value={c.name}>{c.name}</option>)}</select></Field></> : <Field label="Username or email"><input required name="identifier" autoComplete="username" placeholder="Your username or email"/></Field>}<Field label="Password" hint={signup ? 'Use at least 10 characters.' : undefined}><input required type="password" name="password" minLength={signup ? 10 : 1} maxLength={128} autoComplete={signup ? 'new-password' : 'current-password'} placeholder="Enter your password"/></Field>{!signup && <Link className="text-button auth-forgot" to="/forgot-password">Forgot your password?</Link>}{error && <ErrorState message={error}/>}<Button type="submit" className="primary" loading={busy}>{signup ? 'Create your account' : 'Sign in'}<ArrowRight size={17}/></Button></form><p className="auth-switch">{signup ? 'Already have an account?' : `New to ${BRAND.name}?`} <button className="text-button" onClick={() => { setSignup(!signup); setError(''); }}>{signup ? 'Sign in' : 'Create an account'}</button></p></div></div></div>;
}
export function SettingsPage() {
  const { user, setUser, refresh, isDemo } = useApp(); const [form, setForm] = useState({ name: user.name, bio: user.bio || '', dailyGoal: user.dailyGoal || 20, desiredRetention: user.desiredRetention || 0.9 }), [busy, setBusy] = useState(false), [error, setError] = useState('');
  return <><div className="page-heading"><div><div className="eyebrow">MAKE YOURSELF AT HOME</div><h1>Your settings</h1><p>A learning space that feels like you.</p></div></div><div className="settings-layout"><div className="settings-column"><div className="settings-panel"><div className="profile-header"><Avatar user={user}/><div><h2>{user.name}</h2>{/* The country is shown but not editable here, because it sets the price this account pays and
    a field that lowers your own bill is one people will find. Moving country is a mail to us. */}
<p>@{user.username} · {user.account || 'normal'} · {countryOf(user)}</p>{(user.account || 'normal') === 'normal' && <Link className="text-button" to="/premium">Upgrade to Premium</Link>}</div></div><form className="form-stack" onSubmit={async e => { e.preventDefault(); setBusy(true); try { const d = await api('/auth/profile', { method: 'PATCH', body: form }); setUser(d.user); refresh(); toast.success('Settings saved'); } catch (e) { setError(e.message); } finally { setBusy(false); } }}><Field label="Display name"><input required maxLength={60} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}/></Field><Field label="About you"><textarea maxLength={300} rows={3} value={form.bio} onChange={e => setForm(f => ({ ...f, bio: e.target.value }))}/></Field><Field label="Daily review goal" hint="Choose a goal that fits your day. You can change it anytime."><select value={form.dailyGoal} onChange={e => setForm(f => ({ ...f, dailyGoal: Number(e.target.value) }))}>{[5, 10, 20, 30, 50, 100].map(n => <option key={n} value={n}>{n} cards a day</option>)}</select></Field><Field label="Desired retention" hint="How reliably you want to remember a card when it comes up. Higher means more frequent reviews; 90% is the FSRS default."><div className="retention-field"><input type="range" min={70} max={97} step={1} aria-label="Desired retention percent" value={Math.round(form.desiredRetention * 100)} onChange={e => setForm(f => ({ ...f, desiredRetention: Number(e.target.value) / 100 }))}/><strong>{Math.round(form.desiredRetention * 100)}%</strong></div></Field><div className="sharing-note"><LockKeyhole size={17}/> Your email and study progress are private.</div>{error && <ErrorState message={error}/>}<Button className="primary" loading={busy} type="submit">Save changes <Check size={16}/></Button></form></div></div><div className="settings-column"><EmailPanel/>{!isDemo && <><PasswordPanel/><DangerPanel/></>}</div></div></>;
}
/** Confirmation links land here, and they can land in a browser where nobody is signed in. */
export function VerifyEmailPage() {
  const { user, setUser } = useApp(); const navigate = useNavigate();
  const token = new URLSearchParams(window.location.search).get('token') || '';
  const [state, setState] = useState('working'), [error, setError] = useState('');
  // One request per link, however many times this mounts, so a remount cannot spend the rate limit.
  const asked = useRef('');
  useEffect(() => {
    if (!token) { setState('failed'); setError('That link is missing its confirmation code.'); return; }
    if (asked.current === token) return;
    asked.current = token;
    api('/auth/verify-email', { method: 'POST', body: { token } })
      .then(d => { setState('done'); if (user) setUser(d.user); })
      .catch(e => { setState('failed'); setError(e.message); });
  }, [token]);
  return <div className="verify-page">
    {state === 'working' && <Loading/>}
    {state === 'done' && <>
      <span className="verify-icon"><MailCheck size={28}/></span>
      <h1>Your email is confirmed.</h1>
      <p>Thank you. We can reach you about your account now, and you will not see the reminder again.</p>
      <Button className="primary" onClick={() => navigate(user ? '/' : '/login')}>{user ? 'Back to your library' : 'Sign in'} <ArrowRight size={16}/></Button>
    </>}
    {state === 'failed' && <>
      <span className="verify-icon verify-icon-bad"><MailWarning size={28}/></span>
      <h1>That link did not work.</h1>
      <p>{error}</p>
      <Button className="primary" onClick={() => navigate(user ? '/settings' : '/login')}>{user ? 'Go to Settings' : 'Sign in'} <ArrowRight size={16}/></Button>
    </>}
  </div>;
}

/**
 * Asks where to send a reset link. The answer never says whether the address is on file, so this
 * page cannot be used to find out who has an account here.
 */
export function ForgotPasswordPage() {
  const [email, setEmail] = useState(''), [busy, setBusy] = useState(false), [sent, setSent] = useState(false), [error, setError] = useState('');
  if (sent) return <div className="verify-page">
    <span className="verify-icon"><MailCheck size={28}/></span>
    <h1>Check your inbox.</h1>
    <p>If <strong>{email}</strong> belongs to an account, a link to choose a new password is on its way. It is good for one hour.</p>
    <Link className="button primary" to="/login">Back to sign in <ArrowRight size={16}/></Link>
  </div>;
  return <div className="verify-page">
    <span className="verify-icon"><LockKeyhole size={28}/></span>
    <h1>Forgot your password?</h1>
    <p>Tell us the address on your account and we will send you a link to set a new one.</p>
    <form className="form-stack verify-form" onSubmit={async e => {
      e.preventDefault(); setBusy(true); setError('');
      try { await api('/auth/password/forgot', { method: 'POST', body: { email } }); setSent(true); }
      catch (e) { setError(e.message); } finally { setBusy(false); }
    }}>
      <Field label="Email"><input required type="email" autoComplete="email" maxLength={254} value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com"/></Field>
      {error && <ErrorState message={error}/>}
      <Button className="primary" type="submit" loading={busy}>Send me a reset link <ArrowRight size={16}/></Button>
    </form>
    <Link className="text-button" to="/login">I remembered it, take me back</Link>
  </div>;
}

/** The other end of a reset link. Nothing is spent until a new password is actually submitted. */
export function ResetPasswordPage() {
  const { setUser } = useApp(); const navigate = useNavigate();
  const token = new URLSearchParams(window.location.search).get('token') || '';
  const [password, setPassword] = useState(''), [busy, setBusy] = useState(false), [done, setDone] = useState(false), [error, setError] = useState('');
  if (!token) return <div className="verify-page">
    <span className="verify-icon verify-icon-bad"><MailWarning size={28}/></span>
    <h1>That link is incomplete.</h1>
    <p>It is missing its reset code. Open the most recent email, or ask for a new link.</p>
    <Link className="button primary" to="/forgot-password">Ask for a new link <ArrowRight size={16}/></Link>
  </div>;
  if (done) return <div className="verify-page">
    <span className="verify-icon"><Check size={28}/></span>
    <h1>Your password is set.</h1>
    <p>Every device that was signed in has been signed out, so sign in again with your new password.</p>
    <Button className="primary" onClick={() => navigate('/login')}>Sign in <ArrowRight size={16}/></Button>
  </div>;
  return <div className="verify-page">
    <span className="verify-icon"><LockKeyhole size={28}/></span>
    <h1>Choose a new password.</h1>
    <p>Setting it signs out every device, including any you do not recognise.</p>
    <form className="form-stack verify-form" onSubmit={async e => {
      e.preventDefault(); setBusy(true); setError('');
      try {
        await api('/auth/password/reset', { method: 'POST', body: { token, newPassword: password } });
        // The session this browser held is gone with all the others, so drop the stale user.
        setUser(null); setDone(true);
      } catch (e) { setError(e.message); } finally { setBusy(false); }
    }}>
      <Field label="New password" hint="Use at least 10 characters."><input required type="password" autoComplete="new-password" minLength={10} maxLength={128} value={password} onChange={e => setPassword(e.target.value)}/></Field>
      {error && <ErrorState message={error}/>}
      <Button className="primary" type="submit" loading={busy}>Set my password <Check size={16}/></Button>
    </form>
  </div>;
}

/** Shows whether the address is confirmed, and sends a fresh link if it is not. */
function EmailPanel() {
  const { user } = useApp();
  if (user.emailVerifiedAt) return <div className="settings-panel">
    <h2>Your email</h2>
    <p className="settings-lede">Confirmed, so we can reach you if anything happens to your account.</p>
    <div className="settings-status settings-status-good"><MailCheck size={17}/> This address is confirmed.</div>
  </div>;
  return <div className="settings-panel">
    <h2>Confirm your email</h2>
    <p className="settings-lede">Confirming your address is what lets us help you recover the account later, and it is needed before your first payment.</p>
    <div className="settings-status-row">
    <span className="settings-status"><MailWarning size={17}/> Not confirmed yet.</span>
    <ResendLinkButton/>
    </div>
  </div>;
}

function PasswordPanel() {
  const { user } = useApp();
  const [form, setForm] = useState({ currentPassword: '', newPassword: '' }), [busy, setBusy] = useState(false), [error, setError] = useState('');
  // The server refuses this until the address is confirmed, because the change is announced by
  // email and a confirmed address is the way back in if the account is ever taken.
  if (!user.emailVerifiedAt) return <div className="settings-panel">
    <h2>Change your password</h2>
    <ConfirmEmailFirst>We announce a password change by email, and a confirmed address is how you get back into the account if you are ever locked out.</ConfirmEmailFirst>
  </div>;
  return <div className="settings-panel">
    <h2>Change your password</h2>
    <p className="settings-lede">Changing it signs out every other device, so do this if you think someone else has been in your account.</p>
    <form className="form-stack" onSubmit={async e => {
      e.preventDefault(); setBusy(true); setError('');
      try {
        const r = await api('/auth/password', { method: 'POST', body: form });
        setForm({ currentPassword: '', newPassword: '' });
        toast.success(r.signedOutElsewhere ? `Password changed. ${r.signedOutElsewhere} other ${r.signedOutElsewhere === 1 ? 'device was' : 'devices were'} signed out.` : 'Password changed.');
      } catch (e) { setError(e.message); } finally { setBusy(false); }
    }}>
      <Field label="Current password"><input required type="password" autoComplete="current-password" maxLength={128} value={form.currentPassword} onChange={e => setForm(f => ({ ...f, currentPassword: e.target.value }))}/></Field>
      <Field label="New password" hint="Use at least 10 characters."><input required type="password" autoComplete="new-password" minLength={10} maxLength={128} value={form.newPassword} onChange={e => setForm(f => ({ ...f, newPassword: e.target.value }))}/></Field>
      {error && <ErrorState message={error}/>}
      <Button className="primary" type="submit" loading={busy}>Change password <Check size={16}/></Button>
    </form>
  </div>;
}

/** Deletion is irreversible, so it asks for the password and the phrase, not just a confirm dialog. */
function DangerPanel() {
  const { setUser } = useApp();
  const [open, setOpen] = useState(false), [form, setForm] = useState({ password: '', confirm: '' }), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const PHRASE = 'delete my account';
  return <div className="settings-panel settings-danger">
    <h2>Delete your account</h2>
    <p className="settings-lede">This erases your collections, cards, and study history for good. We cannot put it back. Records of any payment are kept with your personal details stripped out, because we have to be able to prove the transaction happened.</p>
    {!open
      ? <Button className="danger-button" onClick={() => setOpen(true)}><Trash2 size={16}/> I want to delete my account</Button>
      : <form className="form-stack" onSubmit={async e => {
        e.preventDefault(); setBusy(true); setError('');
        try { await api('/auth/account', { method: 'DELETE', body: form }); setUser(null); }
        catch (e) { setError(e.message); setBusy(false); }
      }}>
        <Field label="Your password"><input required type="password" autoComplete="current-password" maxLength={128} value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))}/></Field>
        <Field label={`Type "${PHRASE}" to confirm`}><input required value={form.confirm} onChange={e => setForm(f => ({ ...f, confirm: e.target.value }))} placeholder={PHRASE}/></Field>
        {error && <ErrorState message={error}/>}
        <div className="settings-danger-actions">
          <Button type="button" onClick={() => { setOpen(false); setError(''); setForm({ password: '', confirm: '' }); }}>Keep my account</Button>
          <Button className="danger-button" type="submit" loading={busy} disabled={form.confirm !== PHRASE}><Trash2 size={16}/> Delete everything</Button>
        </div>
      </form>}
  </div>;
}

export function ProgressPage() {
  const { data, loading, error } = useQuery('/stats');
  if (loading) return <Loading/>; if (error) return <ErrorState message={error}/>; const s = data.stats;
  return <><div className="page-heading"><div><div className="eyebrow">EVERY REVIEW COUNTS</div><h1>Look how far you’re going.</h1><p>Build your knowledge, one small session at a time.</p></div></div><div className="stats-grid">{[[Layers, 'Cards in your library', s.totalCards], [BookOpen, 'Reviews completed', s.reviewed], [Target, 'Ready to review', s.due], [GraduationCap, 'Long-term cards', s.mastered]].map(([Icon, label, value]) => <div className="stat-card" key={label}><span><Icon size={22}/></span><strong>{value}</strong><p>{label}</p></div>)}</div><div className="progress-panel"><div><span className="eyebrow">TODAY’S MOMENTUM</span><h2>{s.reviewsToday >= s.goal ? 'Daily goal, done.' : 'A little time for a lasting habit.'}</h2><p>{s.reviewsToday} of {s.goal} cards reviewed today. Daily totals reset at midnight UTC.</p><div className="goal-progress"><span style={{ width: `${Math.min(100, s.reviewsToday / s.goal * 100)}%` }}/></div><Link to="/" className="button primary">Back to your library <ArrowRight size={17}/></Link></div><div className="progress-insight"><h3>Give your memory some space.</h3><p>{BRAND.name} schedules with FSRS, the algorithm behind modern Anki. Each card has a <em>stability</em> (how long a memory lasts) and a <em>difficulty</em>; the next review lands just before your recall probability would fall under your desired retention.</p></div></div>
    {s.heatmap && <HabitsPanel stats={s}/>}
    {s.retention && <RetentionPanel stats={s}/>}</>;
}
const INSIGHT_ICONS = { sun: Sun, clock: Clock, calendar: CalendarDays, trend: TrendingUp, flame: Flame };
function HabitsPanel({ stats: s }) {
  const mix = s.ratingMix || {}; const mixTotal = Object.values(mix).reduce((a, b) => a + b, 0);
  return <section className="habits-panel">
    <div className="habits-head"><div><span className="eyebrow">YOUR STUDY HABIT</span><h2>{s.streak.current ? `${s.streak.current}-day streak.` : s.streak.activeDays ? 'Pick the streak back up.' : 'Every habit starts with a first day.'}</h2></div><div className="streak-badges"><span className={`streak-badge ${s.streak.current ? 'active' : ''}`}><Flame size={16}/><strong>{s.streak.current}</strong> current</span><span className="streak-badge"><Trophy size={16}/><strong>{s.streak.longest}</strong> longest</span><span className="streak-badge"><CalendarDays size={16}/><strong>{s.streak.activeDays}</strong> study days</span></div></div>
    <Heatmap data={s.heatmap}/>
    <div className="habits-grid">
      <div className="retention-card"><span className="eyebrow">INSIGHTS</span>{!s.insights.length ? <p>Study for a few days and {BRAND.name} will notice when you learn best and how consistently you show up.</p> : <ul className="insight-list">{s.insights.map((i, n) => { const Icon = INSIGHT_ICONS[i.icon] || Sparkles; return <li key={n}><span className="insight-icon"><Icon size={15}/></span>{i.text}</li>; })}</ul>}</div>
      <div className="retention-card"><span className="eyebrow">LAST 30 DAYS · HOW IT FELT</span>{!mixTotal ? <p>No reviews in the last 30 days yet.</p> : <><div className="state-bar" role="img" aria-label={Object.entries(mix).map(([k, v]) => `${k}: ${v}`).join(', ')}>{['again', 'hard', 'good', 'easy'].map(k => mix[k] > 0 && <span key={k} className={`mix-${k}`} style={{ flex: mix[k] }}/>)}</div><ul className="state-legend">{[['again', 'Again'], ['hard', 'Hard'], ['good', 'Good'], ['easy', 'Easy']].map(([k, label]) => <li key={k}><span className={`state-dot mix-${k}`}/><strong>{mix[k]}</strong> {label} <small>{Math.round(mix[k] / mixTotal * 100)}%</small></li>)}</ul><p>{mix.again / mixTotal > 0.2 ? 'More than a fifth of reviews were forgotten. That is normal for new material; the scheduler is already shortening those intervals.' : 'A healthy mix. Most of what you review, you remember.'}</p></>}</div>
    </div>
  </section>;
}
const pct = v => v == null ? 'Not yet' : `${Math.round(v * 100)}%`;
function RetentionPanel({ stats: s }) {
  const max = Math.max(1, ...s.forecast.map(d => d.due)); const total = Object.values(s.states).reduce((a, b) => a + b, 0) || 1;
  const stateMeta = [['new', 'New', 'Never studied'], ['learning', 'Learning', 'First days'], ['review', 'Review', 'Long-term memory'], ['relearning', 'Relearning', 'Recently forgotten']];
  return <section className="retention-panel"><div className="retention-grid">
    <div className="retention-card"><span className="eyebrow">MEMORY RIGHT NOW</span><div className="retention-numbers"><div><strong>{pct(s.retention.predicted)}</strong><span>predicted recall</span></div><div><strong>{pct(s.retention.observed)}</strong><span>observed, last 30 days{s.retention.sampled ? ` (${s.retention.sampled} reviews)` : ''}</span></div><div><strong>{pct(s.retention.desired)}</strong><span>your target · <Link to="/settings">change</Link></span></div></div><p>{s.retention.predicted == null ? `Review a few cards and ${BRAND.name} will start estimating how much you currently remember.` : s.retention.observed != null && s.retention.observed < s.retention.desired - 0.05 ? 'You are forgetting more than your target. Shorter intervals will follow automatically; rating honestly keeps the model accurate.' : 'The model is on track. Average memory stability is ' + s.retention.averageStability + ' days.'}</p></div>
    <div className="retention-card"><span className="eyebrow">NEXT 14 DAYS</span><div className="forecast" role="img" aria-label={`Due forecast: ${s.forecast.map(d => `${d.due} on ${d.date}`).join(', ')}`}>{s.forecast.map((d, i) => <div key={d.date} className="forecast-bar" title={`${d.due} due on ${d.date}`}><span style={{ height: `${Math.max(d.due ? 6 : 2, d.due / max * 100)}%` }}/><small>{i === 0 ? 'Today' : new Date(d.date + 'T00:00:00Z').toLocaleDateString(undefined, { weekday: 'narrow', timeZone: 'UTC' })}</small></div>)}</div><p>{s.forecast[0].due} card{s.forecast[0].due === 1 ? '' : 's'} ready today, {s.forecast.slice(1, 8).reduce((a, d) => a + d.due, 0)} more over the coming week.</p></div>
    <div className="retention-card"><span className="eyebrow">WHERE YOUR CARDS ARE</span><div className="state-bar" role="img" aria-label={stateMeta.map(([k, l]) => `${l}: ${s.states[k]}`).join(', ')}>{stateMeta.map(([k]) => s.states[k] > 0 && <span key={k} className={`state-${k}`} style={{ flex: s.states[k] }}/>)}</div><ul className="state-legend">{stateMeta.map(([k, label, hint]) => <li key={k}><span className={`state-dot state-${k}`}/><strong>{s.states[k]}</strong> {label} <small>{hint} · {Math.round(s.states[k] / total * 100)}%</small></li>)}</ul></div>
    <div className="retention-card"><span className="eyebrow">HARDEST CARDS</span>{!s.hardest.length ? <p>Once you have reviewed a few cards, the ones your memory struggles with will show up here.</p> : <ul className="hardest-list">{s.hardest.map(c => <li key={c.cardId}><Link to={`/folders/${c.folderId}`}>{c.text}</Link><span title="FSRS difficulty, 1 (easy) to 10 (hard)">D {c.difficulty}</span><span title="Times forgotten">{c.lapses} lapse{c.lapses === 1 ? '' : 's'}</span></li>)}</ul>}</div>
  </div></section>;
}
