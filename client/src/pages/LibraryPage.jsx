import { useState } from 'react';
import AdSlot from '../components/AdSlot';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { Plus, ArrowRight, Search, LayoutGrid, List, BookOpen, Flame, Layers, Globe2, Users, Archive } from 'lucide-react';
import { toast } from 'sonner';
import { useQuery, useApp } from '../hooks/useApp';
import { api } from '../services/api';
import { reportError } from '../services/errors';
import { Button, Loading, ErrorState, Empty, Modal } from '../components/ui';
import FolderTile from '../components/FolderTile';
import FolderModal from '../components/FolderModal';
import ShareModal from '../components/ShareModal';
import DeleteFolderModal from '../components/DeleteFolderModal';
import Select from '../components/Select';

const RING_R = 20, RING_C = 2 * Math.PI * RING_R;
/**
 * Today at a glance: what is waiting, how far along the daily goal is, and the one thing to do next.
 * One strip instead of a hero and a separate goal card, so the collections start above the fold.
 */
function TodayStrip({ stats, onStudy }) {
  const done = stats?.reviewsToday || 0, goal = stats?.goal || 20, share = Math.min(1, done / goal), streak = stats?.streak?.current || 0;
  return <section className="today-strip" aria-label="Today">
    <div className="today-copy">
      <span className="banner-label"><span className="tiny-line"/> A LITTLE PROGRESS, EVERY DAY</span>
      <h2>Keep your curiosity in good company.</h2>
      <p>{stats?.due ? `${stats.due} cards are ready when you are.` : 'Your next discovery is just a card away.'}</p>
    </div>
    <div className="today-art" aria-hidden="true">
      <div className="today-card is-behind"/>
      <div className="today-card is-flipping">
        <div className="today-card-face"><span>DAILY THOUGHT</span><p>What will you learn today?</p></div>
        <div className="today-card-face is-back"><Layers size={16}/><p>a little goes a long way</p></div>
      </div>
    </div>
    <div className="today-meta">
      <Link to="/settings?section=study" className={`today-chip today-goal ${share >= 1 ? 'is-done' : ''}`} aria-label={`Daily goal: ${done} of ${goal} cards reviewed today. Edit daily goal`}>
        <svg viewBox="0 0 48 48" width="42" height="42" aria-hidden="true"><circle cx="24" cy="24" r={RING_R} className="today-ring-track"/><circle cx="24" cy="24" r={RING_R} className="today-ring-fill" strokeDasharray={RING_C} strokeDashoffset={RING_C * (1 - share)}/></svg>
        <span><strong>{done}<small> / {goal}</small></strong><span>Daily goal</span></span>
      </Link>
      {streak > 0 && <div className="today-chip today-streak"><span className="today-chip-icon"><Flame size={18}/></span><span><strong>{streak}</strong><span>day streak</span></span></div>}
      {stats?.game?.level && <Link to="/progress" className="today-chip today-level" aria-label={`Level ${stats.game.level.level}, ${stats.game.level.title}. See your badges`}><span className="today-chip-icon">{stats.game.level.level}</span><span><strong>{stats.game.level.title}</strong><span>{stats.game.level.xp.toLocaleString()} XP</span></span></Link>}
    </div>
    <Button className="white-button today-cta" onClick={onStudy}>Start a study session <ArrowRight size={17}/></Button>
  </section>;
}

