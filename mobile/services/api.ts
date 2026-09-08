import axios, { AxiosError, AxiosRequestConfig } from 'axios';
import Constants from 'expo-constants';
import { clerkInstance } from './clerkInstance';

/**
 * API base URL.
 *
 * Release builds (EAS preview / production): EXPO_PUBLIC_API_URL MUST be provided
 * as an https:// URL — via `eas.json` (build.<profile>.env) or an EAS environment
 * variable. A release build with it missing/misconfigured throws immediately
 * rather than silently falling back to localhost and shipping a store build that
 * cannot reach the backend.
 *
 * Development: an explicit https:// URL still wins; otherwise the host is derived
 * from the Metro/Expo dev server that served this bundle (so a changing Mac LAN
 * IP needs no .env edit); otherwise the .env value; otherwise localhost.
 */
const isReleaseBuild = !__DEV__ && process.env.NODE_ENV !== 'test';

function resolveBaseUrl(): string {
  const explicit = process.env.EXPO_PUBLIC_API_URL?.trim();
  const isHttps = !!explicit && /^https:\/\//i.test(explicit);

  if (isReleaseBuild) {
    if (isHttps) return explicit as string;
    throw new Error(
      '[API] EXPO_PUBLIC_API_URL is missing or is not an https:// URL in this release build. ' +
        'Set it in mobile/eas.json (build.<profile>.env) or as an EAS environment variable ' +
        'for the preview/production environment.',
    );
  }

  // ── development / test below ──
  if (isHttps) return explicit as string;

  // e.g. "192.168.0.36:8082" or "192.168.0.36:8082/..." — take the host only.
  const hostUri =
    Constants.expoConfig?.hostUri ??
    (Constants as unknown as { expoGoConfig?: { debuggerHost?: string } }).expoGoConfig?.debuggerHost ??
    '';
  const host = hostUri.split('/')[0].split(':')[0];
  // Only reuse the Metro host when it's a LAN IPv4 literal. Under `--tunnel` the
  // Metro host is a public domain (e.g. *.exp.direct) that only forwards Metro,
  // not the API port — in that case fall through to the explicit URL.
  const isLanIpv4 = /^\d{1,3}(\.\d{1,3}){3}$/.test(host) && host !== '127.0.0.1';
  if (isLanIpv4) {
    return `http://${host}:4000`;
  }

  return explicit || 'http://localhost:4000';
}

const BASE_URL = resolveBaseUrl();
if (__DEV__) console.log('[API] base URL:', BASE_URL);

/** Resolved API origin — reuse this instead of re-reading EXPO_PUBLIC_API_URL,
 *  e.g. to build absolute URLs for server-served assets like /uploads/avatars. */
export const API_BASE_URL = BASE_URL;

export const api = axios.create({
  baseURL: BASE_URL,
  timeout: 15_000,
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use(async (config) => {
  try {
    const token = await clerkInstance.session?.getToken();
    if (token) config.headers.Authorization = `Bearer ${token}`;
  } catch (e) {
    console.warn('[API] could not read auth token:', (e as Error)?.message);
  }
  return config;
});

/** One automatic retry for transient network failures (bad signal in care homes). */
const RETRYABLE_METHODS = new Set(['get', 'head', 'options']);

api.interceptors.response.use(
  (r) => r,
  async (error: AxiosError) => {
    const config = error.config as (AxiosRequestConfig & { _retried?: boolean }) | undefined;

    // No response at all = network / timeout. Retry idempotent requests once.
    if (!error.response && config && !config._retried && RETRYABLE_METHODS.has((config.method ?? 'get').toLowerCase())) {
      config._retried = true;
      await new Promise((res) => setTimeout(res, 400));
      return api(config);
    }

    if (!error.response) {
      console.warn('[API] network error:', error.message, `(base: ${BASE_URL})`);
    } else if (error.response.status === 401) {
      // A 401 with no Clerk session means the session is genuinely gone — sign
      // out so the AuthGate routes back to login. If Clerk still has a session
      // it's an app-authorisation issue (handled by ClerkAuthSync); leave it.
      if (!clerkInstance.session) {
        clerkInstance.signOut().catch(() => {});
      }
    }

    return Promise.reject(error);
  }
);

/** Pull a human-readable message out of an axios error. */
export function apiErrorMessage(err: unknown, fallback = 'Something went wrong'): string {
  const e = err as AxiosError<{ message?: string; error?: { message?: string; fields?: Record<string, string> } }>;
  const fields = e?.response?.data?.error?.fields;
  if (fields && typeof fields === 'object') return Object.values(fields).join('. ');
  return (
    e?.response?.data?.message ??
    e?.response?.data?.error?.message ??
    (e?.message === 'Network Error' ? 'No connection. Check your internet and try again.' : undefined) ??
    fallback
  );
}

export default api;
