'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@clerk/nextjs';
import { Sidebar } from '@/components/layout/Sidebar';
import { ProfileSyncError } from '@/components/auth/ProfileSyncError';
import { useAuthStore } from '@/store/authStore';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user, isLoading, error } = useAuthStore();
  const { isLoaded: clerkLoaded, isSignedIn } = useAuth();
  const router = useRouter();

  const definitelySignedOut = clerkLoaded && !isSignedIn;

  useEffect(() => {
    if (definitelySignedOut) router.replace('/sign-in');
  }, [definitelySignedOut]);

  useEffect(() => {
    // Profile loaded and this isn't an HR — send them to the normal dashboard.
    if (!isLoading && user && user.role !== 'HR') router.replace('/dashboard');
  }, [user, isLoading]);

  if (definitelySignedOut) return null;

  if (clerkLoaded && isSignedIn && !isLoading && (error || !user)) {
    return <ProfileSyncError />;
  }

  if (isLoading || !user || user.role !== 'HR') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface">
        <div className="w-8 h-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-surface">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        <div className="p-6 lg:p-8">{children}</div>
      </main>
    </div>
  );
}
