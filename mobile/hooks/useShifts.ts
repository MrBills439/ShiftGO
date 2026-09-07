import { useQuery } from '@tanstack/react-query';
import { getMyShifts } from '../services/clockService';
import { Shift } from '../types';
import { categorizeShift, type ShiftCategory } from '../lib/shiftCategory';

export { categorizeShift };
export type { ShiftCategory };

export function useShifts() {
  return useQuery<Shift[]>({
    queryKey: ['shifts'],
    queryFn: getMyShifts,
    staleTime: 60_000,
  });
}

/**
 * Splits the worker's shifts into the three lists the Shifts screen shows plus
 * the single `active` shift, which is surfaced through the Clock screen and is
 * deliberately excluded from `upcoming` so it never appears twice.
 */
export function useUpcomingShifts() {
  const { data, ...rest } = useShifts();
  const nowMs = Date.now();
  const tagged = (data ?? []).map((s) => [s, categorizeShift(s, nowMs)] as const);

  return {
    active: tagged.find(([, c]) => c === 'active')?.[0] ?? null,
    upcoming: tagged.filter(([, c]) => c === 'upcoming').map(([s]) => s),
    past: tagged.filter(([, c]) => c === 'past').map(([s]) => s),
    ...rest,
  };
}
