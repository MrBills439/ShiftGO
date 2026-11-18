'use client';
import { SignedInShell } from '@/components/auth/SignedInShell';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <SignedInShell allowedRoles={['HR']}>{children}</SignedInShell>;
}
