#!/usr/bin/env node
// Boots a throwaway MongoDB replica set and the API serving the built client, for Playwright.
// Every run starts from an empty database. Used by playwright.config.js as the webServer command.
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { spawn } from 'node:child_process';
import { BRAND } from '../shared/brand.js';
const port = process.env.E2E_PORT || 4100;
const mongo = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
const env = { ...process.env, PORT: String(port), MONGODB_URI: mongo.getUri(`${BRAND.slug}_e2e`), CLIENT_ORIGIN: `http://localhost:${port},http://127.0.0.1:${port}`, NODE_ENV: 'test', EMAIL_CODES: 'off' };
const api = spawn(process.execPath, ['server/src/index.js'], { env, stdio: 'inherit' });
const shutdown = async () => { api.kill('SIGTERM'); await mongo.stop(); process.exit(0); };
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown); api.on('exit', code => { mongo.stop().finally(() => process.exit(code ?? 0)); });
