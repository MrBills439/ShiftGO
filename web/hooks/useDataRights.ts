'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export interface PrivacyNotice {
  version: string;
  isDefault: boolean;
  updatedAt: string | null;
  text: string;
  acknowledged: boolean;
  acknowledgedAt: string | null;
}

export type DeletionStatus = 'PENDING' | 'COMPLETED' | 'REJECTED' | 'CANCELLED';

export interface DeletionRequest {
  id: string;
  status: DeletionStatus;
  reason: string | null;
  resolvedAt: string | null;
  resolutionNote: string | null;
  createdAt: string;
  user: { id: string; name: string; email: string; status: string; role: string };
  resolvedBy: { id: string; name: string } | null;
}

// ─── Privacy notice ─────────────────────────────────────────────────────────
export function usePrivacyNotice(enabled = true) {
  return useQuery<PrivacyNotice>({
    queryKey: ['privacy-notice'],
    queryFn: async () => (await api.get('/privacy-notice')).data.data,
    enabled,
    staleTime: 5 * 60_000,
  });
}

export function useAcknowledgeNotice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (version: string) => api.post('/privacy-notice/acknowledge', { version }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['privacy-notice'] }),
  });
}

export function useUpdateNotice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (text: string) => api.put('/privacy-notice', { text }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['privacy-notice'] }),
  });
}

// ─── Deletion requests ──────────────────────────────────────────────────────
export function useMyDeletionRequest() {
  return useQuery<DeletionRequest | null>({
    queryKey: ['my-deletion-request'],
    queryFn: async () => (await api.get('/users/me/deletion-request')).data.data ?? null,
  });
}

export function useRequestDeletion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (reason: string) => api.post('/users/me/deletion-request', { reason }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['my-deletion-request'] }),
  });
}

export function useCancelDeletion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post('/users/me/deletion-request/cancel'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['my-deletion-request'] }),
  });
}

export function useDeletionRequests(status: DeletionStatus | 'ALL' = 'PENDING') {
  return useQuery<DeletionRequest[]>({
    queryKey: ['deletion-requests', status],
    queryFn: async () => (await api.get('/deletion-requests', { params: { status } })).data.data,
  });
}

export function useResolveDeletion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action, note }: { id: string; action: 'complete' | 'reject'; note?: string }) =>
      api.post(`/deletion-requests/${id}/${action}`, { note }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['deletion-requests'] }),
  });
}

// ─── Personal data export ───────────────────────────────────────────────────
async function authedDownload(pathname: string, filename: string) {
  const token = await window.Clerk?.session?.getToken();
  const res = await fetch(`${BASE}${pathname}`, { headers: token ? { Authorization: `Bearer ${token}` } : undefined });
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const today = () => new Date().toISOString().slice(0, 10);

export function downloadMyData() {
  return authedDownload('/users/me/export', `shiftgo-my-data-${today()}.json`);
}

export function downloadEmployeeData(userId: string, name: string) {
  const safe = name.replace(/[^\w.-]+/g, '_');
  return authedDownload(`/users/${userId}/export`, `shiftgo-data-${safe}-${today()}.json`);
}
