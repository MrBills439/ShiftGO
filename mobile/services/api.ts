import axios, { AxiosError, AxiosRequestConfig } from 'axios';
import { authClient } from './authClient';

export { API_BASE_URL } from './baseUrl';
import { API_BASE_URL as BASE_URL } from './baseUrl';

export const api = axios.create({
  baseURL: BASE_URL,
  timeout: 15_000,
  headers: { 'Content-Type': 'application/json' },
});

// The session cookie lives in SecureStore (Better Auth's Expo client); send it
// with every API call. Cookies are never read from the native cookie jar.
api.interceptors.request.use(async (config) => {
  try {
    const cookie = await authClient.getCookie();
    if (cookie) config.headers.Cookie = cookie;
  } catch (e) {
    console.warn('[API] could not read session:', (e as Error)?.message);
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
      // The session expired, was revoked (password reset, deactivation) or is
      // missing: clear it so the AuthGate routes back to login.
      authClient.signOut().catch(() => {});
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
