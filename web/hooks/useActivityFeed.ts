import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export interface ActivityEvent {
  id: string;
  type: string;
  actor?: {
    id: string;
    name: string;
  };
  subject?: {
    id: string;
    name: string;
    type: string;
  };
  action: string;
  description: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

export function useActivityFeed(limit = 20) {
  return useQuery<ActivityEvent[]>({
    queryKey: ['activity-feed', limit],
    queryFn: async () => {
      const { data } = await api.get('/activity', { params: { limit } });
      return data.data || [];
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}
