'use client';
import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/authStore';

const RETRY_DELAYS_MS = [1000, 2000, 4000];
const PUBLIC_PATHS = ['/sign-in', '/forgot-password', '/accept-invite'];

/**
 * Loads the signed-in person's LeafRota profile (/users/me). The session itself
 * is an HttpOnly cookie the browser sends automatically.
 *   401            -> signedOut (layouts send them to /sign-in)
 *   network/5xx    -> retried, then `profile_sync_failed` (real error screen)
 */
export function AuthSync() {
  const syncNonce = useAuthStore((s) => s.syncNonce);
  const pathname = usePathname();
  const isPublic = PUBLIC_PATHS.some((p) => pathname?.startsWith(p));

  useEffect(() => {
    if (isPublic) {
      useAuthStore.setState({ isLoading: false });
      return;
    }
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    function fetchMe(attempt: number) {
      api.get('/users/me').then(
        ({ data }) => {
          if (!cancelled) useAuthStore.setState({ user: data.data, isLoading: false, signedOut: false, error: null });
        },
        (err) => {
          if (cancelled) return;
          if (err?.response?.status === 401) {
            useAuthStore.setState({ user: null, isLoading: false, signedOut: true, error: null });
          } else if (attempt < RETRY_DELAYS_MS.length) {
            retryTimer = setTimeout(() => fetchMe(attempt + 1), RETRY_DELAYS_MS[attempt]);
          } else {
            useAuthStore.setState({ user: null, isLoading: false, error: 'profile_sync_failed' });
          }
        },
      );
    }

    useAuthStore.setState({ isLoading: true, error: null });
    fetchMe(0);
    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [syncNonce, isPublic]);

  return null;
}
