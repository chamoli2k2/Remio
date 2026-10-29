import { reviewCard, reviewCards } from '../services/studyService.js';
import { studyStats } from '../services/statsService.js';
export const review = async (req, res) => res.json(await reviewCard(req.user, req.body));
export const reviewBatch = async (req, res) => res.json({ results: await reviewCards(req.user, req.body.reviews) });
export const stats = async (req, res) => res.json({ stats: await studyStats(req.user) });
