import { MAX_FOLDERS_PER_PROJECT } from '../constants/index.js';
import { Project, Folder } from '../models/index.js';
import { accessFolder, roleOf } from './accessService.js';
import { presentFolder } from './folderService.js';
import { assert } from '../utils/errors.js';

const MAX_FOLDERS = MAX_FOLDERS_PER_PROJECT;
export async function presentProject(project, user) {
  const json = project.toJSON();
  const folders = [];
  for (const id of project.folders || []) {
    try {
      const folder = await accessFolder(id, user);
      folders.push(await presentFolder(folder, user));
    } catch { /* skip folders the viewer cannot read */ }
  }
  return { ...json, folders, folderCount: folders.length, role: String(project.owner) === String(user?.id) ? 'owner' : 'viewer' };
}

export async function listProjects(user) {
  const projects = await Project.find({ owner: user.id, archived: false }).sort({ updatedAt: -1 }).limit(50);
  return Promise.all(projects.map(p => presentProject(p, user)));
}

export async function getProject(id, user) {
  const project = await Project.findById(id);
  assert(project && !project.archived, 404, 'Project not found.');
  if (project.visibility !== 'global') assert(String(project.owner) === String(user?.id), 404, 'Project not found.');
  return presentProject(project, user);
}

export async function createProject(user, body) {
  const project = await Project.create({ title: body.title, description: body.description || '', visibility: body.visibility || 'private', owner: user.id });
  return presentProject(project, user);
}

export async function updateProject(id, user, body) {
  const project = await Project.findById(id);
  assert(project && String(project.owner) === String(user.id) && !project.archived, 404, 'Project not found.');
  assert(project.version === body.version, 409, 'This project changed. Refresh and try again.', 'VERSION_CONFLICT');
  project.title = body.title; project.description = body.description || ''; project.visibility = body.visibility || project.visibility;
  project.version += 1; await project.save();
  return presentProject(project, user);
}

export async function archiveProject(id, user, archived) {
  const project = await Project.findById(id);
  assert(project && String(project.owner) === String(user.id), 404, 'Project not found.');
  project.archived = archived; project.version += 1; await project.save();
  return { ok: true };
}

export async function addFolder(id, user, folderId) {
  const project = await Project.findById(id);
  assert(project && String(project.owner) === String(user.id) && !project.archived, 404, 'Project not found.');
  assert((project.folders || []).length < MAX_FOLDERS, 400, `A project can hold ${MAX_FOLDERS} folders.`);
  const folder = await accessFolder(folderId, user);
  assert(roleOf(folder, user), 404, 'Folder not found.');
  await Project.updateOne({ _id: project.id }, { $addToSet: { folders: folder.id } });
  return getProject(id, user);
}

export async function removeFolder(id, user, folderId) {
  const project = await Project.findById(id);
  assert(project && String(project.owner) === String(user.id), 404, 'Project not found.');
  await Project.updateOne({ _id: project.id }, { $pull: { folders: folderId } });
  return getProject(id, user);
}
