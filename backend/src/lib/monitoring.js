/**
 * Error monitoring (Sentry). Off unless SENTRY_DSN is set.
 *
 * Privacy: this app handles care-sector personal data (residents, DBS, right
 * to work, GPS). Reports therefore carry NO request bodies, headers, cookies or
 * query strings, and identify a user only by internal id + agency id — never
 * name, email, IP or location. Every event passes through scrub() before it
 * leaves the process.
 */
let Sentry = null;

function scrub(event) {
  if (event.request) {
    const { method, url } = event.request;
    // Keep only method + path (no query string, which may hold ids/filters).
    event.request = { method, url: url ? String(url).split('?')[0] : undefined };
  }
  if (event.user) event.user = event.user.id ? { id: event.user.id } : undefined;
  delete event.extra?.body;
  if (event.breadcrumbs) {
    // HTTP breadcrumbs can contain full URLs with query strings — drop their data.
    event.breadcrumbs = event.breadcrumbs.map((b) => ({ ...b, data: undefined }));
  }
  return event;
}

function initMonitoring() {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn || Sentry) return Boolean(Sentry);
  Sentry = require('@sentry/node');
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development',
    release: process.env.RAILWAY_GIT_COMMIT_SHA || undefined,
    sendDefaultPii: false,
    tracesSampleRate: 0, // errors only
    beforeSend: scrub,
    beforeBreadcrumb: (b) => ({ ...b, data: undefined }),
  });
  return true;
}

/** Report an error with optional non-personal context. No-op when disabled. */
function captureError(err, context = {}) {
  if (!Sentry) return;
  Sentry.withScope((scope) => {
    if (context.userId) scope.setUser({ id: context.userId });
    for (const key of ['agencyId', 'requestId', 'path', 'method', 'job', 'source']) {
      if (context[key]) scope.setTag(key, String(context[key]));
    }
    Sentry.captureException(err);
  });
}

async function flushMonitoring(timeoutMs = 2000) {
  if (Sentry) await Sentry.flush(timeoutMs).catch(() => {});
}

function monitoringEnabled() {
  return Boolean(Sentry);
}

module.exports = { initMonitoring, captureError, flushMonitoring, monitoringEnabled, scrub };
