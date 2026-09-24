import { api } from './api';
import type { FlexibleSession, LocationOption } from '../types';

export type ClockLocation = {
  latitude?: number;
  longitude?: number;
  accuracy?: number | null;
  capturedAt?: string;
  mockLocationSuspected?: boolean;
};

type ManualClockPayload = ClockLocation & {
  timestamp?: string;
  reason?: string;
  locationSource?: 'MANUAL' | 'OFFLINE_SYNC';
  // Consistency check only — the backend Shift itself decides the real
  // attendance target. Send whichever one lib/attendanceTarget.ts resolved for
  // this shift (houseId for ROTA, locationId for FIXED); never fabricate one.
  houseId?: string;
  locationId?: string;
};

export type AttendancePrompt =
  | 'LEFT_GEOFENCE_STILL_WORKING'
  | 'SHIFT_ENDED_STILL_ONSITE'
  | 'SHIFT_ENDED_AND_LEFT';

export async function manualClockIn(shiftId: string, payload: ManualClockPayload = {}) {
  const { data } = await api.post('/clock/in', { shiftId, ...payload });
  return data.data;
}

/**
 * FLEXIBLE clock-in: no shift exists yet, so this names a work Location instead
 * of a shiftId. The backend decides eligibility from the employee's own
 * workPatternType — nothing sent here can make an employee FLEXIBLE.
 */
export async function manualClockInFlexible(locationId: string, payload: ManualClockPayload = {}) {
  const { data } = await api.post('/clock/in', { locationId, ...payload });
  return data.data as FlexibleSession & { monitorStarted: boolean };
}

/** The caller's open FLEXIBLE session, or null — how the app rediscovers it
 *  after a restart. */
export async function getActiveFlexibleSession() {
  const { data } = await api.get('/clock/active-session');
  return (data.data?.session ?? null) as FlexibleSession | null;
}

/** Active work Locations of the caller's agency (any signed-in user may read
 *  this id+name list; it exposes no coordinates). */
export async function getLocationOptions() {
  const { data } = await api.get('/locations/options');
  return data.data as LocationOption[];
}

export async function manualClockOut(shiftId: string, payload: ManualClockPayload = {}) {
  const { data } = await api.post('/clock/out', { shiftId, ...payload });
  return data.data;
}

/** Periodic report while clocked in. The server decides everything; the response
 *  tells the app whether to keep monitoring and which prompt (if any) to show. */
export async function reportLocation(shiftId: string, loc: Required<Pick<ClockLocation, 'latitude' | 'longitude'>> & ClockLocation) {
  const { data } = await api.post('/clock/location', { shiftId, ...loc });
  return data.data as {
    active: boolean;
    accepted?: boolean;
    reason?: string;
    code?: string;
    locationStatus?: 'ONSITE' | 'OFFSITE' | 'UNKNOWN';
    prompt?: AttendancePrompt | null;
    reportIntervalMs?: number;
  };
}

/** "Yes, I'm still working" — from a geofence-exit or shift-end prompt. */
export async function confirmStillWorking(shiftId: string) {
  const { data } = await api.post('/clock/still-working', { shiftId });
  return data.data as { active: boolean; snoozedUntil?: string; shiftEndedAcknowledged?: boolean };
}

/** Snapshot for reconciling background monitoring on app launch / resume. */
export async function getAttendanceState(shiftId: string) {
  const { data } = await api.get('/clock/state', { params: { shiftId } });
  return data.data as {
    clockedIn: boolean;
    monitorActive: boolean;
    locationStatus: 'ONSITE' | 'OFFSITE' | 'UNKNOWN';
    geofenceExitConfirmed: boolean;
    stillWorkingConfirmed: boolean;
    shiftEndAcknowledged: boolean;
    reportIntervalMs: number | null;
  };
}

/**
 * The signed-in employee's OWN scheduled shifts (ROTA / FIXED), whatever their
 * system role. `mine=true` is the explicit self-service mode: without it GET
 * /shifts is role-scoped for administration (a manager gets their houses'
 * shifts, HR the whole agency), which is wrong for "what am I working". The
 * server takes the employee from the auth token — no workerId is ever sent.
 */
export async function getMyShifts() {
  const { data } = await api.get('/shifts', { params: { mine: true } });
  return data.data;
}

export async function getMyTimesheets() {
  const { data } = await api.get('/timesheets/me');
  return data.data;
}
