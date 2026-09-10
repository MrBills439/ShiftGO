import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { ShareCode } from '@/types';
import type { Training, DbsCheck } from '@/hooks/useProfile';

export type { Training, DbsCheck } from '@/hooks/useProfile';
export type TrainingStatus = Training['status'];
export type DbsStatus = DbsCheck['status'];

// ── Right to Work (per user, read-only summary) ──────────────────────────────
// GET /right-to-work/user/:userId — TEAM_LEADER+. Returns the decorated record
// or a MISSING shape; both fit ShareCode (nullable code/shareDate).
export function useUserRightToWork(userId: string | undefined) {
  return useQuery<ShareCode>({
    queryKey: ['right-to-work', 'user', userId],
    queryFn: async () => (await api.get(`/right-to-work/user/${userId}`)).data.data,
    enabled: !!userId,
    retry: false,
    staleTime: 30_000,
  });
}

// ── DBS (per user) ──────────────────────────────────────────────────────────
export function useUserDbs(userId: string | undefined) {
  return useQuery<DbsCheck | null>({
    queryKey: ['dbs', 'user', userId],
    queryFn: async () => (await api.get(`/dbs/user/${userId}`)).data.data,
    enabled: !!userId,
    retry: false,
    staleTime: 30_000,
  });
}

/** POST /dbs — HR only. Upsert on userId. Schema unchanged (no document). */
export function useUpsertDbs(userId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      status?: DbsStatus;
      reference?: string | null;
      issuedAt?: string | null;
      expiresAt?: string | null;
      notes?: string | null;
    }) => api.post('/dbs', { userId, ...body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dbs', 'user', userId] }),
  });
}

// ── Training (per user) ─────────────────────────────────────────────────────
export function useUserTraining(userId: string | undefined) {
  return useQuery<Training[]>({
    queryKey: ['training', 'user', userId],
    queryFn: async () => (await api.get(`/training/user/${userId}`)).data.data,
    enabled: !!userId,
    retry: false,
    staleTime: 30_000,
  });
}

type TrainingBody = {
  title: string;
  description?: string | null;
  status?: TrainingStatus;
  completedAt?: string | null;
  expiresAt?: string | null;
};

/** POST /training — MANAGER+. */
export function useCreateTraining(userId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: TrainingBody) => api.post('/training', { userId, ...body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['training', 'user', userId] }),
  });
}

/** PATCH /training/:id — MANAGER+. */
export function useUpdateTraining(userId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string } & Partial<TrainingBody>) => api.patch(`/training/${id}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['training', 'user', userId] }),
  });
}
