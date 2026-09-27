import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDatabase } from './config/database.js';
import { createApp, trustedOrigins } from './app.js';
import { allModels } from './models/index.js';
import { attachRealtime } from './realtime/index.js';
import { installProcessHandlers } from './middleware/errorHandler.js';
import { logger } from './utils/logger.js';
import { configWarnings } from './services/payments/index.js';
import { BRAND } from '../../shared/brand.js';
await connectDatabase(); await Promise.all(allModels.map(m => m.init()));
for (const warning of configWarnings()) logger.warn(warning);
const port = process.env.PORT || 4000;
const server = createApp().listen(port, '0.0.0.0', () => logger.info(`${BRAND.name} API is ready.`, { port }));
const io = attachRealtime(server, trustedOrigins());
const shutdown = code => { io.close(); server.close(async () => { await mongoose.disconnect(); process.exit(code); }); setTimeout(() => process.exit(code), 8000).unref(); };
// An uncaught exception leaves the process in an unknown state, so drain connections and let the host restart us.
installProcessHandlers({ onFatal: () => shutdown(1) });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => shutdown(0));
