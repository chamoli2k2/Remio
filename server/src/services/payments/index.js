import * as razorpay from './razorpay.js';
import { badRequest } from '../../utils/errors.js';

/**
 * Payment methods are described in one place and advertised to the client at runtime, so switching
 * the product off the manual flow is an environment change (MANUAL_PAYMENT=off) rather than a deploy
 * of new UI. A method only appears if it is actually usable on this server.
 */
// Retired now that the gateway is live. The code stays because old orders still carry a screenshot
// an admin may need to open, and MANUAL_PAYMENT=on brings it back without a deploy.
const manualEnabled = () => (process.env.MANUAL_PAYMENT || 'off').toLowerCase() !== 'off';

export const METHODS = [
  {
    id: 'razorpay',
    label: 'Pay online',
    // Product-neutral, because this same picker sells a personal plan and a pack of team seats.
    blurb: 'UPI, card, net banking, or wallet. It turns on the moment the payment clears.',
    instant: true,
    requiresProof: false,
    isConfigured: razorpay.isConfigured,
  },
  {
    id: 'manual',
    label: 'Pay by UPI transfer',
    blurb: 'Send the amount to our UPI ID and upload the screenshot. An admin confirms it, usually within a day.',
    instant: false,
    requiresProof: true,
    isConfigured: manualEnabled,
  },
];

const present = m => ({ id: m.id, label: m.label, blurb: m.blurb, instant: m.instant, requiresProof: m.requiresProof });
export const availableMethods = () => METHODS.filter(m => m.isConfigured()).map(present);
export const methodById = id => METHODS.find(m => m.id === id) || null;

export function requireMethod(id) {
  const method = methodById(id);
  if (!method) throw badRequest('Choose how you want to pay.', 'UNKNOWN_METHOD');
  if (!method.isConfigured()) throw badRequest('That payment method is not available right now.', 'METHOD_UNAVAILABLE');
  return method;
}

export { razorpay };
