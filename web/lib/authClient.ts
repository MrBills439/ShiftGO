'use client';
/**
 * Better Auth client. Requests go to /api/auth/* on this origin, which
 * next.config.mjs proxies to the LeafRota API's /auth/* routes.
 */
import { createAuthClient } from 'better-auth/react';
import { twoFactorClient, emailOTPClient } from 'better-auth/client/plugins';

export const authClient = createAuthClient({
  baseURL: typeof window === 'undefined' ? 'http://localhost/api/auth' : `${window.location.origin}/api/auth`,
  plugins: [twoFactorClient(), emailOTPClient()],
});

/** Better Auth returns { data, error }; turn an error into a readable sentence. */
export function authErrorMessage(error: { message?: string; status?: number; code?: string } | null | undefined, fallback: string) {
  if (!error) return fallback;
  if (error.status === 429) return 'Too many attempts. Wait a minute and try again.';
  if (error.code === 'INVALID_EMAIL_OR_PASSWORD' || error.status === 401) return 'That email and password do not match.';
  return error.message || fallback;
}
