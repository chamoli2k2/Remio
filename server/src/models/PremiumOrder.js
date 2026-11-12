import { ORDER_KINDS, ORDER_METHODS, ORDER_STATUSES } from '../constants/index.js';
import mongoose from 'mongoose';
import { ref, options } from './_shared.js';
const { Schema, model } = mongoose;
// One order shape covers both products. `team` set means the payment buys seats rather than a
// personal subscription, so neither payment method needed new code to start selling teams.
const premiumOrder = new Schema({ user: ref('User'), plan: { type: String, required: true }, team: ref('Team', false), seats: { type: Number, default: 0 }, kind: { type: String, enum: ORDER_KINDS, default: 'personal' }, method: { type: String, enum: ORDER_METHODS, default: 'razorpay' }, amount: { type: Number, default: 0 }, currency: { type: String, default: 'INR' }, gatewayOrderId: { type: String }, gatewayPaymentId: { type: String }, name: { type: String, required: true }, email: { type: String, required: true }, phone: { type: String, required: true }, country: { type: String, required: true }, address: { type: String, required: true }, status: { type: String, enum: ORDER_STATUSES, default: 'pending' }, reviewedBy: ref('User', false) }, options);
premiumOrder.index({ user: 1, createdAt: -1 });
// Sparse and unique: a gateway payment can only ever be credited to one order, however many times
// its webhook fires. Both fields are deliberately left unset until the gateway supplies them, never
// defaulted to null, because sparse only skips an absent field — a field that is present and null
// is indexed like any other value, and every unpaid order would then be fighting for the same key.
premiumOrder.index({ gatewayOrderId: 1 }, { unique: true, sparse: true });
premiumOrder.index({ gatewayPaymentId: 1 }, { unique: true, sparse: true });
export const PremiumOrder = model('PremiumOrder', premiumOrder);
