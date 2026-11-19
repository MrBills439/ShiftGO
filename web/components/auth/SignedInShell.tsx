'use client';
/**
 * Everything a signed-in page needs before it renders:
 *   no session            -> /sign-in?next=...
 *   profile failed to load -> ProfileSyncError
 *   HR/manager without 2FA -> two-step set-up screen
 *   wrong role             -> /dashboard
 * then the privacy notice gate, skip link, sidebar and <main>.
 */
import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Sidebar } from '@/components/layout/Sidebar';
import { ProfileSyncError } from '@/components/auth/ProfileSyncError';
import { TwoFactorSetup } from '@/components/auth/TwoFactorSetup';
import { AuthCard } from '@/components/auth/AuthCard';
import { Button } from '@/components/ui/Button';
import { useAuthStore } from '@/store/authStore';
import { PrivacyNoticeGate } from '@/components/privacy/PrivacyNoticeGate';
import type { Role } from '@/types';

function Spinner() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-surface" role="status" aria-label="Loading">
      <div className="w-8 h-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
    </div>
  );
}

export function SignedInShell({
  children, allowedRoles, extras,
}: { children: React.ReactNode; allowedRoles?: Role[]; extras?: React.ReactNode }) {
  const { user, isLoading, error, signedOut, retrySync, logout } = useAuthStore();
  const router = useRouter();
  const pathname = usePathname();
  const roleDenied = !!user && !!allowedRoles && !allowedRoles.includes(user.role);

  useEffect(() => {
    if (signedOut) router.replace(`/sign-in?next=${encodeURIComponent(pathname)}`);
  }, [signedOut, pathname, router]);

  useEffect(() => {
    if (roleDenied) router.replace('/dashboard');
  }, [roleDenied, router]);

  if (signedOut) return null;
  if (!isLoading && (error || !user)) return <ProfileSyncError />;
  if (isLoading || !user || roleDenied) return <Spinner />;

  if (user.twoFactorRequired) {
    return (
      <AuthCard
        title="Turn on two-step verification"
        subtitle="Because you can see staff records, your account needs a code from your phone as well as your password."
      >
        <TwoFactorSetup onDone={retrySync} />
        <div className="mt-6 border-t border-border pt-4 text-center">
          <Button variant="ghost" size="sm" onClick={logout}>Sign out</Button>
        </div>
      </AuthCard>
    );
  }

  return (
    <PrivacyNoticeGate>
      <div className="flex min-h-screen flex-col bg-surface lg:flex-row">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[200] focus:rounded-md focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-brand-700 focus:shadow-lg"
        >
          Skip to main content
        </a>
        <Sidebar />
        <main id="main-content" tabIndex={-1} className="flex-1 overflow-y-auto focus:outline-none">
          <div className="p-4 sm:p-6 lg:p-8">{children}</div>
        </main>
        {extras}
      </div>
    </PrivacyNoticeGate>
  );
}
