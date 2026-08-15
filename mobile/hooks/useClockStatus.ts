import { useState, useEffect, useCallback } from 'react';
import { AppState } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { manualClockIn, manualClockOut, getMyTimesheets } from '../services/clockService';
import {
  AttendanceQueueSummary,
  captureAttendanceLocation,
  getAttendanceQueueSummary,
  isNetworkError,
  queueOfflineAttendanceEvent,
  subscribeAttendanceQueue,
  syncAttendanceQueue,
} from '../services/offlineAttendanceQueue';
import { Shift, Timesheet } from '../types';

export function useClockStatus(activeShift: Shift | null) {
  const [isClockedIn, setIsClockedIn] = useState(false);
  const [isActing, setIsActing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [queueSummary, setQueueSummary] = useState<AttendanceQueueSummary>({
    pendingCount: 0,
    syncingCount: 0,
    failedCount: 0,
    lastStatus: null,
    lastMessage: null,
  });
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

  const refreshQueueSummary = useCallback(async () => {
    const summary = await getAttendanceQueueSummary();
    setQueueSummary(summary);
    setSyncMessage(summary.lastMessage);
  }, []);

  const retrySync = useCallback(async () => {
    setSyncMessage('Pending sync');
    const summary = await syncAttendanceQueue();
    setQueueSummary(summary);
    setSyncMessage(summary.lastMessage);
    queryClient.invalidateQueries({ queryKey: ['timesheets'] });
  }, [queryClient]);

  useEffect(() => {
    refreshQueueSummary();
    retrySync();
    const unsubscribe = subscribeAttendanceQueue(refreshQueueSummary);
    const appStateSubscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') retrySync();
    });
    const interval = setInterval(retrySync, 30_000);

    return () => {
      unsubscribe();
      appStateSubscription.remove();
      clearInterval(interval);
    };
  }, [refreshQueueSummary, retrySync]);

  const clockIn = useCallback(async () => {
    if (!activeShift) return;
    setIsActing(true);
    setError(null);
    const timestamp = new Date().toISOString();
    const location = await captureAttendanceLocation();
    const payload = {
      timestamp,
      ...location,
      reason: 'Manual app clock-in',
      locationSource: 'MANUAL' as const,
    };
    try {
      await manualClockIn(activeShift.houseId, activeShift.id, payload);
      setIsClockedIn(true);
      setSyncMessage('Synced');
      queryClient.invalidateQueries({ queryKey: ['timesheets'] });
    } catch (e: any) {
      if (isNetworkError(e)) {
        await queueOfflineAttendanceEvent({
          type: 'CLOCK_IN',
          houseId: activeShift.houseId,
          shiftId: activeShift.id,
          timestamp,
          ...location,
        });
        setIsClockedIn(true);
        setSyncMessage('Saved offline');
        await refreshQueueSummary();
      } else {
        setError(e.response?.data?.message ?? 'Failed to clock in');
      }
    } finally {
      setIsActing(false);
    }
  }, [activeShift, queryClient, refreshQueueSummary]);

  const clockOut = useCallback(async () => {
    if (!activeShift) return;
    setIsActing(true);
    setError(null);
    const timestamp = new Date().toISOString();
    const location = await captureAttendanceLocation();
    const payload = {
      timestamp,
      ...location,
      reason: 'Manual app clock-out',
      locationSource: 'MANUAL' as const,
    };
    try {
      await manualClockOut(activeShift.houseId, activeShift.id, payload);
      setIsClockedIn(false);
      setSyncMessage('Synced');
      queryClient.invalidateQueries({ queryKey: ['timesheets'] });
    } catch (e: any) {
      if (isNetworkError(e)) {
        await queueOfflineAttendanceEvent({
          type: 'CLOCK_OUT',
          houseId: activeShift.houseId,
          shiftId: activeShift.id,
          timestamp,
          ...location,
        });
        setIsClockedIn(false);
        setSyncMessage('Saved offline');
        await refreshQueueSummary();
      } else {
        setError(e.response?.data?.message ?? 'Failed to clock out');
      }
    } finally {
      setIsActing(false);
    }
  }, [activeShift, queryClient, refreshQueueSummary]);

  return { isClockedIn, isLoading, isActing, error, syncMessage, queueSummary, clockIn, clockOut, retrySync };
}
