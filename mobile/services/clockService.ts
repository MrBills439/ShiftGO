import { api } from './api';

export async function manualClockIn(houseId: string, shiftId: string) {
  const { data } = await api.post('/clock/in', { houseId, shiftId });
  return data.data;
}

export async function manualClockOut(houseId: string, shiftId: string) {
  const { data } = await api.post('/clock/out', { houseId, shiftId });
  return data.data;
}

export async function autoCheckin(latitude: number, longitude: number) {
  const { data } = await api.post('/clock/auto-checkin', { latitude, longitude });
  return data.data;
}

export async function geofenceExit(latitude: number, longitude: number) {
  const { data } = await api.post('/clock/geofence-exit', { latitude, longitude });
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