export default function LibraryPage({ mode = 'library' }) {
  const { user, refresh } = useApp(); const navigate = useNavigate(); const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState('all'), [layout, setLayout] = useState('grid'), [sort, setSort] = useState('recent'), [create, setCreate] = useState(false), [edit, setEdit] = useState(null), [share, setShare] = useState(null), [archive, setArchive] = useState(null), [remove, setRemove] = useState(null);
  const query = params.get('q') || '';
  const { data, loading, error } = useQuery(mode === 'explore' ? '/folders?scope=explore' : mode === 'archive' ? '/folders/archived' : '/folders');
  const { data: statsData } = useQuery('/stats'); const stats = statsData?.stats;
  const all = (data?.folders || []).filter(f => mode !== 'shared' || f.role !== 'owner' && f.members?.some(m => m.user.id === user.id));
  let folders = all.filter(f => (!query || `${f.title} ${f.description}`.toLowerCase().includes(query.toLowerCase())) && (mode !== 'library' || tab === 'all' || tab === 'private' && f.visibility === 'private' || tab === 'global' && f.visibility === 'global' || tab === 'saved' && (f.liked || f.saved)));
  folders = [...folders].sort((a, b) => sort === 'name' ? a.title.localeCompare(b.title) : sort === 'cards' ? b.cardCount - a.cardCount : new Date(b.updatedAt) - new Date(a.updatedAt));
  const title = { library: 'My library', shared: 'Better, together.', explore: 'Follow your curiosity.', archive: 'Archived folders' }[mode];
  const sub = { library: 'A home for everything you want to remember.', shared: 'Shared collections. Fresh perspectives. Your own progress.', explore: 'Find your next subject in the community’s public collections.', archive: 'Your collections are safely tucked away. Restore them anytime.' }[mode];
  return <><div className="page-heading"><div><div className="eyebrow">{mode === 'library' ? `YOUR PERSONAL LEARNING SPACE` : mode === 'explore' ? 'THE COMMUNITY LIBRARY' : 'YOUR WORKSPACE'}</div><h1>{title}</h1><p>{sub}</p></div><Button className="primary" onClick={() => setCreate(true)}><Plus size={18}/> New folder</Button></div>
    {mode === 'library' && <TodayStrip stats={stats} onStudy={() => { const first = all.find(f => f.cardCount); first ? navigate(`/folders/${first.id}/study?mode=due`) : setCreate(true); }}/>}
    {mode === 'library' && <div className="library-section-heading"><h2>Your collections <span>{all.length}</span></h2><span><BookOpen size={15}/> {stats?.totalCards || 0} cards, endless possibilities</span></div>}
    <div className="library-toolbar">{mode === 'library' ? <div className="tabs" role="tablist" aria-label="Folder filters">{[['all', 'All folders'], ['private', 'Private'], ['global', 'Global'], ['saved', 'Liked']].map(([value, label]) => <button key={value} role="tab" aria-selected={tab === value} className={tab === value ? 'active' : ''} onClick={() => setTab(value)}>{label}{value === 'all' && <span>{all.length}</span>}</button>)}</div> : <div className="collection-label">{mode === 'explore' ? <Globe2 size={18}/> : mode === 'shared' ? <Users size={18}/> : <Archive size={18}/>} {all.length} collections</div>}<div className="toolbar-right"><div className="folder-search"><Search size={16}/><input aria-label="Filter folders" placeholder="Search folders" value={query} onChange={e => setParams(e.target.value ? { q: e.target.value } : {})}/></div><Select compact label="Sort folders" value={sort} onChange={setSort} options={[{ value: 'recent', label: 'Recently updated' }, { value: 'name', label: 'Name A–Z' }, { value: 'cards', label: 'Most cards' }]}/><div className="view-switch"><button className={layout === 'grid' ? 'active' : ''} onClick={() => setLayout('grid')} aria-label="Grid view" aria-pressed={layout === 'grid'}><LayoutGrid size={17}/></button><button className={layout === 'list' ? 'active' : ''} onClick={() => setLayout('list')} aria-label="List view" aria-pressed={layout === 'list'}><List size={18}/></button></div></div></div>
    {loading ? <Loading/> : error ? <ErrorState message={error}/> : folders.length === 0 ? <Empty title={query ? 'No matching folders' : mode === 'shared' ? 'Learning together starts here' : mode === 'archive' ? 'Nothing archived' : 'Make space for something new'} text={query ? 'Try a different search or filter.' : mode === 'shared' ? `Ask a friend to share a folder with @${user.username}.` : mode === 'archive' ? 'Archived collections will appear here.' : 'Create your first folder and add a few things you want to remember.'} action={mode === 'library' && <Button className="primary" onClick={() => setCreate(true)}><Plus size={17}/> Create a folder</Button>}/> : <div className={`folder-grid ${layout === 'list' ? 'folder-list' : ''}`}>{folders.map(f => mode === 'archive' ? <div className="archive-item" key={f.id}><h3>{f.title}</h3><p>{f.cardCount} cards</p><div className="archive-item-actions"><Button className="secondary" onClick={async () => { try { await api(`/folders/${f.id}/archive`, { method: 'PATCH', body: { archived: false } }); refresh(); toast.success('Folder restored'); } catch (e) { reportError(e); } }}>Restore folder</Button><Button className="danger-button" onClick={() => setRemove(f)}>Delete forever</Button></div></div> : <FolderTile key={f.id} folder={f} list={layout === 'list'} onEdit={setEdit} onShare={setShare} onArchive={setArchive} onDelete={setRemove}/>)}</div>}
    <AdSlot placement={mode === 'explore' ? 'explore' : 'library'}/>
    {(create || edit) && <FolderModal folder={edit} onClose={() => { setCreate(false); setEdit(null); }}/>} {share && <ShareModal folder={share} onClose={() => setShare(null)}/>}
    <Modal open={!!archive} onClose={() => setArchive(null)} title="Archive this folder?" description="Your cards stay safe. You can restore the folder from Archived folders."><div className="modal-actions"><Button className="secondary" onClick={() => setArchive(null)}>Cancel</Button><Button className="primary" onClick={async () => { try { await api(`/folders/${archive.id}/archive`, { method: 'PATCH', body: { archived: true } }); setArchive(null); refresh(); toast.success('Folder archived'); } catch (e) { reportError(e); } }}>Archive folder</Button></div></Modal>
    {remove && <DeleteFolderModal folder={remove} onClose={() => setRemove(null)} onDeleted={() => { setRemove(null); refresh('/folders', '/stats'); }}/>}
  </>;
}
