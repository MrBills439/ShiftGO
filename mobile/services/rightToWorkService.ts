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

/** Upload a Right-to-Work proof PDF. New uploads are PDF only — the picker and
 *  the backend both enforce it (extension, declared MIME, and real file
 *  signature), so we always send it as application/pdf with a .pdf name. */
export async function uploadShareCodeDocument(file: { uri: string; name?: string | null }): Promise<ShareCode> {
  const formData = new FormData();
  const rawName = file.name ?? file.uri.split('/').pop() ?? 'right-to-work.pdf';
  const name = rawName.toLowerCase().endsWith('.pdf') ? rawName : `${rawName}.pdf`;
  formData.append('document', { uri: file.uri, name, type: 'application/pdf' } as any);
  const { data } = await api.post('/right-to-work/me/document', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return data.data;
}
