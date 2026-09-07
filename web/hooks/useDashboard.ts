import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { DashboardToday } from '@/types';

/** GET /dashboard/today — operational summary, agency-scoped, TEAM_LEADER+. */
export function useDashboardToday(enabled = true) {
  return useQuery<DashboardToday>({
    queryKey: ['dashboard', 'today'],
    queryFn: async () => {
      const { data } = await api.get('/dashboard/today');
      return data.data;
    },
    enabled,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}
