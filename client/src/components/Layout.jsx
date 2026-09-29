import { useState, useEffect, useCallback } from 'react';
import NoticeBanner from './NoticeBanner';
import { NavLink, Link, Outlet, useNavigate } from 'react-router-dom';
import { LibraryBig, Compass, Users, ChartNoAxesCombined, Plus, Settings2, Menu as MenuIcon, Search, Archive, LogOut, Swords, FolderOpen, UserPlus, LayoutDashboard, Crown, GraduationCap } from 'lucide-react';
import { Avatar, Button } from './ui';
import { useApp, useQuery } from '../hooks/useApp';
import { api } from '../services/api';
import { reportError } from '../services/errors';
import FolderModal from './FolderModal';
import ThemeToggle from './ThemeToggle';
import NotificationBell from './NotificationBell';
import SiteFooter from './SiteFooter';
import { PremiumMark } from './PremiumMark';
import { hasDashboard, hasPremium } from '../../../shared/account.js';
import { BRAND } from '../../../shared/brand.js';
const SIDEBAR = { min: 196, max: 400, default: 240, key: BRAND.storage.sidebar };
const clampWidth = px => Math.min(SIDEBAR.max, Math.max(SIDEBAR.min, Math.round(px)));
/** Width lives in a CSS variable so one drag moves the sidebar and the workspace together.
 *  Zero means "never dragged", which leaves the responsive defaults in the stylesheet alone. */
