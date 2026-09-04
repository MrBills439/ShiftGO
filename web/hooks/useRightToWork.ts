import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { RightToWorkList, ShareCode } from '@/types';

export function useRightToWorkList() {
  return useQuery<RightToWorkList>({
    queryKey: ['right-to-work', 'list'],
    queryFn: async () => {
      const { data } = await api.get('/right-to-work');
      return data.data;
    },
    staleTime: 30_000,
  });
}

export function useUpdateRightToWork() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, ...body }: { userId: string; code: string; shareDate: string; notes?: string }) =>
      api.put(`/right-to-work/user/${userId}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['right-to-work'] }),
  });
}

export function useUploadRightToWorkDoc() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, file }: { userId: string; file: File }) => {
      const form = new FormData();
      form.append('document', file);
      return api.post(`/right-to-work/user/${userId}/document`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['right-to-work'] }),
  });
}

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

/** Auth'd blob download using the live Clerk session token. */
async function authedDownload(pathname: string, filename: string) {
  const token = await window.Clerk?.session?.getToken();
  const res = await fetch(`${BASE}${pathname}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadRightToWorkZip() {
  return authedDownload('/right-to-work/export', `right-to-work-${new Date().toISOString().slice(0, 10)}.zip`);
}

export function downloadRightToWorkDoc(userId: string, name: string) {
  return authedDownload(`/right-to-work/user/${userId}/document`, name);
}

export type { ShareCode };
