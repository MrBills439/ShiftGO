const mockPost = jest.fn();
const mockGet = jest.fn();
jest.mock('../services/api', () => ({
  api: { post: (...a: unknown[]) => mockPost(...a), get: (...a: unknown[]) => mockGet(...a) },
}));

import {
  manualClockIn, manualClockOut, reportLocation, confirmStillWorking, getAttendanceState,
} from '../services/clockService';
import { attendanceTargetFor, attendanceTargetIds } from '../lib/attendanceTarget';
import type { Shift } from '../types';

const rotaShift: Pick<Shift, 'house' | 'location'> = {
  house: { id: 'h1', name: 'Elm House', address: '1 Elm St', latitude: 51.5, longitude: -0.12, geofenceRadius: 50, autoConfirm: false },
  location: null,
};
const fixedShift: Pick<Shift, 'house' | 'location'> = {
  house: null,
  location: { id: 'loc1', name: 'Head Office', type: 'OFFICE', address: '10 High St', latitude: 51.6, longitude: -0.2, geofenceRadius: 40 },
};

beforeEach(() => {
  mockPost.mockReset();
  mockGet.mockReset();
  mockPost.mockResolvedValue({ data: { data: {} } });
  mockGet.mockResolvedValue({ data: { data: {} } });
});

describe('manualClockIn / manualClockOut — request shape', () => {
  // 6. ROTA clock-in request remains compatible (still sends houseId, no locationId).
  test('a ROTA clock-in sends shiftId + houseId, no locationId', async () => {
    const ids = attendanceTargetIds(attendanceTargetFor(rotaShift));
    await manualClockIn('shift-1', { ...ids, latitude: 51.5, longitude: -0.12 });
    expect(mockPost).toHaveBeenCalledWith('/clock/in', expect.objectContaining({
      shiftId: 'shift-1', houseId: 'h1', latitude: 51.5, longitude: -0.12,
    }));
    expect(mockPost.mock.calls[0][1]).not.toHaveProperty('locationId');
  });

  // 7 & 8. FIXED clock-in uses the shift/location target, and never invents a houseId.
  test('a FIXED clock-in sends shiftId + locationId, never a fake houseId', async () => {
    const ids = attendanceTargetIds(attendanceTargetFor(fixedShift));
    await manualClockIn('shift-2', { ...ids, latitude: 51.6, longitude: -0.2 });
    expect(mockPost).toHaveBeenCalledWith('/clock/in', expect.objectContaining({
      shiftId: 'shift-2', locationId: 'loc1', latitude: 51.6, longitude: -0.2,
    }));
    expect(mockPost.mock.calls[0][1]).not.toHaveProperty('houseId');
  });

  // 9. ROTA clock-out remains compatible.
  test('a ROTA clock-out sends shiftId + houseId', async () => {
    const ids = attendanceTargetIds(attendanceTargetFor(rotaShift));
    await manualClockOut('shift-1', { ...ids, latitude: 51.5, longitude: -0.12 });
    expect(mockPost).toHaveBeenCalledWith('/clock/out', expect.objectContaining({ shiftId: 'shift-1', houseId: 'h1' }));
  });

  // 10. FIXED clock-out works with the Location target.
  test('a FIXED clock-out sends shiftId + locationId', async () => {
    const ids = attendanceTargetIds(attendanceTargetFor(fixedShift));
    await manualClockOut('shift-2', { ...ids });
    expect(mockPost).toHaveBeenCalledWith('/clock/out', expect.objectContaining({ shiftId: 'shift-2', locationId: 'loc1' }));
    expect(mockPost.mock.calls[0][1]).not.toHaveProperty('houseId');
  });

  // A shift with no resolvable target (FLEXIBLE) sends neither id — nothing to
  // clock against, matching attendanceTargetFor returning null for it.
  test('a shift with no target sends neither houseId nor locationId', async () => {
    const ids = attendanceTargetIds(attendanceTargetFor({ house: null, location: null }));
    await manualClockIn('shift-3', { ...ids, latitude: 1, longitude: 1 });
    const body = mockPost.mock.calls[0][1];
    expect(body).not.toHaveProperty('houseId');
    expect(body).not.toHaveProperty('locationId');
  });
});

describe('background / report-location flow does not require House', () => {
  // 12. report-location has no House dependency at all — shiftId only.
  test('reportLocation posts shiftId + coordinates, with no houseId field', async () => {
    await reportLocation('shift-2', { latitude: 51.6, longitude: -0.2, accuracy: 8 });
    expect(mockPost).toHaveBeenCalledWith('/clock/location', expect.objectContaining({
      shiftId: 'shift-2', latitude: 51.6, longitude: -0.2,
    }));
    expect(mockPost.mock.calls[0][1]).not.toHaveProperty('houseId');
  });

  // 13. still-working flow is shift-scoped only — remains functional for FIXED.
  test('confirmStillWorking posts shiftId only, with no houseId field', async () => {
    await confirmStillWorking('shift-2');
    expect(mockPost).toHaveBeenCalledWith('/clock/still-working', { shiftId: 'shift-2' });
  });

  // 11. current attendance state has no House-only fields — renders FIXED correctly.
  test('getAttendanceState reads by shiftId only, with no houseId field', async () => {
    mockGet.mockResolvedValueOnce({
      data: {
        data: {
          clockedIn: true, monitorActive: true, locationStatus: 'ONSITE',
          geofenceExitConfirmed: false, stillWorkingConfirmed: false,
          shiftEndAcknowledged: false, reportIntervalMs: 60000,
        },
      },
    });
    const state = await getAttendanceState('shift-2');
    expect(mockGet).toHaveBeenCalledWith('/clock/state', { params: { shiftId: 'shift-2' } });
    expect(state.clockedIn).toBe(true);
    expect(state).not.toHaveProperty('houseId');
  });
});
