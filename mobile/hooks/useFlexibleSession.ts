import { useCallback, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getActiveFlexibleSession, getLocationOptions, manualClockInFlexible,
} from '../services/clockService';
import { captureAttendanceLocation, CAPTURE_FAILURE_MESSAGE } from '../lib/captureLocation';
import { startAttendanceMonitoring } from '../tasks/locationTask';
import { apiErrorMessage } from '../services/api';
import { isNetworkError } from '../services/offlineAttendanceQueue';
import {
  clockableFromSession, defaultLocationId, sortLocationsPrimaryFirst,
} from '../lib/flexibleClock';
import type { ClockError } from './useClockStatus';
import type { FlexibleSession } from '../types';

/**
 * FLEXIBLE employees have no scheduled shift: they pick a work Location, clock
 * in, and the server creates the attendance shift. This hook owns the part
 * that happens BEFORE a shift exists (location list, choosing, the clock-in
 * call) and rediscovers an already-open session after an app restart. Once a
 * session exists, `clockable` feeds the same useClockStatus that ROTA/FIXED
 * use — location reporting, still-working prompts, clock-out and the offline
 * clock-out queue are all shared, not reimplemented.
 *
 * `enabled` is the employee's own workPatternType === 'FLEXIBLE'; when false
 * nothing is fetched and the hook is inert.
 */
export function useFlexibleSession(enabled: boolean, primaryLocationId?: string | null) {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<ClockError | null>(null);

  const sessionQuery = useQuery<FlexibleSession | null>({
    queryKey: ['flexible-session'],
    queryFn: getActiveFlexibleSession,
    enabled,
    staleTime: 15_000,
  });
  const session = enabled ? sessionQuery.data ?? null : null;

  const optionsQuery = useQuery({
    queryKey: ['location-options'],
    queryFn: getLocationOptions,
    enabled: enabled && sessionQuery.isSuccess && !session,
    staleTime: 5 * 60_000,
  });
  const options = useMemo(
    () => sortLocationsPrimaryFirst(optionsQuery.data ?? [], primaryLocationId),
    [optionsQuery.data, primaryLocationId],
  );

  // Pre-select the primary location once, never override a deliberate choice.
  useEffect(() => {
    if (selectedId || !optionsQuery.data) return;
    setSelectedId(defaultLocationId(optionsQuery.data, primaryLocationId));
  }, [optionsQuery.data, primaryLocationId, selectedId]);

  const start = useMutation({
    mutationFn: async (locationId: string) => {
      const loc = await captureAttendanceLocation();
      if (!loc.ok) {
        throw { flexible: { code: loc.reason, message: CAPTURE_FAILURE_MESSAGE[loc.reason] } };
      }
      return manualClockInFlexible(locationId, {
        timestamp: new Date().toISOString(),
        latitude: loc.latitude, longitude: loc.longitude, accuracy: loc.accuracy,
        capturedAt: loc.capturedAt, mockLocationSuspected: loc.mockLocationSuspected,
        locationSource: 'MANUAL',
      });
    },
    onMutate: () => setError(null),
    onSuccess: async (res) => {
      const next: FlexibleSession = {
        shiftId: res.shiftId, kind: 'FLEXIBLE', status: res.status,
        clockInAt: res.clockInAt, location: res.location,
      };
      // The new timesheet must be in the cache BEFORE the session appears, or
      // useClockStatus (which derives "clocked in" from timesheets) would show
      // "Clock In" for a moment on a session that is already open.
      await queryClient.invalidateQueries({ queryKey: ['timesheets'] });
      queryClient.setQueryData(['flexible-session'], next);
      await startAttendanceMonitoring(next.shiftId).catch(() => {});
    },
    onError: async (e: unknown) => {
      const local = (e as { flexible?: { code: ClockError['code']; message: string } }).flexible;
      if (local) { setError(local); return; }
      if (isNetworkError(e)) {
        // Never fake a clock-in the server hasn't accepted.
        setError({ code: 'NO_CONNECTION', message: 'No connection. Connect to the internet to clock in.' });
        return;
      }
      const resp = (e as {
        response?: { data?: { code?: ClockError['code']; message?: string; activeShiftId?: string; details?: { distanceMeters?: number; geofenceRadius?: number } } };
      }).response;
      if (resp?.data?.code === 'ACTIVE_SESSION_EXISTS') {
        // Already clocked in (another device, or a retry) — just resume it.
        await queryClient.invalidateQueries({ queryKey: ['flexible-session'] });
      }
      setError({
        code: resp?.data?.code || 'SERVER_ERROR',
        message: resp?.data?.message || apiErrorMessage(e, 'Could not clock in'),
        distanceMeters: resp?.data?.details?.distanceMeters,
        geofenceRadius: resp?.data?.details?.geofenceRadius,
      });
    },
  });

  const startSession = useCallback(() => {
    if (!selectedId) {
      setError({ code: 'FLEXIBLE_LOCATION_REQUIRED', message: 'Choose where you are working to clock in.' });
      return;
    }
    start.mutate(selectedId);
  }, [selectedId, start]);

  return {
    session,
    clockable: clockableFromSession(session),
    options,
    optionsLoading: optionsQuery.isLoading,
    selectedId,
    selectLocation: (id: string) => { setSelectedId(id); setError(null); },
    startSession,
    isStarting: start.isPending,
    isLoading: enabled && sessionQuery.isLoading,
    error,
  };
}
