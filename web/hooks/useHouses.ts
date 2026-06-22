import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { House } from '@/types';

export function useHouses() {
  return useQuery<House[]>({
    queryKey: ['houses'],
    queryFn: async () => {
      const { data } = await api.get('/houses');
      return data.data;
    },
    staleTime: 60_000,
  });
}

export function useHouse(id: string) {
  return useQuery<House>({
    queryKey: ['houses', id],
    queryFn: async () => {
      const { data } = await api.get(`/houses/${id}`);
      return data.data;
    },
    enabled: !!id,
  });
}

export function useCreateHouse() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post('/houses', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['houses'] }),
  });
}

export function useUpdateGeofence() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, radius }: { id: string; radius: number }) =>
      api.patch(`/houses/${id}/geofence`, { radius }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['houses'] }),
  });
}

export function useDeleteHouse() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/houses/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['houses'] }),
  });
}
