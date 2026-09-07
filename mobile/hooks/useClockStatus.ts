import { useState, useEffect, useCallback, useRef } from 'react';
import { AppState } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  manualClockIn, manualClockOut, getMyTimesheets,
  reportLocation, confirmStillWorking as apiConfirmStillWorking,
  type AttendancePrompt,
} from '../services/clockService';
import { captureAttendanceLocation, CAPTURE_FAILURE_MESSAGE, type CaptureFailure } from '../lib/captureLocation';
import {
  startAttendanceMonitoring, stopAttendanceMonitoring, reconcileMonitoring, reportOnce,
} from '../tasks/locationTask';
import { ATTENDANCE } from '../lib/attendanceConfig';
import {
  AttendanceQueueSummary, getAttendanceQueueSummary, isNetworkError,
  queueOfflineAttendanceEvent, subscribeAttendanceQueue, syncAttendanceQueue,
} from '../services/offlineAttendanceQueue';
import { apiErrorMessage } from '../services/api';
import { Shift, Timesheet } from '../types';

export type ClockError = {
  code:
    | CaptureFailure
    | 'OUTSIDE_GEOFENCE' | 'GPS_ACCURACY_INSUFFICIENT' | 'STALE_LOCATION' | 'INVALID_COORDINATES'
    | 'LOCATION_REQUIRED' | 'OUTSIDE_SHIFT_WINDOW' | 'SHIFT_CANCELLED' | 'FORBIDDEN'
    | 'NO_CONNECTION' | 'SERVER_ERROR';
  message: string;
  distanceMeters?: number;
  geofenceRadius?: number;
};

