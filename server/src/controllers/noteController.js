import * as notes from '../services/noteService.js';

export const listCollections = async (req, res) => res.json(await notes.listCollections(req.user));
export const createCollection = async (req, res) => res.status(201).json({ collection: await notes.presentCollection(await notes.createCollection(req.user, req.body), req.user, 0) });
export const getCollection = async (req, res) => res.json(await notes.getCollection(req.params.id, req.user, { archived: req.query.archived === '1' }));
export const updateCollection = async (req, res) => res.json({ collection: await notes.presentCollection(await notes.updateCollection(req.params.id, req.user, req.body), req.user) });
export const collectionMember = async (req, res) => res.json({ collection: await notes.presentCollection(await notes.setCollectionMember(req.params.id, req.user, req.body.username, req.body.role), req.user) });
export const deleteCollection = async (req, res) => res.json(await notes.deleteCollection(req.params.id, req.user, req.body.confirm));
export const listNotebooks = async (req, res) => res.json({ notebooks: await notes.listNotebooks(req.user, { archived: req.query.archived === '1' }) });
export const createNotebook = async (req, res) => res.status(201).json({ notebook: await notes.presentNotebook(await notes.createNotebook(req.user, req.body), req.user, 0) });
export const getNotebook = async (req, res) => res.json(await notes.listNotes(req.params.id, req.user));
export const updateNotebook = async (req, res) => res.json({ notebook: await notes.presentNotebook(await notes.updateNotebook(req.params.id, req.user, req.body), req.user) });
export const archiveNotebook = async (req, res) => res.json({ notebook: await notes.presentNotebook(await notes.archiveNotebook(req.params.id, req.user, req.body.archived), req.user) });
export const deleteNotebook = async (req, res) => res.json(await notes.deleteNotebook(req.params.id, req.user, req.body.confirm));
export const member = async (req, res) => res.json({ notebook: await notes.presentNotebook(await notes.setMember(req.params.id, req.user, req.body.username, req.body.role), req.user) });
export const createNote = async (req, res) => res.status(201).json({ note: await notes.createNote(req.params.id, req.user, req.body) });
export const getNote = async (req, res) => res.json(await notes.getNote(req.params.id, req.user));
export const updateNote = async (req, res) => res.json({ note: await notes.updateNote(req.params.id, req.user, req.body) });
export const deleteNote = async (req, res) => res.json(await notes.deleteNote(req.params.id, req.user));
export const search = async (req, res) => res.json({ notes: await notes.searchNotes(req.user, req.query.q) });
export const upload = async (req, res) => res.status(201).json(await notes.uploadImage(req.params.id, req.user, req.file));
export const saveDrawing = async (req, res) => res.status(201).json(await notes.saveDrawing(req.params.id, req.user, req.body));

/** Drawings never change once saved, and a notebook is never public, so a private, permanent cache fits. */
export const drawing = async (req, res) => {
  const body = await notes.readDrawing(req.params.id, req.params.drawingId, req.user);
  res.set({ 'Content-Type': 'application/json; charset=utf-8', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, max-age=31536000, immutable' });
  res.send(body);
};
