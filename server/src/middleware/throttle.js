import { rateLimit } from 'express-rate-limit';

/**
 * The one escape hatch, and it has to be honoured by every limiter rather than most of them.
 *
 * A test suite makes more requests in a minute than a person makes in an hour, so it switches the
 * limits off instead of tiptoeing under a budget — a suite that fails once it grows by two requests
 * is measuring the wrong thing. Refused outright when NODE_ENV is production, because an
 * environment variable should never be able to take a defence away from a live server.
 */
export const limitsOff = () => process.env.DISABLE_RATE_LIMIT === '1' && process.env.NODE_ENV !== 'production';

/**
 * A limiter that reads its ceiling when the request arrives rather than when it was constructed, so
 * a number changed in the dashboard applies to the next request instead of the next restart.
 *
 * Everything throttled in this app goes through here. The app-wide limiter used to be built from
 * the library directly and so quietly ignored the hatch above, which meant the limits were off
 * everywhere except the one place that covered every route.
 */
export const throttle = options => rateLimit({ standardHeaders: 'draft-8', legacyHeaders: false, ...options, skip: limitsOff });
