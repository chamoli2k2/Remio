import * as moderation from '../services/moderationService.js';

export const report = async (req, res) => res.status(201).json(await moderation.report(req.params.id, req.body, req.user || null));
export const list = async (req, res) => res.json(await moderation.list({ status: req.query.status, limit: req.query.limit }));
export const decide = async (req, res) => res.json(await moderation.decide(req.params.id, req.body, req.user));
