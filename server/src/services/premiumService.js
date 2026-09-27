import { PremiumOrder, User, Team } from '../models/index.js';
import { hasPremium, hasDashboard, planById, premiumDaysLeft, premiumExpiryAfter } from '../../../shared/account.js';
import { teamPlanById, teamPrice, seatTopUpPrice, teamActive, teamExpiryAfter, clampSeats } from '../../../shared/teams.js';
import { accessTeam } from './teamAccess.js';
import { notify, notifyStaff } from './notificationService.js';
import { availableMethods, requireMethod, razorpay } from './payments/index.js';
import { logger } from '../utils/logger.js';
import { assert, badRequest, notFound } from '../utils/errors.js';
import { publicOrigin } from '../utils/origin.js';
import { BRAND } from '../../../shared/brand.js';

const presentOrder = order => ({
  id: order.id, plan: order.plan, method: order.method, status: order.status,
  amount: order.amount, currency: order.currency, createdAt: order.createdAt,
  kind: order.kind || 'personal', team: order.team ? String(order.team) : null, seats: order.seats || 0,
  hasProof: !!order.proofType && order.method === 'manual',
});

/**
 * Prices a team purchase from the team's own state rather than from anything the client sends: a
 * first purchase pays for every seat, a renewal extends the current seat count, and extra seats
 * mid-term are prorated against the days actually left.
 */
async function quoteTeam(user, body) {
  const { team } = await accessTeam(body.teamId, user, 'owner');
  const plan = teamPlanById(body.plan);
  assert(plan, 400, 'Choose a team plan.', 'UNKNOWN_PLAN');
  const wanted = clampSeats(body.seats);
  if (!teamActive(team)) return { team, plan, seats: wanted, kind: 'team-new', rupees: teamPrice(plan, wanted) };
  if (wanted > team.seats) return { team, plan, seats: wanted, kind: 'team-seats', rupees: seatTopUpPrice(plan, wanted - team.seats, team.expiresAt) };
  return { team, plan, seats: team.seats, kind: 'team-renew', rupees: teamPrice(plan, team.seats) };
}

/** A quote the owner can see before committing to it, so the proration is never a surprise. */
export async function quote(user, body) {
  const { team, plan, seats, kind, rupees } = await quoteTeam(user, body);
  return { kind, seats, plan: plan.id, planLabel: plan.label, perSeat: plan.perSeat, amount: rupees, currency: 'INR', seatsNow: team.seats, expiresAt: team.expiresAt || null };
}

/** Seats are applied to the team; a top-up adds chairs without moving the renewal date. */
async function applyToTeam(order) {
  const team = await Team.findById(order.team);
  if (!team) return null;
  if (order.kind === 'team-seats') team.seats = Math.max(team.seats, order.seats);
  else { team.seats = order.seats; team.plan = order.plan; team.expiresAt = teamExpiryAfter(team, teamPlanById(order.plan)); }
  await team.save();
  return team;
}

export const mySubscription = user => ({
  account: user.account || 'normal',
  plan: user.premiumPlan || '',
  planLabel: planById(user.premiumPlan)?.label || '',
  expiresAt: user.premiumExpiresAt || null,
  daysLeft: premiumDaysLeft(user),
  active: hasPremium(user),
});

/**
 * The single place a paid plan is applied, whichever way it was paid for. The status change is a
 * conditional update, so a gateway webhook racing the browser callback, or the same
 * webhook delivered twice, can only ever grant the plan once.
 */
export async function fulfilOrder(orderId, status, { actor = null, paymentId = null } = {}) {
  const update = { status, ...(actor ? { reviewedBy: actor.id } : {}), ...(paymentId ? { gatewayPaymentId: paymentId } : {}) };
  const order = await PremiumOrder.findOneAndUpdate({ _id: orderId, status: 'pending' }, { $set: update }, { new: true });
  if (!order) return { order: null, alreadySettled: true };

  let expiresAt = null;
  if (status === 'approved' && order.team) {
    const team = await applyToTeam(order);
    expiresAt = team?.expiresAt || null;
  } else if (status === 'approved') {
    const user = await User.findById(order.user);
    if (user) {
      expiresAt = premiumExpiryAfter(user, planById(order.plan));
      if ((user.account || 'normal') === 'normal') user.account = 'premium';
      user.premiumPlan = order.plan;
      user.premiumExpiresAt = expiresAt;
      await user.save();
    }
  }
  const type = order.team
    ? (status === 'approved' ? 'team.seats' : 'premium.declined')
    : (status === 'approved' ? 'premium.approved' : 'premium.declined');
  await notify(order.user, type, { actor, data: { plan: order.plan, expiresAt, seats: order.seats || undefined } });
  logger.info(`premium order ${status}`, { orderId: order.id, plan: order.plan, method: order.method, kind: order.kind });
  return { order, alreadySettled: false };
}

// Pending orders are scoped per product, so buying seats for a class does not block a personal
// upgrade and vice versa.
const openOrderFor = (user, teamId = null) => PremiumOrder.findOne({ user: user.id, status: 'pending', team: teamId });

