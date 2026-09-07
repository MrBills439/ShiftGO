/**
 * Lightweight in-process operational counters. No external system, no
 * Prometheus — just enough to answer "is the service healthy and fast right
 * now" from GET /metrics during a production incident. Resets on restart.
 */
const counters = {
  requests: 0,
  errors: 0, // responses with status >= 500
  slowRequests: 0, // durationMs >= SLOW_REQUEST_MS
  dbQueries: 0,
  dbSlowQueries: 0,
};

let durationSumMs = 0;
let durationMaxMs = 0;
const startedAt = Date.now();

function recordRequest({ durationMs, status }) {
  counters.requests += 1;
  if (status >= 500) counters.errors += 1;
  durationSumMs += durationMs;
  if (durationMs > durationMaxMs) durationMaxMs = durationMs;
}

function recordSlowRequest() {
  counters.slowRequests += 1;
}

function recordDbQuery(slow) {
  counters.dbQueries += 1;
  if (slow) counters.dbSlowQueries += 1;
}

function snapshot() {
  return {
    ...counters,
    avgRequestMs: counters.requests ? Math.round(durationSumMs / counters.requests) : 0,
    maxRequestMs: Math.round(durationMaxMs),
    uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
  };
}

module.exports = { recordRequest, recordSlowRequest, recordDbQuery, snapshot };
