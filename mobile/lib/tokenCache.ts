import * as SecureStore from 'expo-secure-store';
import { captureMessage } from './monitoring';

/**
 * Persistent, encrypted token cache for Clerk. This MUST be passed to BOTH
 * `getClerkInstance()` (services/clerkInstance.ts) and `<ClerkProvider>`
 * (app/_layout.tsx) — Clerk-Expo shares one singleton and only the first
 * caller's options take effect. Without it Clerk falls back to an in-memory
 * cache, the client identity is never persisted, and every sign-in after a
 * sign-out is treated as a new/unrecognised device (forcing an email code).
 */
const options: SecureStore.SecureStoreOptions = {
  // Readable after the first unlock following a reboot — needed so the session
  // survives the app being backgrounded / the phone being locked.
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
};

export const tokenCache = {
  async getToken(key: string): Promise<string | null> {
    try {
      return await SecureStore.getItemAsync(key, options);
    } catch (e) {
      captureMessage('SecureStore.getItemAsync failed', { key, error: String(e) });
      try {
        await SecureStore.deleteItemAsync(key, options);
      } catch {
        /* ignore */
      }
      return null;
    }
  },
  async saveToken(key: string, value: string): Promise<void> {
    try {
      await SecureStore.setItemAsync(key, value, options);
    } catch (e) {
      captureMessage('SecureStore.setItemAsync failed', { key, error: String(e) });
    }
  },
};
