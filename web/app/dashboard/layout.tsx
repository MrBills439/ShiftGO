'use client';
import { CommandPalette } from '@/components/operations/CommandPalette';
import { AnnouncementsPopup } from '@/components/announcements/AnnouncementsPopup';
import { SignedInShell } from '@/components/auth/SignedInShell';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <SignedInShell extras={<><CommandPalette /><AnnouncementsPopup /></>}>
      {children}
    </SignedInShell>
  );
}
