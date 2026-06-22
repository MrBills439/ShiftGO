'use client';
import { create } from 'zustand';
import { AuthUser } from '@/types';
import { loginRequest, logoutClear, getStoredUser } from '@/lib/auth';

interface AuthState {
  user: AuthUser | null;
  isLoading: boolean;
  hydrate: () => void;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isLoading: true,

  hydrate: () => {
    const user = getStoredUser();
    set({ user, isLoading: false });
  },

  login: async (email, password) => {
    const user = await loginRequest(email, password);
    set({ user });
  },

  logout: () => {
    logoutClear();
    set({ user: null });
    window.location.href = '/login';
  },
}));
