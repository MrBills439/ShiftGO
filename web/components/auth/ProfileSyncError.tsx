'use client';
import { Button } from '@/components/ui/Button';
import { useAuthStore } from '@/store/authStore';

/**
 * Shown when Clerk has a valid session but we could not load the matching
 * ShiftGO profile from the backend (no user row yet, deactivated account, or
 * the API is down). Replaces the old behaviour of spinning forever / bouncing
 * between /dashboard and /sign-in.
 */
export function ProfileSyncError() {
  const retrySync = useAuthStore((s) => s.retrySync);
  const logout = useAuthStore((s) => s.logout);

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface px-6">
      <div className="w-full max-w-md rounded-lg border border-border bg-surface-raised p-8 text-center">
        <h1 className="text-lg font-semibold text-fg">We couldn&apos;t load your account</h1>
        <p className="mt-2 text-sm text-fg-muted">
          You&apos;re signed in, but we couldn&apos;t reach your ShiftGO profile. This usually
          means your account hasn&apos;t finished being set up, or the server is briefly
          unavailable. Try again in a moment — if it keeps happening, contact your
          administrator.
        </p>
        <div className="mt-6 flex justify-center gap-3">
          <Button variant="primary" onClick={retrySync}>Try again</Button>
          <Button variant="secondary" onClick={logout}>Sign out</Button>
        </div>
      </div>
    </div>
  );
}
