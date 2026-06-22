import { api } from './api';

export async function getNotifications() {
  const { data } = await api.get('/notifications');
  return data.data;
}

export async function getUnreadCount(): Promise<number> {
  const { data } = await api.get('/notifications/unread-count');
  return data.data.count;
}

export async function markRead(id: string) {
  const { data } = await api.patch(`/notifications/${id}/read`);
  return data.data;
}

export async function markAllRead() {
  const { data } = await api.patch('/notifications/read-all');
  return data.data;
}
