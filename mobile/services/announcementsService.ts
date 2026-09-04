import { api } from './api';
import { Announcement } from '../types';

export async function getAnnouncements(): Promise<Announcement[]> {
  const { data } = await api.get('/announcements');
  return data.data;
}

export async function getUnreadAnnouncements(): Promise<Announcement[]> {
  const { data } = await api.get('/announcements/unread');
  return data.data;
}

export async function markAnnouncementRead(id: string) {
  const { data } = await api.post(`/announcements/${id}/read`);
  return data.data;
}
