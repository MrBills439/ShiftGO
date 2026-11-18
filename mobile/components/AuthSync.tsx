import { useEffect } from 'react';
import { authClient } from '../services/authClient';
import { api } from '../services/api';
import { useAuthStore } from '../store/authStore';

const RETRY_DELAYS_MS = [1000, 2000, 4000];

/** Loads the ShiftGO profile (/users/me) whenever there is a Better Auth session. */
export function AuthSync() {
  const { data: session, isPending } = authClient.useSession();
  const signedIn = !!session?.session;
  const sessionId = session?.session?.id;
  const syncNonce = useAuthStore((s) => s.syncNonce);

  useEffect(() => {
    if (isPending) return;

    if (!signedIn) {
      useAuthStore.setState({ user: null, isLoading: false, error: null });
      return;
    }

    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    // Retry transient failures (backend restart, flaky connection) before
    // showing the "couldn't load your account" screen.
    function fetchMe(attempt: number) {
      api.get('/users/me').then(
        ({ data }) => {
          if (!cancelled) useAuthStore.setState({ user: data.data, isLoading: false, error: null });
        },
        (err) => {
          if (cancelled) return;
          if (err?.response?.status === 401) return; // api.ts signs out; the session hook updates
          if (attempt < RETRY_DELAYS_MS.length) {
            retryTimer = setTimeout(() => fetchMe(attempt + 1), RETRY_DELAYS_MS[attempt]);
          } else {
            useAuthStore.setState({ user: null, isLoading: false, error: 'profile_sync_failed' });
          }
        }
      );
    }

    useAuthStore.setState({ isLoading: true, error: null });
    fetchMe(0);
    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [isPending, signedIn, sessionId, syncNonce]);

  return null;
}
