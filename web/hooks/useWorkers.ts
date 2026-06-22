import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { User } from '@/types';

export function useUsers(role?: string) {
  return useQuery<User[]>({
    queryKey: ['users', role],
    queryFn: async () => {
      const { data } = await api.get('/users', { params: role ? { role } : {} });
      return data.data;
    },
    staleTime: 60_000,
  });
}

export function useCreateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post('/auth/register', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });
}

export function useAssignWorker() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { workerId: string; houseId: string }) =>
      api.post('/users/assign/worker', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['houses'] });
      qc.invalidateQueries({ queryKey: ['users'] });
    },
  });
}

export function useAssignTeamLeader() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { teamLeaderId: string; houseId: string }) =>
      api.post('/users/assign/team-leader', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['houses'] }),
  });
}
