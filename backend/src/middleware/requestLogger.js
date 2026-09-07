const { randomUUID } = require('crypto');
const logger = require('../lib/logger');
const metrics = require('../lib/metrics');

const SLOW_REQUEST_MS = Number(process.env.SLOW_REQUEST_MS) || 1000;

/**
 * Per-request structured logging + timing. Assigns a correlation id (honouring
 * an inbound x-request-id), records duration, and emits ONE JSON line when the
 * response finishes. Requests at/over SLOW_REQUEST_MS are logged at warn with
 * `slow: true` and counted in metrics.
 *
 * Deliberately logs only method, route path (no query string), status, duration,
 * and the authenticated userId/agencyId when present — never headers, bodies,
 * tokens, or query params, so secrets cannot leak into logs.
 */
function requestLogger(req, res, next) {
  const requestId = req.get('x-request-id') || randomUUID();
  req.requestId = requestId;
  res.setHeader('x-request-id', requestId);

  const start = process.hrtime.bigint();

  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
    const rounded = Math.round(durationMs);
    // req.route is set once a route matched; fall back to the raw path (still no query).
    const routePath = req.baseUrl ? `${req.baseUrl}${req.route ? req.route.path : ''}` : req.path;
    const slow = durationMs >= SLOW_REQUEST_MS;

    metrics.recordRequest({ durationMs, status: res.statusCode });
    if (slow) metrics.recordSlowRequest();

    const entry = {
      requestId,
      method: req.method,
      path: routePath || req.path,
      status: res.statusCode,
      durationMs: rounded,
      userId: req.user?.id,
      agencyId: req.user?.agencyId,
    };

    if (res.statusCode >= 500) logger.error('request.error', entry);
    else if (slow) logger.warn('request.slow', { ...entry, slow: true, thresholdMs: SLOW_REQUEST_MS });
    else logger.info('request', entry);
  });

  next();
}

module.exports = { requestLogger, SLOW_REQUEST_MS };
