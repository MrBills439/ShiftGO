import { api } from './api';

export async function getMe() {
  const { data } = await api.get('/users/me');
  return data.data;
}

export async function updateMe(payload: {
  name?: string;
  phone?: string;
  bio?: string;
  address?: string;
}) {
  const { data } = await api.patch('/users/me', payload);
  return data.data;
}

export async function uploadAvatar(uri: string) {
  const formData = new FormData();
  const filename = uri.split('/').pop() ?? 'avatar.jpg';
  const ext = filename.split('.').pop()?.toLowerCase() ?? 'jpg';
  const mimeMap: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
  formData.append('avatar', { uri, name: filename, type: mimeMap[ext] ?? 'image/jpeg' } as any);
  const { data } = await api.post('/users/me/avatar', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return data.data;
}

export async function getMyTraining() {
  const { data } = await api.get('/training/me');
  return data.data;
}

export async function getMyDbs() {
  const { data } = await api.get('/dbs/me');
  return data.data;
}

export async function getShiftById(id: string) {
  const { data } = await api.get(`/shifts/${id}`);
  return data.data;
}
