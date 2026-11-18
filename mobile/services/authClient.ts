/**
 * Better Auth client for the app. The session cookie is kept in the encrypted
 * SecureStore (Keychain / Keystore), not in a cookie jar or AsyncStorage.
 */
import { createAuthClient } from 'better-auth/react';
import { twoFactorClient, emailOTPClient } from 'better-auth/client/plugins';
import { expoClient } from '@better-auth/expo/client';
import * as SecureStore from 'expo-secure-store';
import { API_BASE_URL } from './baseUrl';

// Readable after the first unlock following a reboot, so the background
// attendance task can still call the API while the phone is locked.
const keychain: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK };
const storage = {
  getItem: (key: string) => SecureStore.getItem(key, keychain),
  getItemAsync: (key: string) => SecureStore.getItemAsync(key, keychain),
  setItem: (key: string, value: string) => SecureStore.setItem(key, value, keychain),
  setItemAsync: (key: string, value: string) => SecureStore.setItemAsync(key, value, keychain),
};

export const authClient = createAuthClient({
  baseURL: `${API_BASE_URL}/auth`,
  plugins: [
    expoClient({
      scheme: 'shiftgo',
      storagePrefix: 'shiftgo',
      cookiePrefix: 'shiftgo',
      storage,
    }),
    twoFactorClient(),
    emailOTPClient(),
  ],
});

/** Better Auth returns { data, error }; turn an error into a readable sentence. */
export function authErrorMessage(
  error: { message?: string; status?: number; code?: string } | null | undefined,
  fallback: string,
): string {
  if (!error) return fallback;
  if (error.status === 429) return 'Too many attempts. Wait a minute and try again.';
  if (error.code === 'INVALID_EMAIL_OR_PASSWORD' || error.status === 401) return 'That email and password do not match.';
  return error.message || fallback;
}
