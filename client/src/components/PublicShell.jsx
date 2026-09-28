import { useState } from 'react';
import { Link, NavLink, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowRight, LogIn, Search } from 'lucide-react';
import ThemeToggle from './ThemeToggle';
import SiteFooter from './SiteFooter';
import { BRAND } from '../../../shared/brand.js';

/**
 * The frame around every page a signed-out visitor sees.
 *
 * It lives here rather than beside those pages because it is the one piece of them the landing page
 * needs up front, and its neighbours import the card renderer. Keeping them in one module meant the
 * first visit downloaded a maths typesetter to draw a header.
 */
export default function PublicShell({ children, wide }) {
  const navigate = useNavigate(); const [params] = useSearchParams(); const [query, setQuery] = useState(params.get('q') || '');
  return <div className={`public-page ${wide ? 'public-page-wide' : ''}`}>
    <header className="public-header"><Link className="brand" to="/"><img src="/favicon.svg" alt=""/><span className="brand-word">{BRAND.name}<span className="brand-period">.</span></span></Link>
      <nav className="public-nav" aria-label="Main"><NavLink to="/" end className={({ isActive }) => isActive ? 'active' : ''}>Home</NavLink><NavLink to="/explore" className={({ isActive }) => isActive ? 'active' : ''}>Explore</NavLink></nav>
      <form className="public-search folder-search" onSubmit={e => { e.preventDefault(); navigate(query.trim() ? `/?q=${encodeURIComponent(query.trim())}#library` : '/#library'); }}><Search size={16}/><input aria-label="Search public collections" placeholder="Search collections…" value={query} onChange={e => setQuery(e.target.value)}/></form>
      <div className="public-header-actions"><ThemeToggle/><Link className="button secondary public-signin" to="/login"><LogIn size={16}/> Sign in</Link><Link className="button primary" to="/signup">Get started <ArrowRight size={16}/></Link></div></header>
    <main>{children}</main>
    <SiteFooter/>
  </div>;
}
