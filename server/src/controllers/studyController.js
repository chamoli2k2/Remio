import { reviewCard } from '../services/studyService.js';
import { studyStats } from '../services/statsService.js';
export const review = async (req, res) => res.json(await reviewCard(req.user, req.body));
export const stats = async (req, res) => res.json({ stats: await studyStats(req.user) });
