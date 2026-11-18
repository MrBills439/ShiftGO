import { api } from './api';

export interface PrivacyNotice {
  version: string;
  isDefault: boolean;
  updatedAt: string | null;
  text: string;
  acknowledged: boolean;
  acknowledgedAt: string | null;
}

export interface DeletionRequest {
  id: string;
  status: 'PENDING' | 'COMPLETED' | 'REJECTED' | 'CANCELLED';
  reason: string | null;
  resolutionNote: string | null;
  createdAt: string;
}

export async function getPrivacyNotice(): Promise<PrivacyNotice> {
  return (await api.get('/privacy-notice')).data.data;
}

export async function acknowledgePrivacyNotice(version: string): Promise<PrivacyNotice> {
  return (await api.post('/privacy-notice/acknowledge', { version })).data.data;
}

export async function getMyDeletionRequest(): Promise<DeletionRequest | null> {
  return (await api.get('/users/me/deletion-request')).data.data ?? null;
}

export async function requestAccountDeletion(reason?: string): Promise<DeletionRequest> {
  return (await api.post('/users/me/deletion-request', { reason })).data.data;
}

export async function cancelAccountDeletion(): Promise<DeletionRequest> {
  return (await api.post('/users/me/deletion-request/cancel')).data.data;
}
