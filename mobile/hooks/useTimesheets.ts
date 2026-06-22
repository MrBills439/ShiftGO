import { useQuery } from '@tanstack/react-query';
import { getMyTimesheets } from '../services/clockService';
import { Timesheet } from '../types';

export function useTimesheets() {
  return useQuery<Timesheet[]>({
    queryKey: ['timesheets'],
    queryFn: getMyTimesheets,
    staleTime: 30_000,
  });
}
