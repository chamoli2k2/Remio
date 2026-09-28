import * as premium from '../services/premiumService.js';

export const start = async (req, res) => res.status(201).json(await premium.startCheckout(req.user, req.body));
export const confirm = async (req, res) => res.json(await premium.confirmCheckout(req.user, req.body));
export const cancel = async (req, res) => res.json(await premium.cancelOrder(req.user));
export const mine = async (req, res) => res.json(await premium.myOrder(req.user));
/** Mounted on the raw body, before the JSON parser, because the signature covers the exact bytes. */
export const webhook = async (req, res) => {
  const result = await premium.handleWebhook(req.body, req.get('x-razorpay-signature'));
  res.json({ ok: true, ...result });
};
