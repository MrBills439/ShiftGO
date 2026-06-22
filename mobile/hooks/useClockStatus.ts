import { useState, useEffect, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { manualClockIn, manualClockOut, getMyTimesheets } from '../services/clockService';
import { Shift, Timesheet } from '../types';

export function useClockStatus(activeShift: Shift | null) {
  const [isClockedIn, setIsClockedIn] = useState(false);
  const [isActing, setIsActing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  // Derive clock state from server timesheets — this is the source of truth
  const { data: timesheets, isLoading } = useQuery<Timesheet[]>({
    queryKey: ['timesheets'],
    queryFn: getMyTimesheets,
    staleTime: 15_000,
  });

  useEffect(() => {
    if (!timesheets) return;
    if (!activeShift) { setIsClockedIn(false); return; }
    const ts = timesheets.find((t) => t.shiftId === activeShift.id);
    setIsClockedIn(!!ts?.clockInAt && !ts?.clockOutAt);
  }, [activeShift?.id, timesheets]);

  const clockIn = useCallback(async () => {
    if (!activeShift) return;
    setIsActing(true);
    setError(null);
    try {
      await manualClockIn(activeShift.houseId, activeShift.id);
      setIsClockedIn(true);
      queryClient.invalidateQueries({ queryKey: ['timesheets'] });
    } catch (e: any) {
      setError(e.response?.data?.message ?? 'Failed to clock in');
    } finally {
      setIsActing(false);
    }
  }, [activeShift, queryClient]);

  const clockOut = useCallback(async () => {
    if (!activeShift) return;
    setIsActing(true);
    setError(null);
    try {
      await manualClockOut(activeShift.houseId, activeShift.id);
      setIsClockedIn(false);
      queryClient.invalidateQueries({ queryKey: ['timesheets'] });
    } catch (e: any) {
      setError(e.response?.data?.message ?? 'Failed to clock out');
    } finally {
      setIsActing(false);
    }
  }, [activeShift, queryClient]);

  return { isClockedIn, isLoading, isActing, error, clockIn, clockOut };
}