export function useClockStatus(activeShift: Shift | null) {
  const [isClockedIn, setIsClockedIn] = useState(false);
  const [isActing, setIsActing] = useState(false);
  const [error, setError] = useState<ClockError | null>(null);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [prompt, setPrompt] = useState<AttendancePrompt | null>(null);
  const [queueSummary, setQueueSummary] = useState<AttendanceQueueSummary>({
    pendingCount: 0, syncingCount: 0, failedCount: 0, lastStatus: null, lastMessage: null,
  });
  const queryClient = useQueryClient();

  const optimisticRef = useRef<{ shiftId: string; state: 'in' | 'out' } | null>(null);
  const reportTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const promptCooldownRef = useRef(0);

  // Clock actions change a shift's attendance state, so every list that
  // categorises shifts by it must refetch — otherwise the Shifts tab keeps
  // showing a clocked-in shift under "Upcoming" until the app restarts.
  const refreshShiftState = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['timesheets'] });
    queryClient.invalidateQueries({ queryKey: ['shifts'] });
    queryClient.invalidateQueries({ queryKey: ['open-shifts'] });
  }, [queryClient]);

  const { data: timesheets, isLoading } = useQuery<Timesheet[]>({
    queryKey: ['timesheets'],
    queryFn: getMyTimesheets,
    staleTime: 15_000,
  });

  // Derive clocked-in state from server timesheets (source of truth).
  useEffect(() => {
    if (!activeShift) {
      optimisticRef.current = null;
      setIsClockedIn(false);
      return;
    }
    if (optimisticRef.current && optimisticRef.current.shiftId !== activeShift.id) {
      optimisticRef.current = null;
    }
    if (!timesheets) return;
    const ts = timesheets.find((t) => t.shiftId === activeShift.id);
    const serverIn = !!ts?.clockInAt && !ts?.clockOutAt;
    const serverOut = !!ts?.clockOutAt;
    const opt = optimisticRef.current;
    if (opt && opt.shiftId === activeShift.id) {
      if (opt.state === 'in' && !serverOut) { setIsClockedIn(true); return; }
      if (opt.state === 'out' && !serverIn) { setIsClockedIn(false); return; }
      optimisticRef.current = null;
    }
    setIsClockedIn(serverIn);
  }, [activeShift?.id, timesheets]);

  // ── offline attendance queue plumbing (clock-OUT only) ─────────────────────
  const refreshQueueSummary = useCallback(async () => {
    const summary = await getAttendanceQueueSummary();
    setQueueSummary(summary);
    setSyncMessage(summary.lastMessage);
  }, []);

  const retrySync = useCallback(async () => {
    const summary = await syncAttendanceQueue();
    setQueueSummary(summary);
    setSyncMessage(summary.lastMessage);
    refreshShiftState();
  }, [refreshShiftState]);

  useEffect(() => {
    refreshQueueSummary();
    retrySync();
    reconcileMonitoring();
    const unsub = subscribeAttendanceQueue(refreshQueueSummary);
    const appSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') { retrySync(); reconcileMonitoring(); }
    });
    const interval = setInterval(retrySync, 30_000);
    return () => { unsub(); appSub.remove(); clearInterval(interval); };
  }, [refreshQueueSummary, retrySync]);

  // ── foreground location reporting while clocked in ────────────────────────
  const doReport = useCallback(async () => {
    if (!activeShift) return;
    const loc = await captureAttendanceLocation();
    if (!loc.ok) return; // silent for background-style reports
    try {
      const res = await reportLocation(activeShift.id, {
        latitude: loc.latitude, longitude: loc.longitude,
        accuracy: loc.accuracy, capturedAt: loc.capturedAt,
        mockLocationSuspected: loc.mockLocationSuspected,
      });
      if (res.active === false) {
        await stopAttendanceMonitoring();
        setIsClockedIn(false);
        optimisticRef.current = null;
        refreshShiftState();
        return;
      }
      if (res.prompt && Date.now() > promptCooldownRef.current) {
        setPrompt(res.prompt);
      }
    } catch {
      /* offline — try again next tick */
    }
  }, [activeShift, queryClient, refreshShiftState]);

  useEffect(() => {
    if (reportTimer.current) { clearInterval(reportTimer.current); reportTimer.current = null; }
    if (isClockedIn && activeShift) {
      doReport();
      reportTimer.current = setInterval(doReport, ATTENDANCE.reportIntervalMs);
    }
    return () => { if (reportTimer.current) clearInterval(reportTimer.current); };
  }, [isClockedIn, activeShift?.id, doReport]);

  // ── clock in ──────────────────────────────────────────────────────────────
  const clockIn = useCallback(async () => {
    if (!activeShift) return;
    setIsActing(true);
    setError(null);

    const loc = await captureAttendanceLocation();
    if (!loc.ok) {
      setError({ code: loc.reason, message: CAPTURE_FAILURE_MESSAGE[loc.reason] });
      setIsActing(false);
      return;
    }

    try {
      await manualClockIn(activeShift.houseId, activeShift.id, {
        timestamp: new Date().toISOString(),
        latitude: loc.latitude, longitude: loc.longitude, accuracy: loc.accuracy,
        capturedAt: loc.capturedAt, mockLocationSuspected: loc.mockLocationSuspected,
        locationSource: 'MANUAL',
      });
      optimisticRef.current = { shiftId: activeShift.id, state: 'in' };
      setIsClockedIn(true);
      setSyncMessage('Clocked in');
      refreshShiftState();
      await startAttendanceMonitoring(activeShift.id);
    } catch (e: unknown) {
      if (isNetworkError(e)) {
        // Never fake a clock-in the server hasn't accepted — geofence can't be
        // verified offline.
        setError({ code: 'NO_CONNECTION', message: 'No connection. Connect to the internet to clock in.' });
      } else {
        const resp = (e as { response?: { status?: number; data?: { code?: string; message?: string; details?: { distanceMeters?: number; geofenceRadius?: number } } } }).response;
        const code = (resp?.data?.code as ClockError['code']) || 'SERVER_ERROR';
        setError({
          code,
          message: resp?.data?.message || apiErrorMessage(e, 'Could not clock in'),
          distanceMeters: resp?.data?.details?.distanceMeters,
          geofenceRadius: resp?.data?.details?.geofenceRadius,
        });
      }
    } finally {
      setIsActing(false);
    }
  }, [activeShift, queryClient, refreshShiftState]);

  // ── clock out (never blocked by geofence) ────────────────────────────────
  const clockOut = useCallback(async () => {
    if (!activeShift) return;
    setIsActing(true);
    setError(null);
    const timestamp = new Date().toISOString();
    const loc = await captureAttendanceLocation();
    const coords = loc.ok
      ? {
          latitude: loc.latitude, longitude: loc.longitude, accuracy: loc.accuracy,
          capturedAt: loc.capturedAt, mockLocationSuspected: loc.mockLocationSuspected,
        }
      : {};

    try {
      await manualClockOut(activeShift.houseId, activeShift.id, { timestamp, ...coords, locationSource: 'MANUAL' });
      optimisticRef.current = { shiftId: activeShift.id, state: 'out' };
      setIsClockedIn(false);
      setPrompt(null);
      setSyncMessage('Clocked out');
      refreshShiftState();
      await stopAttendanceMonitoring();
    } catch (e: unknown) {
      if (isNetworkError(e)) {
        await queueOfflineAttendanceEvent({
          type: 'CLOCK_OUT', houseId: activeShift.houseId, shiftId: activeShift.id, timestamp,
          latitude: loc.ok ? loc.latitude : undefined,
          longitude: loc.ok ? loc.longitude : undefined,
          accuracy: loc.ok ? loc.accuracy ?? undefined : undefined,
          capturedAt: loc.ok ? loc.capturedAt : undefined,
        });
        optimisticRef.current = { shiftId: activeShift.id, state: 'out' };
        setIsClockedIn(false);
        setPrompt(null);
        // Honest: not "finished" yet — it's saved and will send when back online.
        setSyncMessage('Saved offline — will finish clock-out when back online');
        await stopAttendanceMonitoring();
        await refreshQueueSummary();
      } else {
        const resp = (e as { response?: { data?: { message?: string } } }).response;
        setError({ code: 'SERVER_ERROR', message: resp?.data?.message || apiErrorMessage(e, 'Could not clock out') });
      }
    } finally {
      setIsActing(false);
    }
  }, [activeShift, queryClient, refreshQueueSummary, refreshShiftState]);

  // ── "Yes, still working" from a prompt ──────────────────────────────────
  const confirmStillWorking = useCallback(async () => {
    if (!activeShift) return;
    setPrompt(null);
    promptCooldownRef.current = Date.now() + ATTENDANCE.promptCooldownMs;
    try { await apiConfirmStillWorking(activeShift.id); } catch { /* retried by next report */ }
  }, [activeShift]);

  const dismissPrompt = useCallback(() => setPrompt(null), []);

  return {
    isClockedIn, isLoading, isActing, error, syncMessage, queueSummary,
    prompt, confirmStillWorking, dismissPrompt,
    clockIn, clockOut, retrySync,
  };
}
