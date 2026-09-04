/**
 * Crash / error reporting.
 *
 * If `EXPO_PUBLIC_SENTRY_DSN` is set AND `@sentry/react-native` is installed,
 * errors are sent to Sentry. Otherwise this degrades to console logging so the
 * rest of the app can call `captureError` unconditionally.
 *
 * To enable Sentry:
 *   1. npx expo install @sentry/react-native
 *   2. add the config plugin to app.json  ("@sentry/react-native/expo")
 *   3. set EXPO_PUBLIC_SENTRY_DSN in .env  (and SENTRY_AUTH_TOKEN for source maps)
 *   4. rebuild the dev client
 */

const DSN = process.env.EXPO_PUBLIC_SENTRY_DSN?.trim();

type SentryLike = {
  init: (opts: Record<string, unknown>) => void;
  captureException: (e: unknown, ctx?: unknown) => void;
  captureMessage: (m: string, ctx?: unknown) => void;
  setUser: (u: { id?: string; email?: string } | null) => void;
};

let sentry: SentryLike | null = null;

if (DSN) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    sentry = require('@sentry/react-native') as SentryLike;
    sentry.init({
      dsn: DSN,
      enableAutoSessionTracking: true,
      tracesSampleRate: 0.1,
    });
  } catch {
    console.warn('[monitoring] EXPO_PUBLIC_SENTRY_DSN is set but @sentry/react-native is not installed.');
    sentry = null;
  }
}

export const monitoringEnabled = Boolean(sentry);

export function captureError(error: unknown, context?: Record<string, unknown>) {
  if (sentry) {
    sentry.captureException(error, context ? { extra: context } : undefined);
  } else if (__DEV__) {
    console.error('[captureError]', error, context ?? '');
  }
}

export function captureMessage(message: string, context?: Record<string, unknown>) {
  if (sentry) sentry.captureMessage(message, context ? { extra: context } : undefined);
  else if (__DEV__) console.warn('[captureMessage]', message, context ?? '');
}

export function identifyUser(user: { id?: string; email?: string } | null) {
  sentry?.setUser(user);
}
