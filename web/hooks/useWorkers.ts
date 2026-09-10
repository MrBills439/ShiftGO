import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Role, User, WorkPatternType, EmploymentType } from '@/types';

export type UserStatus = 'ACTIVE' | 'DEACTIVATED';

// Whole-Workforce Phase 1: optional employment fields on create / update.
export type EmploymentInput = {
  employeeNumber?: string | null;
  departmentId?: string | null;
  jobTitleId?: string | null;
  primaryLocationId?: string | null;
  lineManagerId?: string | null;
  contractedHours?: number | null;
  workPatternType?: WorkPatternType;
  employmentType?: EmploymentType | null;
};

// HR Onboarding V1: personal + emergency-contact fields, staged in PendingEmployee
// and applied to the User by the membership webhook. All optional except name/email.
export type OnboardingInput = {
  address?: string | null;
  employmentStartDate?: string | null; // ISO date ("YYYY-MM-DD")
  emergencyContactName?: string | null;
  emergencyContactPhone?: string | null;
  emergencyContactRelationship?: string | null;
};

export type CreateUserInput = {
  name: string;
  email: string;
  role: Role;
  phone?: string;
  password?: string;
  temporaryPassword?: string;
} & EmploymentInput & OnboardingInput;

export type UserFilters = {
  role?: string;
  status?: UserStatus;
  departmentId?: string;
  jobTitleId?: string;
  primaryLocationId?: string;
  workPatternType?: string;
  employmentType?: string;
};

export function useUsers(roleOrFilters?: string | UserFilters, status: UserStatus = 'ACTIVE', enabled = true) {
  const filters: UserFilters = typeof roleOrFilters === 'string' || roleOrFilters === undefined
    ? { role: roleOrFilters as string | undefined, status }
    : { status, ...roleOrFilters };
  const params = Object.fromEntries(Object.entries(filters).filter(([, v]) => v));
  return useQuery<User[]>({
    queryKey: ['users', params],
    queryFn: async () => {
      const { data } = await api.get('/users', { params });
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
    mutationFn: ({ id, ...body }: { id: string } & EmploymentInput) => api.patch(`/users/${id}`, body),
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
