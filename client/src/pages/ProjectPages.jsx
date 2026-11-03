import { useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { Plus, ArrowLeft, FolderPlus, Trash2, Crown } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../services/api';
import { reportError } from '../services/errors';
import { useApp, useQuery } from '../hooks/useApp';
import { usePageTitle } from '../hooks/usePageTitle';
import { Button, Loading, ErrorState, Empty, Modal, Field } from '../components/ui';
import FolderTile from '../components/FolderTile';
import { hasPremium } from '../../../shared/account.js';
export function ProjectModal({ project, onClose }) {
  const { refresh } = useApp(); const navigate = useNavigate();
  const [form, setForm] = useState({ title: project?.title || '', description: project?.description || '', visibility: project?.visibility || 'private' });
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function submit(e) {
    e.preventDefault(); setBusy(true); setError('');
    try {
      const d = await api(project ? `/projects/${project.id}` : '/projects', { method: project ? 'PATCH' : 'POST', body: { ...form, ...(project ? { version: project.version } : {}) } });
      refresh(); toast.success(project ? 'Project updated' : 'Project created'); onClose(); if (!project) navigate(`/projects/${d.project.id}`);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  return <Modal open onClose={onClose} title={project ? 'Edit project' : 'New project'} description="Group folders you already have. A folder can live in several projects, or none.">
    <form className="form-stack" onSubmit={submit}>
      <Field label="Name"><input required maxLength={80} value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}/></Field>
      <Field label="Description · optional"><textarea rows={2} maxLength={500} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}/></Field>
      <Field label="Visibility"><div className="visibility-options">{[['private', 'Private', 'Only you'], ['global', 'Global', 'On your public profile']].map(([value, name, hint]) => <button key={value} type="button" className={form.visibility === value ? 'selected' : ''} aria-pressed={form.visibility === value} onClick={() => setForm(f => ({ ...f, visibility: value }))}><span><strong>{name}</strong><small>{hint}</small></span></button>)}</div></Field>
      {error && <ErrorState message={error}/>}
      <div className="modal-actions"><Button type="button" className="secondary" onClick={onClose}>Cancel</Button><Button className="primary" loading={busy} type="submit">{project ? 'Save' : 'Create project'}</Button></div>
    </form>
  </Modal>;
}
export function ProjectsPage() {
  const { refresh, user } = useApp(); const navigate = useNavigate(); const [create, setCreate] = useState(false);
  const { data, loading, error } = useQuery('/projects', undefined, { enabled: hasPremium(user) });
  const projects = data?.projects || [];
  if (!hasPremium(user)) return <><div className="page-heading"><div><span className="eyebrow">PREMIUM</span><h1>Projects</h1><p>Group folders you already have. This is a Premium feature.</p></div></div><Empty title="Projects are Premium" text="Upgrade to create projects. Folders themselves stay free." action={<Button className="primary" onClick={() => navigate('/premium')}><Crown size={16}/> See Premium</Button>}/></>;
  return <>
    <div className="page-heading"><div><span className="eyebrow">GROUP YOUR WORK</span><h1>Projects</h1><p>A project holds folders. Folders stay independent and can belong to more than one project.</p></div><Button className="primary" onClick={() => setCreate(true)}><Plus size={18}/> New project</Button></div>
    {loading ? <Loading/> : error ? <ErrorState message={error}/> : !projects.length ? <Empty title="No projects yet" text="Create a project, then add folders you already own or can read." action={<Button className="primary" onClick={() => setCreate(true)}><Plus size={16}/> Create a project</Button>}/> : <div className="folder-grid">{projects.map(p => <Link className="public-folder" to={`/projects/${p.id}`} key={p.id}><h3>{p.title}</h3><p>{p.description || 'A group of folders.'}</p><span>{p.folderCount} folders</span></Link>)}</div>}
    {create && <ProjectModal onClose={() => { setCreate(false); refresh(); }}/>}
  </>;
}
export function ProjectPage() {
  const { id } = useParams(); const { refresh } = useApp();
  const { data, loading, error } = useQuery(`/projects/${id}`);
  usePageTitle(data?.project?.title);
  const { data: lib } = useQuery('/folders');
  const [add, setAdd] = useState(false), [edit, setEdit] = useState(false);
  const project = data?.project;
  async function addFolder(folderId) { try { await api(`/projects/${id}/folders`, { method: 'POST', body: { folderId } }); refresh(); setAdd(false); toast.success('Folder added'); } catch (e) { reportError(e); } }
  async function remove(folderId) { try { await api(`/projects/${id}/folders/${folderId}`, { method: 'DELETE' }); refresh(); } catch (e) { reportError(e); } }
  if (loading) return <Loading/>; if (error || !project) return <ErrorState message={error || 'Project not found.'}/>;
  const have = new Set((project.folders || []).map(f => f.id));
  const available = (lib?.folders || []).filter(f => !have.has(f.id));
  return <>
    <Link to="/projects" className="back-link"><ArrowLeft size={16}/> All projects</Link>
    <div className="page-heading"><div><span className="eyebrow">{project.visibility === 'global' ? 'PUBLIC PROJECT' : 'PRIVATE PROJECT'}</span><h1>{project.title}</h1><p>{project.description}</p></div><div className="folder-heading-actions">{project.role === 'owner' && <><Button className="secondary" onClick={() => setEdit(true)}>Edit</Button><Button className="primary" onClick={() => setAdd(true)}><FolderPlus size={16}/> Add folder</Button></>}</div></div>
    {!project.folders.length ? <Empty title="Empty project" text="Add a folder you can already access. Removing it later does not delete the folder."/> : <div className="folder-grid">{project.folders.map(f => <div key={f.id} className="project-folder-wrap"><FolderTile folder={f} onEdit={() => {}} onShare={() => {}} onArchive={() => {}}/>{project.role === 'owner' && <button type="button" className="text-button" onClick={() => remove(f.id)}><Trash2 size={14}/> Remove from project</button>}</div>)}</div>}
    {edit && <ProjectModal project={project} onClose={() => { setEdit(false); refresh(); }}/>}
    <Modal open={add} onClose={() => setAdd(false)} title="Add a folder" description="Pick a folder from your library. It can stay in other projects too.">
      {!available.length ? <p>Every folder you can access is already in this project.</p> : <ul className="people-list">{available.map(f => <li key={f.id}><div className="person-row"><div><strong>{f.title}</strong><span>{f.cardCount} cards</span></div></div><Button className="secondary" onClick={() => addFolder(f.id)}>Add</Button></li>)}</ul>}
    </Modal>
  </>;
}
