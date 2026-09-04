import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Role, User } from '@/types';

export type UserStatus = 'ACTIVE' | 'DEACTIVATED';

export type CreateUserInput = {
  name: string;
  email: string;
  role: Role;
  phone?: string;
  password?: string;
  temporaryPassword?: string;
};

export function useUsers(role?: string, status: UserStatus = 'ACTIVE', enabled = true) {
  return useQuery<User[]>({
    queryKey: ['users', role, status],
    queryFn: async () => {
      const { data } = await api.get('/users', { params: { ...(role ? { role } : {}), status } });
      return data.data;
    },
    staleTime: 60_000,
    // Workers get a 403 from GET /users — callers pass enabled:false for them.
    enabled,
  });
}

export function useCreateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateUserInput) => api.post('/users', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });
}

export function useUpdateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, contractedHours }: { id: string; contractedHours: number | null }) =>
      api.patch(`/users/${id}`, { contractedHours }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });
}

export function useDeactivateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api.post(`/users/${id}/deactivate`, { reason }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      qc.invalidateQueries({ queryKey: ['shifts'] });
    },
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
