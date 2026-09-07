import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Shift, ShiftClaim } from '@/types';

export function useShifts(params?: { houseId?: string; workerId?: string }) {
  return useQuery<Shift[]>({
    queryKey: ['shifts', params],
    queryFn: async () => {
      const { data } = await api.get('/shifts', { params });
      return data.data;
    },
    staleTime: 30_000,
  });
}

export function useCreateShift() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post('/shifts', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['shifts'] });
      qc.invalidateQueries({ queryKey: ['rota-week'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

export function useUpdateShift() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string } & Record<string, unknown>) =>
      api.patch(`/shifts/${id}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['shifts'] });
      qc.invalidateQueries({ queryKey: ['rota-week'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      qc.invalidateQueries({ queryKey: ['staff-allocation'] });
    },
  });
}

export function useDeleteShift() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api.delete(`/shifts/${id}`, { data: { reason } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['shifts'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

export function useOpenShift() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, eligibleRoles, maxClaimsPerWorker, urgent }: { id: string; eligibleRoles?: string[]; maxClaimsPerWorker?: number; urgent?: boolean }) =>
      api.post(`/shifts/${id}/open`, { eligibleRoles, maxClaimsPerWorker, urgent }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['shifts'] });
      qc.invalidateQueries({ queryKey: ['rota-week'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

export function useAvailableShifts(enabled = true) {
  return useQuery<Shift[]>({
    queryKey: ['shifts', 'open'],
    queryFn: async () => {
      const { data } = await api.get('/shifts/open');
      return data.data;
    },
    enabled,
    staleTime: 15_000,
  });
}

export function useClaimShift() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post(`/shifts/${id}/claim`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['shifts'] });
      qc.invalidateQueries({ queryKey: ['rota-week'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

/** A worker releases one of their own shifts — it re-opens for cover and the
 *  house manager + team leaders are notified. */
export function useDropShift() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) =>
      api.post(`/shifts/${id}/drop`, reason ? { reason } : {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['shifts'] });
      qc.invalidateQueries({ queryKey: ['rota-week'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

export function useShiftClaims(id: string | null, enabled: boolean) {
  return useQuery<ShiftClaim[]>({
    queryKey: ['shift-claims', id],
    queryFn: async () => {
      const { data } = await api.get(`/shifts/${id}/claims`);
      return data.data;
    },
    enabled: enabled && Boolean(id),
    refetchInterval: enabled ? 5000 : false,
  });
}
