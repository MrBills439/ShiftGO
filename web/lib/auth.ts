import axios from 'axios';
import { AuthUser } from '@/types';

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export async function loginRequest(email: string, password: string): Promise<AuthUser> {
  const { data } = await axios.post(`${BASE}/auth/login`, { email, password });
  const { user, accessToken, refreshToken } = data.data;
  localStorage.setItem('shiftgo_access', accessToken);
  localStorage.setItem('shiftgo_refresh', refreshToken);
  localStorage.setItem('shiftgo_user', JSON.stringify(user));
  return user;
}

export function logoutClear() {
  localStorage.removeItem('shiftgo_access');
  localStorage.removeItem('shiftgo_refresh');
  localStorage.removeItem('shiftgo_user');
}

export function getStoredUser(): AuthUser | null {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem('shiftgo_user');
  return raw ? JSON.parse(raw) : null;
}

export function isAuthenticated(): boolean {
  if (typeof window === 'undefined') return false;
  return !!localStorage.getItem('shiftgo_access');
}
