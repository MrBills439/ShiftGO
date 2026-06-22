import { create } from 'zustand';
import { AuthUser } from '../types';
import { login as apiLogin, logout as apiLogout, getStoredUser } from '../services/authService';

interface AuthState {
  user: AuthUser | null;
  isLoading: boolean;
  hydrate: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isLoading: true,

  hydrate: async () => {
    try {
      const user = await getStoredUser();
      set({ user, isLoading: false });
    } catch {
      set({ user: null, isLoading: false });
    }
  },

  login: async (email, password) => {
    const user = await apiLogin(email, password);
    set({ user });
  },

  logout: async () => {
    await apiLogout();
    set({ user: null });
  },
}));
