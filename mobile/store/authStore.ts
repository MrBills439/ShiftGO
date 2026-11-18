import { create } from 'zustand';
import { AuthUser } from '../types';
import { authClient } from '../services/authClient';
import { stopAttendanceMonitoring } from '../tasks/locationTask';

export type AuthSyncError = 'profile_sync_failed' | null;

interface AuthState {
  user: AuthUser | null;
  isLoading: boolean;
  error: AuthSyncError;
  /** Bumped by retrySync() to re-trigger AuthSync's effect. */
  syncNonce: number;
  retrySync: () => void;
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isLoading: true,
  error: null,
  syncNonce: 0,

  retrySync: () => set((s) => ({ syncNonce: s.syncNonce + 1, isLoading: true, error: null })),

  logout: async () => {
    // No zombie background-location task after sign-out.
    await stopAttendanceMonitoring().catch(() => {});
    await authClient.signOut().catch(() => {});
    set({ user: null });
  },
}));
