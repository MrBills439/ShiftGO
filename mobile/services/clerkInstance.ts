import { getClerkInstance } from '@clerk/clerk-expo';
import { tokenCache } from '../lib/tokenCache';

/**
 * Clerk-Expo keeps a single shared instance. This module is imported during app
 * startup (via services/api.ts and store/authStore.ts), so it can create that
 * instance BEFORE <ClerkProvider> mounts — which means the `tokenCache` MUST be
 * passed here too, otherwise Clerk falls back to a memory-only cache and never
 * persists the client, re-prompting for email verification on every sign-in.
 */
const publishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim();

// Release builds (EAS preview / production) must carry a publishable key, set via
// an EAS environment variable for the preview/production environment. Fail loudly
// at startup rather than mounting an app that can't authenticate.
if (!__DEV__ && process.env.NODE_ENV !== 'test' && !publishableKey) {
  throw new Error(
    '[Clerk] EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY is missing in this release build. ' +
      'Set it as an EAS environment variable for the preview/production environment ' +
      '(use the pk_live_ key for production).',
  );
}

export const clerkInstance = getClerkInstance({
  publishableKey: publishableKey!,
  tokenCache,
});
