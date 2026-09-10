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

// Personal + emergency-contact fields. On create they are staged in
// PendingEmployee and applied by the webhook; on update (PATCH /users/:id) they
// are written straight to the User. `name`/`email` are never included.
export type PersonalInput = {
  phone?: string | null;
  address?: string | null;
  employmentStartDate?: string | null; // ISO date ("YYYY-MM-DD")
  emergencyContactName?: string | null;
  emergencyContactPhone?: string | null;
  emergencyContactRelationship?: string | null;
};
/** @deprecated kept as an alias — use PersonalInput */
export type OnboardingInput = PersonalInput;

export type CreateUserInput = {
  name: string;
  email: string;
  role: Role;
  password?: string;
  temporaryPassword?: string;
} & EmploymentInput & PersonalInput;

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

/** One employee (GET /users/:id) — MANAGER+ only; a bad / cross-agency id 404s. */
export function useUser(id: string | undefined, enabled = true) {
  return useQuery<User>({
    queryKey: ['users', 'detail', id],
    queryFn: async () => {
      const { data } = await api.get(`/users/${id}`);
      return data.data;
    },
    enabled: enabled && !!id,
    retry: false, // a 404 is a real answer, not a transient failure
    staleTime: 30_000,
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
    mutationFn: ({ id, ...body }: { id: string } & EmploymentInput & PersonalInput) => api.patch(`/users/${id}`, body),
    // ['users'] is a prefix of both ['users', params] and ['users','detail',id].
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

/** POST /users/:id/reactivate — HR only. DEACTIVATED → ACTIVE, history preserved. */
export function useReactivateUser(userId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post(`/users/${userId}/reactivate`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] }); // prefix → detail + directory
      qc.invalidateQueries({ queryKey: ['shifts'] });
    },
  });
}

export type OffboardingPreview = {
  futureShiftCount: number;
  inProgressShiftCount: number;
  trainingCount: number;
  role: Role;
  status: UserStatus;
};

/** GET /users/:id/offboarding-preview — awareness counts before deactivation. */
export function useOffboardingPreview(userId: string, enabled = true) {
  return useQuery<OffboardingPreview>({
    queryKey: ['users', 'offboarding-preview', userId],
    queryFn: async () => (await api.get(`/users/${userId}/offboarding-preview`)).data.data,
    enabled: enabled && !!userId,
    retry: false,
    staleTime: 10_000,
  });
}

/** PATCH /users/:id/system-access — HR only. Syncs the Clerk org role + User.role. */
export function useChangeSystemAccess(userId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (role: Role) => api.patch(`/users/${userId}/system-access`, { role }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }), // prefix → detail + list
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