function useSidebarWidth() {
  const [width, setWidth] = useState(() => Number(localStorage.getItem(SIDEBAR.key)) || 0);
  useEffect(() => {
    if (!width) { document.documentElement.style.removeProperty('--sidebar-w'); localStorage.removeItem(SIDEBAR.key); return; }
    document.documentElement.style.setProperty('--sidebar-w', `${width}px`);
    localStorage.setItem(SIDEBAR.key, String(width));
  }, [width]);
  const drag = useCallback(event => {
    event.preventDefault();
    const move = e => setWidth(clampWidth(e.clientX));
    const stop = () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', stop); document.body.classList.remove('is-resizing'); };
    document.body.classList.add('is-resizing');
    document.addEventListener('pointermove', move); document.addEventListener('pointerup', stop);
  }, []);
  const nudge = useCallback(event => {
    const step = event.shiftKey ? 32 : 8;
    if (event.key === 'ArrowLeft') setWidth(w => clampWidth((w || SIDEBAR.default) - step));
    else if (event.key === 'ArrowRight') setWidth(w => clampWidth((w || SIDEBAR.default) + step));
    else if (event.key !== 'Home') return;
    else setWidth(0);
    event.preventDefault();
  }, []);
  return { width, drag, nudge, reset: () => setWidth(0) };
}
export default function Layout() {
  const { user, isDemo, setUser } = useApp(); const navigate = useNavigate();
  const [create, setCreate] = useState(false), [mobile, setMobile] = useState(false), [query, setQuery] = useState(''), [people, setPeople] = useState([]);
  const { data } = useQuery('/folders');
  const sidebar = useSidebarWidth();
  /**
   * Grouped by how far a destination sits from your own material: the folders you own, then what
   * you do with them, then the people you do it with. Twelve flat links all looked equally likely,
   * which made the list something to read rather than something to aim at.
   *
   * Anything about the account rather than the learning is left out and sits below, past the folder
   * list, where it is out of the way of everything reached daily.
   */
  const groups = [
    ['WORKSPACE', [['/', LibraryBig, 'My library'], ['/projects', FolderOpen, 'Projects', true], ['/archive', Archive, 'Archived folders']]],
    ['STUDY', [['/progress', ChartNoAxesCombined, 'My progress'], ...(isDemo ? [] : [['/rooms', Swords, 'Live quiz', true]])]],
    ['PEOPLE', [['/teams', GraduationCap, 'Classrooms'], ['/shared', Users, 'Shared with me'], ['/friends', UserPlus, 'Friends'], ['/explore', Compass, 'Explore']]],
  ];
  async function signOut() {
    try { if (!isDemo) await api('/auth/logout', { method: 'POST' }); setUser(null); setMobile(false); navigate('/'); }
    catch (e) { reportError(e); }
  }
  async function onSearch(value) {
    setQuery(value);
    if (value.trim().length < 2) { setPeople([]); return; }
    try { const d = await api(`/users?q=${encodeURIComponent(value.trim())}`); setPeople(d.users || []); } catch { setPeople([]); }
  }
  return <div className="app-shell">
    {mobile && <button className="mobile-scrim" aria-label="Close navigation" onClick={() => setMobile(false)}/>}
    <aside className={`sidebar ${mobile ? 'open' : ''}`}>
      <Link className="brand" to="/" onClick={() => setMobile(false)}><img src="/favicon.svg" alt=""/><span className="brand-word">{BRAND.name}<span className="brand-period">.</span></span></Link>
      <Button className="primary sidebar-create" onClick={() => setCreate(true)}><span className="sidebar-create-icon"><Plus size={16}/></span> Create a folder</Button>
      <div className="sidebar-scroll">
        {groups.map(([caption, items]) => <div className="nav-group" key={caption}>
          <div className="nav-caption">{caption}</div>
          <nav>{items.map(([to, Icon, title, premium]) => <NavLink key={to} to={to} end onClick={() => setMobile(false)} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}><Icon size={18}/><span>{title}</span>{premium && <PremiumMark/>}{to === '/' && <span className="nav-count">{data?.folders?.length || 0}</span>}</NavLink>)}</nav>
        </div>)}
        <div className="nav-group">
          <div className="nav-caption folder-caption">YOUR FOLDERS <button className="icon-button" aria-label="Create another folder" onClick={() => setCreate(true)}><Plus size={15}/></button></div>
          <div>{data?.folders?.filter(f => f.role === 'owner').slice(0, 5).map(f => <NavLink key={f.id} to={`/folders/${f.id}`} onClick={() => setMobile(false)} className="folder-link"><span className={`folder-dot ${f.color}`}/><span>{f.title}</span></NavLink>)}</div>
        </div>
        <div className="sidebar-bottom">
          {hasDashboard(user) && <NavLink to="/dashboard" onClick={() => setMobile(false)} className="nav-link"><LayoutDashboard size={18}/> Dashboard</NavLink>}
          <NavLink to="/premium" onClick={() => setMobile(false)} className="nav-link"><Crown size={18}/> {hasPremium(user) ? 'Premium' : 'Buy Premium'}</NavLink>
          <NavLink to="/settings" onClick={() => setMobile(false)} className="nav-link"><Settings2 size={18}/> Settings</NavLink>
        </div>
      </div>
      <div className="account"><Link className="account-id" to={`/u/${user?.username || ''}`} onClick={() => setMobile(false)}><Avatar user={user} small/><span><strong>{user?.name || 'Guest'}</strong><span>@{user?.username || 'guest'}</span></span></Link><button className="account-out" onClick={signOut} title={isDemo ? 'Leave preview' : 'Sign out'}><LogOut size={15}/><span>{isDemo ? 'Leave' : 'Sign out'}</span></button></div>
    </aside>
    <div className="sidebar-resizer" role="separator" aria-orientation="vertical" aria-label="Resize the sidebar" aria-valuenow={sidebar.width || SIDEBAR.default} aria-valuemin={SIDEBAR.min} aria-valuemax={SIDEBAR.max} tabIndex={0} onPointerDown={sidebar.drag} onKeyDown={sidebar.nudge} onDoubleClick={sidebar.reset}/>
    <div className="workspace"><NoticeBanner/><header className="topbar"><div className="breadcrumb"><button className="icon-button mobile-toggle" aria-label="Open navigation" onClick={() => setMobile(true)}><MenuIcon size={20}/></button><strong>Library</strong></div><form className="global-search" onSubmit={e => { e.preventDefault(); if (people[0]) navigate(`/u/${people[0].username}`); else navigate(`/?q=${encodeURIComponent(query)}`); }}><Search size={16}/><input aria-label="Search folders and people" placeholder="Folders or people…" value={query} onChange={e => onSearch(e.target.value)}/>{people.length > 0 && <div className="search-people">{people.map(p => <Link key={p.id} to={`/u/${p.username}`} onClick={() => { setQuery(''); setPeople([]); }}><Avatar user={p} small/><span>{p.name} <small>@{p.username}</small></span></Link>)}</div>}</form><NotificationBell/><ThemeToggle/><Link to={`/u/${user?.username || ''}`} aria-label="Your profile"><Avatar user={user} small/></Link></header>
      {isDemo && <div className="demo-banner"><span className="demo-pill">INTERACTIVE PREVIEW</span><span>Try the sample workspace. Changes reset on refresh; accounts and live sharing require the backend.</span></div>}
      <main className="main-content"><Outlet/></main><SiteFooter/>
    </div>
    {create && <FolderModal onClose={() => setCreate(false)}/>}
  </div>;
}
