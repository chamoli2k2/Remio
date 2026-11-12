import mongoose from 'mongoose';
import { options } from './_shared.js';
const { Schema, model } = mongoose;
// Durable domain events are the future integration boundary. No AI calls or indexing run in v1.
const event = new Schema({ type: String, aggregateId: String, payload: Schema.Types.Mixed, processedAt: Date }, options);
event.index({ processedAt: 1, createdAt: 1 });
export const DomainEvent = model('DomainEvent', event);
