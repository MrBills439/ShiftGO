import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { Department, JobTitle, Location, OrgOption } from '@/types';

// Whole-Workforce Phase 1 — Department / JobTitle / Location.
// Reads require MANAGER/HR; writes require HR (enforced server-side).

const PATHS = { department: '/departments', jobTitle: '/job-titles', location: '/locations' } as const;
type Entity = keyof typeof PATHS;

function useOrgList<T>(entity: Entity, { includeInactive = false } = {}) {
  return useQuery<T[]>({
    queryKey: ['org', entity, includeInactive ? 'all' : 'active'],
    queryFn: async () => {
      const { data } = await api.get(PATHS[entity], { params: includeInactive ? { status: 'all' } : {} });
      return data.data;
    },
    staleTime: 60_000,
  });
}

function useOrgOptions(entity: Entity, enabled = true) {
  return useQuery<OrgOption[]>({
    queryKey: ['org', entity, 'options'],
    queryFn: async () => (await api.get(`${PATHS[entity]}/options`)).data.data,
    staleTime: 60_000,
    enabled,
  });
}

function invalidate(qc: ReturnType<typeof useQueryClient>, entity: Entity) {
  qc.invalidateQueries({ queryKey: ['org', entity] });
  qc.invalidateQueries({ queryKey: ['users'] });
}

function useOrgMutations(entity: Entity) {
  const qc = useQueryClient();
  const base = PATHS[entity];
  return {
    create: useMutation({
      mutationFn: (body: Record<string, unknown>) => api.post(base, body),
      onSuccess: () => invalidate(qc, entity),
    }),
    update: useMutation({
      mutationFn: ({ id, ...body }: { id: string } & Record<string, unknown>) => api.patch(`${base}/${id}`, body),
      onSuccess: () => invalidate(qc, entity),
    }),
    deactivate: useMutation({
      mutationFn: (id: string) => api.post(`${base}/${id}/deactivate`),
      onSuccess: () => invalidate(qc, entity),
    }),
    reactivate: useMutation({
      mutationFn: (id: string) => api.post(`${base}/${id}/reactivate`),
      onSuccess: () => invalidate(qc, entity),
    }),
  };
}

// ── Departments ──
export const useDepartments = (o?: { includeInactive?: boolean }) => useOrgList<Department>('department', o);
export const useDepartmentOptions = (enabled?: boolean) => useOrgOptions('department', enabled);
export const useDepartmentMutations = () => useOrgMutations('department');

// ── Job Titles ──
export const useJobTitles = (o?: { includeInactive?: boolean }) => useOrgList<JobTitle>('jobTitle', o);
export const useJobTitleOptions = (enabled?: boolean) => useOrgOptions('jobTitle', enabled);
export const useJobTitleMutations = () => useOrgMutations('jobTitle');

// ── Locations ──
export const useLocations = (o?: { includeInactive?: boolean }) => useOrgList<Location>('location', o);
export const useLocationOptions = (enabled?: boolean) => useOrgOptions('location', enabled);
export const useLocationMutations = () => useOrgMutations('location');

export const LOCATION_TYPE_LABELS: Record<string, string> = {
  CARE_SERVICE: 'Care service',
  SUPPORTED_LIVING: 'Supported living',
  RESIDENTIAL_HOME: 'Residential home',
  OFFICE: 'Office',
  MAINTENANCE_BASE: 'Maintenance base',
  OTHER: 'Other',
};
export const WORK_PATTERN_LABELS: Record<string, string> = {
  ROTA: 'Rota', FIXED: 'Fixed', FLEXIBLE: 'Flexible',
};
export const EMPLOYMENT_TYPE_LABELS: Record<string, string> = {
  PERMANENT: 'Permanent', BANK: 'Bank', CONTRACTOR: 'Contractor',
};
