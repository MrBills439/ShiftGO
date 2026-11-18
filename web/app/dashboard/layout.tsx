'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@clerk/nextjs';
import { Sidebar } from '@/components/layout/Sidebar';
import { CommandPalette } from '@/components/operations/CommandPalette';
import { AnnouncementsPopup } from '@/components/announcements/AnnouncementsPopup';
import { ProfileSyncError } from '@/components/auth/ProfileSyncError';
import { useAuthStore } from '@/store/authStore';
import { PrivacyNoticeGate } from '@/components/privacy/PrivacyNoticeGate';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, isLoading, error } = useAuthStore();
  const { isLoaded: clerkLoaded, isSignedIn } = useAuth();
  const router = useRouter();

  // Only bounce to /sign-in once Clerk itself confirms there's no session — not
  // merely because our own `/users/me` sync hasn't resolved yet (or hiccuped).
  const definitelySignedOut = clerkLoaded && !isSignedIn;

  useEffect(() => {
    if (definitelySignedOut) router.replace('/sign-in');
  }, [definitelySignedOut]);

  if (definitelySignedOut) return null;

  // Signed into Clerk, but the profile sync exhausted its retries. Show a real
  // error with retry / sign-out instead of an infinite spinner.
  if (clerkLoaded && isSignedIn && !isLoading && (error || !user)) {
    return <ProfileSyncError />;
  }

  if (isLoading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface">
        <div className="w-8 h-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      </div>
    );
  }

  return (
    <PrivacyNoticeGate>
    <div className="flex min-h-screen bg-surface">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[200] focus:rounded-md focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-brand-700 focus:shadow-lg"
      >
        Skip to main content
      </a>
      <Sidebar />
      <main id="main-content" tabIndex={-1} className="flex-1 overflow-y-auto focus:outline-none">
        <div className="p-6 lg:p-8">{children}</div>
      </main>
      <CommandPalette />
      <AnnouncementsPopup />
    </div>
    </PrivacyNoticeGate>
  );
}
