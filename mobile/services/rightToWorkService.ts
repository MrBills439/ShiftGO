import { api } from './api';
import { ShareCode } from '../types';

export const RIGHT_TO_WORK_URL = 'https://www.gov.uk/prove-right-to-work';

export async function getMyShareCode(): Promise<ShareCode> {
  const { data } = await api.get('/right-to-work/me');
  return data.data;
}

export async function updateMyShareCode(payload: {
  code: string;
  shareDate: string;
  notes?: string;
}): Promise<ShareCode> {
  const { data } = await api.put('/right-to-work/me', payload);
  return data.data;
}

export async function uploadShareCodeDocument(uri: string): Promise<ShareCode> {
  const formData = new FormData();
  const filename = uri.split('/').pop() ?? 'right-to-work.jpg';
  const ext = filename.split('.').pop()?.toLowerCase() ?? 'jpg';
  const mimeMap: Record<string, string> = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', pdf: 'application/pdf',
  };
  formData.append('document', { uri, name: filename, type: mimeMap[ext] ?? 'image/jpeg' } as any);
  const { data } = await api.post('/right-to-work/me/document', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return data.data;
}
