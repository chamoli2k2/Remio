import * as referrals from '../services/referralService.js';

export const mine = async (req, res) => res.json(await referrals.overview(req.user));
export const setCode = async (req, res) => res.json(await referrals.setCode(req.user, req.body.code));
export const redeem = async (req, res) => res.json(await referrals.redeem(req.user, req.body.code));
export const check = async (req, res) => res.json(await referrals.lookup(req.params.code));
