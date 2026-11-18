'use client';
import { create } from 'zustand';
import { AuthUser } from '@/types';
import { authClient } from '@/lib/authClient';

/**
 * signed-out      no session (send to /sign-in)
 * profile_sync_failed  a session exists but /users/me failed (server down etc.)
 */
export type AuthSyncError = 'profile_sync_failed' | null;

interface AuthState {
  user: AuthUser | null;
  isLoading: boolean;
  /** True once we know there is no valid session. */
  signedOut: boolean;
  error: AuthSyncError;
  /** Bumped by retrySync() / refresh() to re-run AuthSync. */
  syncNonce: number;
  retrySync: () => void;
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isLoading: true,
  signedOut: false,
  error: null,
  syncNonce: 0,

  retrySync: () => set((s) => ({ syncNonce: s.syncNonce + 1, isLoading: true, error: null })),

  logout: async () => {
    try {
      await authClient.signOut();
    } finally {
      set({ user: null, signedOut: true });
      window.location.href = '/sign-in';
    }
  },
}));
