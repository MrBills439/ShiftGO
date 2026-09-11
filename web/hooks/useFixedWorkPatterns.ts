import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { FixedWorkPattern, FixedWorkPatternStatus } from '@/types';

// Recurring Fixed Work Patterns V1 — web hooks. Every write goes through the
// existing backend CRUD (GET/POST /fixed-work-patterns, .../:id/supersede,
// .../:id/end) — no new endpoint, no client-side Shift creation. See
// backend/src/routes/fixedWorkPatterns.js.

export type FixedWorkPatternFilters = { workerId?: string; status?: FixedWorkPatternStatus; locationId?: string };

/** All patterns matching the filter — ACTIVE + ENDED + SUPERSEDED, newest
 *  effectiveFrom first. Filtering by `workerId` is how this UI gets both "the
 *  current pattern" (client picks the ACTIVE one) and "history" (everything
 *  else) from a single call — no separate history endpoint needed. */
export function useFixedWorkPatterns(filters: FixedWorkPatternFilters, enabled = true) {
  return useQuery<FixedWorkPattern[]>({
    queryKey: ['fixed-work-patterns', filters],
    queryFn: async () => (await api.get('/fixed-work-patterns', { params: filters })).data.data,
    staleTime: 30_000,
    enabled,
  });
}

export type FixedWorkPatternDayInput = { weekday: number; startTime: string; endTime: string };

export type CreateFixedWorkPatternInput = {
  workerId: string;
  locationId: string;
  timezone?: string | null;
  effectiveFrom: string;
  effectiveTo?: string | null;
  days: FixedWorkPatternDayInput[];
  overrideWeeklyLimit?: boolean;
  overrideReason?: string;
};

export type SupersedeFixedWorkPatternInput = Omit<CreateFixedWorkPatternInput, 'workerId'> & { id: string };

function invalidate(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['fixed-work-patterns'] });
}

export function useCreateFixedWorkPattern() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateFixedWorkPatternInput) => api.post('/fixed-work-patterns', body),
    onSuccess: () => invalidate(qc),
  });
}

/** "Edit work pattern" in the UI, but never a PATCH on the old row — the
 *  backend always creates a new version and flips the old one to SUPERSEDED. */
export function useSupersedeFixedWorkPattern() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: SupersedeFixedWorkPatternInput) => api.post(`/fixed-work-patterns/${id}/supersede`, body),
    onSuccess: () => invalidate(qc),
  });
}

export function useEndFixedWorkPattern() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, effectiveTo }: { id: string; effectiveTo: string }) => api.post(`/fixed-work-patterns/${id}/end`, { effectiveTo }),
    onSuccess: () => invalidate(qc),
  });
}