async function newOrder(user, body, method, { proof = null } = {}) {
  const team = body.teamId ? await quoteTeam(user, body) : null;
  if (!team) {
    assert(!hasPremium(user), 400, 'You already have Premium.', 'ALREADY_PREMIUM');
    assert(planById(body.plan), 400, 'Choose a Premium plan.', 'UNKNOWN_PLAN');
  }
  const open = await openOrderFor(user, team ? team.team.id : null);
  assert(!open, 400, 'You already have a payment in progress. Finish or cancel it first.', 'ORDER_IN_PROGRESS');
  const money = team ? { plan: team.plan.id, amount: team.rupees * 100, team: team.team.id, seats: team.seats, kind: team.kind }
    : { plan: planById(body.plan).id, amount: planById(body.plan).price * 100, kind: 'personal' };
  // The receipt goes to the confirmed address on the account, never to one typed at checkout, so a
  // slip of the keyboard cannot send somebody's invoice to a stranger.
  const { email } = await User.findById(user.id).select('+email');
  return PremiumOrder.create({
    user: user.id, method, currency: 'INR', ...money,
    name: body.name, email, phone: body.phone, country: body.country, address: body.address,
    ...(proof ? { proof, proofType: 'image/webp' } : {}),
    status: 'pending',
  });
}

const describe = order => order.team
  ? `${order.seats} seat${order.seats === 1 ? '' : 's'} · ${teamPlanById(order.plan)?.label || 'Team'}`
  : `${planById(order.plan)?.label || 'Premium'} plan`;

/** Manual flow: the buyer proves they paid, an admin confirms it later. */
export async function submitOrder(user, body, proof) {
  requireMethod('manual');
  assert(proof?.length, 400, 'Upload a screenshot of the payment.', 'PROOF_REQUIRED');
  const order = await newOrder(user, body, 'manual', { proof });
  await notifyStaff('premium.requested', { actor: user, data: { orderId: order.id, plan: order.plan } });
  return presentOrder(order);
}

/** Gateway flow, step one: reserve an order with Razorpay and hand the client what checkout needs. */
export async function startCheckout(user, body) {
  requireMethod('razorpay');
  const order = await newOrder(user, body, 'razorpay');
  try {
    const gateway = await razorpay.createOrder({ amount: order.amount, currency: order.currency, receipt: order.id, notes: { plan: order.plan, username: user.username } });
    order.gatewayOrderId = gateway.id;
    await order.save();
    return {
      order: presentOrder(order),
      checkout: {
        key: razorpay.keyId(), orderId: gateway.id, amount: gateway.amount, currency: gateway.currency,
        name: BRAND.name, description: describe(order),
        // The gateway loads this from its own page, so it has to be absolute rather than a path.
        image: `${publicOrigin()}/checkout-logo.png`,
        prefill: { name: order.name, email: order.email, contact: order.phone },
      },
    };
  } catch (e) {
    // Never strand a pending order the buyer cannot retry past.
    await PremiumOrder.deleteOne({ _id: order.id, status: 'pending' });
    throw e;
  }
}

/** Gateway flow, step two: the browser came back. Verify the signature before believing any of it. */
export async function confirmCheckout(user, { orderId, paymentId, signature }) {
  const order = await PremiumOrder.findOne({ gatewayOrderId: orderId, user: user.id });
  if (!order) throw notFound('That payment does not match an order.', 'NO_ORDER');
  if (!razorpay.checkoutSignatureValid({ orderId, paymentId, signature })) {
    logger.warn('rejected a razorpay callback with a bad signature', { orderId, userId: user.id });
    throw badRequest('We could not verify that payment. Nothing has been charged twice, but do contact us if money left your account.', 'BAD_SIGNATURE');
  }
  if (order.status === 'approved') return { order: presentOrder(order), subscription: mySubscription(await User.findById(user.id)) };
  await fulfilOrder(order.id, 'approved', { paymentId });
  return { order: presentOrder(await PremiumOrder.findById(order.id)), subscription: mySubscription(await User.findById(user.id)) };
}

/**
 * The authoritative path. If the buyer closes the tab after paying, the browser callback never
 * arrives but this still does, so the plan is granted either way.
 */
export async function handleWebhook(rawBody, signature) {
  if (!razorpay.webhookSignatureValid(rawBody, signature)) {
    logger.warn('rejected a razorpay webhook with a bad signature');
    throw badRequest('Invalid webhook signature.', 'BAD_SIGNATURE');
  }
  const { event, orderId, paymentId, status } = razorpay.readWebhook(rawBody);
  if (!orderId) return { ignored: event || 'unknown' };
  const order = await PremiumOrder.findOne({ gatewayOrderId: orderId });
  if (!order) return { ignored: 'unknown-order' };
  if (event === 'payment.captured' || status === 'captured') {
    const { alreadySettled } = await fulfilOrder(order.id, 'approved', { paymentId });
    return { handled: 'approved', alreadySettled };
  }
  if (event === 'payment.failed') {
    await fulfilOrder(order.id, 'declined', { paymentId });
    return { handled: 'declined' };
  }
  return { ignored: event };
}

export async function cancelOrder(user, teamId = null) {
  const order = await openOrderFor(user, teamId || null);
  if (!order) return { cancelled: false };
  await PremiumOrder.deleteOne({ _id: order.id, status: 'pending' });
  return { cancelled: true };
}

export async function myOrder(user, teamId = null) {
  const order = await PremiumOrder.findOne({ user: user.id, team: teamId || null }).sort({ createdAt: -1 });
  return { order: order ? presentOrder(order) : null, subscription: mySubscription(user), methods: availableMethods() };
}

export async function proofFor(viewer, orderId) {
  const order = await PremiumOrder.findById(orderId).select('+proof');
  assert(order, 404, 'Request not found.');
  const owner = String(order.user) === String(viewer.id);
  assert(owner || hasDashboard(viewer), 404, 'Request not found.');
  assert(order.proof, 404, 'No payment photo on this request.');
  return { data: order.proof, type: order.proofType || 'image/webp' };
}
