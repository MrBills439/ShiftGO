import { useQuery } from '@tanstack/react-query';
import { getMyShifts } from '../services/clockService';
import { Shift } from '../types';

export function useShifts() {
  return useQuery<Shift[]>({
    queryKey: ['shifts'],
    queryFn: getMyShifts,
    staleTime: 60_000,
  });
}

export function useUpcomingShifts() {
  const { data, ...rest } = useShifts();
  const now = new Date();
  const upcoming = data?.filter((s) => new Date(s.endTime) >= now) ?? [];
  const past = data?.filter((s) => new Date(s.endTime) < now) ?? [];
  return { upcoming, past, ...rest };
}
