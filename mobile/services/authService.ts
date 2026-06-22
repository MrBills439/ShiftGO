import axios from 'axios';
import * as SecureStore from 'expo-secure-store';
import { AuthUser } from '../types';

const BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000';

export async function login(email: string, password: string): Promise<AuthUser> {
  const { data } = await axios.post(`${BASE_URL}/auth/login`, { email, password });
  const { user, accessToken, refreshToken } = data.data;
  await SecureStore.setItemAsync('accessToken', accessToken);
  await SecureStore.setItemAsync('refreshToken', refreshToken);
  await SecureStore.setItemAsync('user', JSON.stringify(user));
  return user;
}

export async function logout() {
  await SecureStore.deleteItemAsync('accessToken');
  await SecureStore.deleteItemAsync('refreshToken');
  await SecureStore.deleteItemAsync('user');
}

export async function getStoredUser(): Promise<AuthUser | null> {
  const raw = await SecureStore.getItemAsync('user');
  return raw ? JSON.parse(raw) : null;
}

export async function updateFcmToken(token: string) {
  const { api } = await import('./api');
  await api.patch('/users/me/fcm-token', { fcmToken: token });
}
