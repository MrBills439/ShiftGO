import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { AgencySettings } from '@/types';

/** The caller's own agency settings (managers + HR can read). */
export function useAgency() {
  return useQuery<AgencySettings>({
    queryKey: ['agency'],
    queryFn: async () => {
      const { data } = await api.get('/agency');
      return data.data;
    },
    staleTime: 60_000,
  });
}

/** Update configurable agency settings (HR only). */
export function useUpdateAgencySettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { maxWeeklyScheduledHours: number }) => api.patch('/agency', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agency'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      qc.invalidateQueries({ queryKey: ['staff-allocation'] });
    },
  });
}
