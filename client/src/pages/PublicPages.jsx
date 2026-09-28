import { useState } from 'react';
import { Link, NavLink, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Globe2, RotateCcw, LogIn, Search } from 'lucide-react';
import { api, imageUrl } from '../services/api';
import { reportError } from '../services/errors';
import { useApp, useQuery } from '../hooks/useApp';
import { Avatar, FolderIcon, Loading, ErrorState, Tag, Empty, Button } from '../components/ui';
import RichText, { sideOf, plainText } from '../components/RichText';
import { BRAND } from '../../../shared/brand.js';
export { default as PublicShell } from '../components/PublicShell';
function matchesFolder(folder, query) {
  if (!query) return true;
  const hay = `${folder.title} ${folder.description} ${folder.tags?.join(' ') || ''} ${folder.owner?.username || ''}`.toLowerCase();
  return hay.includes(query.toLowerCase());
}
export function PublicFolderPage() {
  const { id } = useParams(); const { data, loading, error } = useQuery(`/folders/${id}`, () => Promise.all([api(`/folders/${id}`), api(`/folders/${id}/cards`)]).then(([f, c]) => ({ ...f, ...c }))); const [flipped, setFlipped] = useState({});
  if (loading) return <Loading/>; if (error) return <Empty title="This collection isn’t available" text="It may be private. Sign in with an invited account to open it." action={<Link className="button primary" to="/login">Sign in</Link>}/>;
  return <><Link to="/explore" className="back-link"><ArrowLeft size={16}/> Explore collections</Link><div className="page-heading"><div><span className="eyebrow">A PUBLIC COLLECTION</span><h1>{data.folder.title}</h1><p>{data.folder.description}</p><Link to={`/u/${data.folder.owner.username}`} className="text-button">by @{data.folder.owner.username}</Link></div><div className={`large-folder-icon ${data.folder.color}`}><FolderIcon name={data.folder.icon} size={32}/></div></div><div className="folder-study-strip public-study-strip"><div><span className="study-strip-icon"><Globe2 size={22}/></span><div><h3>Flip any card to study it right here.</h3><p>Sign in to save this collection, make a private copy, and track your progress.</p></div></div><div><Link className="button primary" to="/signup">Create a free account</Link><Link className="button secondary" to="/login">Sign in</Link></div></div><div className="flashcard-grid">{data.cards.map((card, i) => { const side = sideOf(card, flipped[card.id]); return <article className="flashcard-item" key={card.id}><div className="flashcard-top">{i + 1} · {flipped[card.id] ? 'ANSWER' : 'QUESTION'}</div><button className="card-content" aria-label={`Flip card ${i + 1}`} onClick={() => setFlipped(f => ({ ...f, [card.id]: !f[card.id] }))}>{side.image && <img src={imageUrl(side.image)} alt={plainText(side.text) || 'Flashcard image'}/>}<RichText text={side.text} cloze={side.cloze}/></button><div className="flashcard-footer"><div>{card.tags.map(tag => <Tag key={tag}>{tag}</Tag>)}</div><RotateCcw size={14}/></div></article>; })}</div></>;
}
export function ProfilePage() {
  const { username } = useParams(); const { user, refresh } = useApp();
  const { data, loading, error } = useQuery(`/users/${username}`);
  if (loading) return <Loading/>; if (error) return <ErrorState message={error}/>;
  const p = data.profile; const rel = p.relation || { following: false, friendship: user?.username === p.username ? 'self' : 'none' };
  async function act(path, method = 'POST') { try { await api(`/users/${p.username}/${path}`, { method }); refresh(); } catch (e) { reportError(e); } }
  return <><Link to="/" className="back-link"><ArrowLeft size={16}/> Back</Link>
    <div className="profile-header public-profile"><Avatar user={p}/>
      <div><span className="eyebrow">LEARNER</span><h1>{p.name}</h1><p>@{p.username}</p>{p.bio && <p>{p.bio}</p>}
        <div className="profile-counts"><span><strong>{p.followers || 0}</strong> followers</span><span><strong>{p.following || 0}</strong> following</span><span><strong>{p.friends || 0}</strong> friends</span></div>
      </div>
      {user && rel.friendship !== 'self' && <div className="profile-actions">
        <Button className={rel.following ? 'secondary' : 'primary'} onClick={() => act('follow', rel.following ? 'DELETE' : 'POST')}>{rel.following ? 'Following' : 'Follow'}</Button>
        {rel.friendship === 'none' && <Button className="secondary" onClick={() => act('connect')}>Connect</Button>}
        {rel.friendship === 'outgoing' && <Button className="secondary" disabled>Requested</Button>}
        {rel.friendship === 'incoming' && <><Button className="primary" onClick={() => act('connect/accept')}>Accept</Button><Button className="secondary" onClick={() => act('connect/decline')}>Decline</Button></>}
        {rel.friendship === 'friends' && <Button className="secondary" onClick={() => act('connect', 'DELETE')}>Friends</Button>}
      </div>}
    </div>
    <div className="library-section-heading"><h2>Public collections <span>{data.folders.length}</span></h2></div>
    {!data.folders.length ? <Empty title="A little mystery" text="This learner hasn’t published any collections yet."/> : <div className="folder-grid">{data.folders.map(folder => <Link className="public-folder" to={`/folders/${folder.id}`} key={folder.id}>{folder.thumbnail ? <img className="folder-thumb" src={imageUrl(folder.thumbnail)} alt=""/> : <div className={`large-folder-icon ${folder.color}`}><FolderIcon name={folder.icon} size={28}/></div>}<h3>{folder.title}</h3><p>{folder.description}</p><span>{folder.cardCount} cards · {folder.likeCount || 0} likes · {folder.copyCount || 0} copies</span></Link>)}</div>}</>;
}
export function PublicExplorePage() {
  const [params, setParams] = useSearchParams(); const query = params.get('q') || '';
  const { data, loading, error } = useQuery('/folders?scope=explore');
  if (loading) return <Loading/>; if (error) return <ErrorState message={error}/>;
  const folders = (data.folders || []).filter(f => matchesFolder(f, query));
  return <><div className="page-heading"><div><span className="eyebrow">THE COMMUNITY LIBRARY</span><h1>Follow your curiosity.</h1><p>Public collections from curious people. Search without signing in.</p></div></div>
    <form className="home-search folder-search explore-search" onSubmit={e => e.preventDefault()}><Search size={16}/><input aria-label="Search public collections" placeholder="Search public collections…" value={query} onChange={e => setParams(e.target.value ? { q: e.target.value } : {})}/></form>
    {!folders.length ? <Empty title={query ? 'No matching collections' : 'Nothing public yet'} text={query ? 'Try another word. Titles, descriptions, tags, and authors are searchable.' : 'Publish a folder to share it with everyone.'}/> : <div className="folder-grid">{folders.map(folder => <Link className="public-folder" to={`/folders/${folder.id}`} key={folder.id}><div className={`large-folder-icon ${folder.color}`}><FolderIcon name={folder.icon} size={28}/></div><h3>{folder.title}</h3><p>{folder.description}</p><span>{folder.cardCount} cards <ArrowRight size={15}/></span></Link>)}</div>}</>;
}
