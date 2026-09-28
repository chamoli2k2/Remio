import * as teams from '../services/teamService.js';
import * as premium from '../services/premiumService.js';

export const list = async (req, res) => res.json({ teams: await teams.myTeams(req.user) });
export const create = async (req, res) => res.status(201).json({ team: await teams.createTeam(req.user, req.body) });
export const detail = async (req, res) => res.json(await teams.teamDetail(req.user, req.params.id));
export const update = async (req, res) => res.json({ team: await teams.updateTeam(req.user, req.params.id, req.body) });
export const archive = async (req, res) => res.json(await teams.archiveTeam(req.user, req.params.id));

export const invites = async (req, res) => res.json(await teams.listInvites(req.user, req.params.id));
export const invite = async (req, res) => res.status(201).json(await teams.createInvite(req.user, req.params.id, req.body));
export const revokeInvite = async (req, res) => res.json(await teams.revokeInvite(req.user, req.params.id, req.params.inviteId));
export const preview = async (req, res) => res.json(await teams.previewCode(req.params.code));
export const join = async (req, res) => res.status(201).json({ team: await teams.joinWithCode(req.user, req.body.code) });

export const setRole = async (req, res) => res.json(await teams.setRole(req.user, req.params.id, req.params.userId, req.body.role));
export const removeMember = async (req, res) => res.json(await teams.removeMember(req.user, req.params.id, req.params.userId));

export const createFolder = async (req, res) => res.status(201).json(await teams.createTeamFolder(req.user, req.params.id, req.body));
export const createAssignment = async (req, res) => res.status(201).json(await teams.createAssignment(req.user, req.params.id, req.body));
export const archiveAssignment = async (req, res) => res.json(await teams.archiveAssignment(req.user, req.params.id, req.params.assignmentId));
export const progress = async (req, res) => res.json(await teams.teamProgress(req.user, req.params.id, req.query.folderId));

// Seats are sold through the same order pipeline as a personal plan, so these just add the team id.
const withTeam = (req) => ({ ...req.body, teamId: req.params.id });
export const quote = async (req, res) => res.json(await premium.quote(req.user, withTeam(req)));
export const billing = async (req, res) => res.json(await premium.myOrder(req.user, req.params.id));
export const buy = async (req, res) => res.status(201).json(await premium.startCheckout(req.user, withTeam(req)));
export const cancelBuy = async (req, res) => res.json(await premium.cancelOrder(req.user, req.params.id));
