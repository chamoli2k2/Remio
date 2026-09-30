import { Link, useNavigate } from 'react-router-dom';
import { LockKeyhole, Globe2, Copy, Share2, Pencil, Archive, ArrowUpRight, Layers, Heart } from 'lucide-react';
import { Avatar, FolderIcon, Menu, Tag } from './ui';
import { api } from '../services/api';
import Img from './Img';
import { reportError } from '../services/errors';
import { useApp, usePrefetch } from '../hooks/useApp';
import { folderQuery } from '../services/queries';
import { toast } from 'sonner';
export default function FolderTile({ folder, onShare, onEdit, onArchive, list }) {
  const { refresh } = useApp(); const navigate = useNavigate(); const f = folder;
  // Hovering a tile is a good enough guess that this collection is about to be opened, and a
  // wrong guess costs one request the cache keeps anyway. The click then has nothing to wait for.
  const warm = usePrefetch(...folderQuery(f.id));
  const items = [f.role === 'owner' && { label: 'Edit folder', icon: <Pencil size={15}/>, action: () => onEdit(f) }, { label: 'Share folder', icon: <Share2 size={15}/>, action: () => onShare(f) }, { label: 'Make a private copy', icon: <Copy size={15}/>, action: async () => { try { const d = await api(`/folders/${f.id}/copy`, { method: 'POST' }); refresh(); navigate(`/folders/${d.folder.id}`); toast.success('Private copy created'); } catch (e) { reportError(e); } } }, f.role === 'owner' && { label: 'Archive folder', icon: <Archive size={15}/>, action: () => onArchive(f) }];
  return <article className={`folder-tile ${list ? 'list-tile' : ''}`} {...warm}><div className={`tile-cover ${f.color}`}>{f.thumbnail && <Img className="tile-thumb" id={f.thumbnail} alt={`${f.title} flashcard collection`} sizes="(max-width: 640px) 100vw, 300px" max={f.thumbnailWidth}/>}<Link to={`/folders/${f.id}`} className="cover-link" aria-label={`Open ${f.title}`}>{!f.thumbnail && <><span className="folder-icon"><FolderIcon name={f.icon} size={30}/></span><span className="cover-word">{f.icon === 'code' ? '{ }' : f.icon === 'globe' ? 'Hola.' : f.icon === 'palette' ? 'Aa' : f.icon === 'terminal' ? '>_' : f.icon === 'brain' ? 'Think.' : 'Learn.'}</span></>}</Link><span className="visibility-badge">{f.visibility === 'global' ? <Globe2 size={12}/> : <LockKeyhole size={12}/>} {f.visibility === 'global' ? 'Global' : 'Private'}</span><div className="tile-menu"><Menu items={items} label={`Options for ${f.title}`}/></div></div><div className="tile-body"><Link to={`/folders/${f.id}`} className="tile-title">{f.title}<ArrowUpRight size={17}/></Link><p>{f.description || 'A new collection of things worth remembering.'}</p><div className="tile-tags">{(f.tags || []).slice(0, 2).map(t => <Tag key={t}>{t}</Tag>)}</div><div className="tile-footer"><span><Layers size={14}/>{f.cardCount}</span><span><Heart size={13}/> {f.likeCount || 0}</span><span><Copy size={13}/> {f.copyCount || 0}</span><div className="tile-people"><Avatar user={f.owner} small/></div></div></div></article>;
}
