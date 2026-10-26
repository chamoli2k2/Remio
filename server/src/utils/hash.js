import crypto from 'node:crypto';

/** Bearer credentials are stored only as this digest, so a database leak hands nobody a usable token. */
export const hashToken = token => crypto.createHash('sha256').update(token).digest('hex');
