import { api } from './api';

type ManualClockPayload = {
  timestamp?: string;
  latitude?: number;
  longitude?: number;
  accuracy?: number;
  reason?: string;
  locationSource?: 'MANUAL' | 'OFFLINE_SYNC';
};

export async function manualClockIn(houseId: string, shiftId: string, payload: ManualClockPayload = {}) {
  const { data } = await api.post('/clock/in', { houseId, shiftId, ...payload });
  return data.data;
}

export async function manualClockOut(houseId: string, shiftId: string, payload: ManualClockPayload = {}) {
  const { data } = await api.post('/clock/out', { houseId, shiftId, ...payload });
  return data.data;
}

export async function autoCheckin(latitude: number, longitude: number, accuracy?: number | null) {
  const { data } = await api.post('/clock/auto-checkin', { latitude, longitude, accuracy });
  return data.data;
}

export async function geofenceExit(latitude: number, longitude: number, accuracy?: number | null) {
  const { data } = await api.post('/clock/geofence-exit', { latitude, longitude, accuracy });
  return data.data;
}

export async function getMyShifts() {
  const { data } = await api.get('/shifts');
  return data.data;
}

export async function getMyTimesheets() {
  const { data } = await api.get('/timesheets/me');
  return data.data;
}
