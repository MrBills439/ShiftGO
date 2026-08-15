import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Shift } from '@/types';

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
    },
  });
}

export function useDeleteShift() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api.delete(`/shifts/${id}`, { data: { reason } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['shifts'] }),
  });
}
