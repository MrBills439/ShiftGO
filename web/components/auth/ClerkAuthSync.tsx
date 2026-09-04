'use client';
import { useEffect } from 'react';
import { useAuth } from '@clerk/nextjs';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/authStore';

const RETRY_DELAYS_MS = [1000, 2000, 4000];

export function ClerkAuthSync() {
  const { isLoaded, isSignedIn } = useAuth();
  const syncNonce = useAuthStore((s) => s.syncNonce);

  useEffect(() => {
    if (!isLoaded) return;

    if (!isSignedIn) {
      useAuthStore.setState({ user: null, isLoading: false, error: null });
      return;
    }

    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    // Keep `isLoading: true` across retries — a transient failure (backend
    // restart, network blip) should show the loading spinner and self-heal.
    // Only once every retry is exhausted do we surface `error` so the layout
    // can render a real "couldn't load your account" screen instead of an
    // infinite spinner.
    function fetchMe(attempt: number) {
      api.get('/users/me').then(
        ({ data }) => {
          if (!cancelled) useAuthStore.setState({ user: data.data, isLoading: false, error: null });
        },
        () => {
          if (cancelled) return;
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
  }, [isLoaded, isSignedIn, syncNonce]);

  return null;
}
