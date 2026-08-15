'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Sidebar } from '@/components/layout/Sidebar';
import { CommandPalette } from '@/components/operations/CommandPalette';
import { useAuthStore } from '@/store/authStore';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, isLoading, hydrate } = useAuthStore();
  const router = useRouter();

  useEffect(() => { hydrate(); }, []);
  useEffect(() => {
    if (!isLoading && !user) router.replace('/login');
  }, [user, isLoading]);

  if (isLoading || !user) {
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
        <div className="max-w-container mx-auto p-6 lg:p-8">{children}</div>
      </main>
      <CommandPalette />
    </div>
  );
}
