import { api } from './api';

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

export async function getMyShifts() {
  const { data } = await api.get('/shifts');
  return data.data;
}

export async function getMyTimesheets() {
  const { data } = await api.get('/timesheets/me');
  return data.data;
}
