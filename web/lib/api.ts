import axios from 'axios';

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

/** API origin — prefix for server-served assets like `/uploads/avatars/...`. */
export const API_BASE = BASE;

export const api = axios.create({ baseURL: BASE, timeout: 12000 });

// On a fresh page load, requests can fire (React Query mounts several at once)
// before Clerk has finished initializing `window.Clerk`. Sending those without
// a token guarantees a 401 from the backend, which used to hard-reload the
// page — on a slow compile that reload could itself race Clerk again, causing
// the page to bounce/reload repeatedly. Wait briefly for Clerk to be ready
// before grabbing the token so those early requests carry real auth.
async function waitForClerkSession(timeoutMs = 4000) {
  const start = Date.now();
  while (!window.Clerk?.session && Date.now() - start < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return window.Clerk?.session;
}

api.interceptors.request.use(async (config) => {
  const session = await waitForClerkSession();
  try {
    const token = await session?.getToken();
    if (token) config.headers.Authorization = `Bearer ${token}`;
  } catch {
    // Clerk's silent token refresh can momentarily reject mid-cycle — fall through
    // and let the request go out as-is rather than throwing out of the interceptor.
  }
  return config;
});

api.interceptors.response.use(
  (r) => r,
  async (error) => {
    if (error.response?.status === 401 && typeof window !== 'undefined') {
      const alreadyOnSignIn = window.location.pathname.startsWith('/sign-in');
      const hasClerkSession = Boolean(window.Clerk?.session);
      // Only a *missing* Clerk session means "go sign in". A 401 while Clerk
      // still holds a valid session is an app-level authorization failure — no
      // backend user row yet, or a deactivated account — and redirecting to
      // /sign-in just bounces straight back to /dashboard and spins forever.
      // Let ClerkAuthSync surface that state as an error instead.
      if (!hasClerkSession && !alreadyOnSignIn) {
        window.location.href = '/sign-in';
      }
    }
    return Promise.reject(error);
  }
);
