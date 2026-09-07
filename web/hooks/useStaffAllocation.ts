import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { StaffAllocation } from '@/types';

/**
 * Staff Allocation & Weekly Hours view for a given agency week (YYYY-MM-DD, any
 * day in the target week) and an optional proposed open/cover shift.
 * Backend applies agency + Manager/Team-Leader scoping.
 */
export function useStaffAllocation(week?: string, proposedShiftId?: string, enabled = true) {
  return useQuery<StaffAllocation>({
    queryKey: ['staff-allocation', week ?? 'current', proposedShiftId ?? null],
    queryFn: async () => {
      const { data } = await api.get('/staff/allocation', {
        params: {
          ...(week ? { week } : {}),
          ...(proposedShiftId ? { proposedShiftId } : {}),
        },
      });
      return data.data;
    },
    enabled,
    staleTime: 15_000,
  });
}
