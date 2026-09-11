import { attendanceTargetFor, attendanceTargetName, attendanceTargetIds } from '../lib/attendanceTarget';
import type { Shift } from '../types';

// Mobile FIXED Attendance V1 — the one place a Shift's House-or-Location
// target is resolved for display and for the clock-in/out request.

const rotaShift: Pick<Shift, 'house' | 'location'> = {
  house: {
    id: 'h1', name: 'Elm House', address: '1 Elm St', latitude: 51.5, longitude: -0.12,
    geofenceRadius: 50, autoConfirm: false,
  },
  location: null,
};

const fixedShift: Pick<Shift, 'house' | 'location'> = {
  house: null,
  location: {
    id: 'loc1', name: 'Head Office', type: 'OFFICE', address: '10 High St',
    latitude: 51.6, longitude: -0.2, geofenceRadius: 40,
  },
};

const noTargetShift: Pick<Shift, 'house' | 'location'> = { house: null, location: null };

describe('attendanceTargetFor', () => {
  // 1. ROTA target helper returns House.
  test('a ROTA (House-backed) shift resolves to a HOUSE target', () => {
    const target = attendanceTargetFor(rotaShift);
    expect(target).toEqual({
      kind: 'HOUSE', id: 'h1', name: 'Elm House', address: '1 Elm St',
      latitude: 51.5, longitude: -0.12, label: 'House',
    });
  });

  // 2. FIXED target helper returns Location.
  test('a FIXED (Location-backed) shift resolves to a LOCATION target', () => {
    const target = attendanceTargetFor(fixedShift);
    expect(target).toEqual({
      kind: 'LOCATION', id: 'loc1', name: 'Head Office', address: '10 High St',
      latitude: 51.6, longitude: -0.2, label: 'Location',
    });
  });

  test('House wins when (defensively) both are present', () => {
    const target = attendanceTargetFor({ house: rotaShift.house, location: fixedShift.location });
    expect(target?.kind).toBe('HOUSE');
  });

  // 5. Neither house nor location present never crashes — returns null.
  test('neither house nor location resolves to null, not a crash', () => {
    expect(attendanceTargetFor(noTargetShift)).toBeNull();
    expect(attendanceTargetFor(null)).toBeNull();
    expect(attendanceTargetFor(undefined)).toBeNull();
  });

  test('label is never "House" for a Location target (no care wording for office staff)', () => {
    expect(attendanceTargetFor(fixedShift)?.label).toBe('Location');
    expect(attendanceTargetFor(fixedShift)?.label).not.toBe('House');
  });
});

describe('attendanceTargetName — what shift cards actually render', () => {
  // 3. ROTA shift card renders the House name.
  test('a ROTA shift card renders the House name', () => {
    expect(attendanceTargetName(rotaShift)).toBe('Elm House');
  });

  // 4. FIXED shift card renders the Location name.
  test('a FIXED shift card renders the Location name', () => {
    expect(attendanceTargetName(fixedShift)).toBe('Head Office');
  });

  // 5. (display side) a shift with house=null and no location never crashes and falls back cleanly.
  test('a shift with house=null and no location falls back without throwing', () => {
    expect(() => attendanceTargetName(noTargetShift)).not.toThrow();
    expect(attendanceTargetName(noTargetShift, 'your shift location')).toBe('your shift location');
  });
});

describe('attendanceTargetIds — the clock-request consistency-check pair', () => {
  // 8. FIXED clock requests never send a fake houseId.
  test('a HOUSE target sends houseId only, never locationId', () => {
    expect(attendanceTargetIds(attendanceTargetFor(rotaShift))).toEqual({ houseId: 'h1' });
  });

  test('a LOCATION target sends locationId only, never a fabricated houseId', () => {
    const ids = attendanceTargetIds(attendanceTargetFor(fixedShift));
    expect(ids).toEqual({ locationId: 'loc1' });
    expect(ids).not.toHaveProperty('houseId');
  });

  test('no target sends neither id', () => {
    expect(attendanceTargetIds(null)).toEqual({});
  });
});

// 14. FLEXIBLE is not offered as clockable — there is no HOUSE/LOCATION branch
// for it: a shift carrying neither house nor location (which is what a
// FLEXIBLE shift looks like today, since it has no clockable target at all)
// resolves to null, so the app has nothing to render a clock button against.
describe('FLEXIBLE is never offered as clockable', () => {
  test('a shift with no resolvable target (as FLEXIBLE has today) yields no target to clock against', () => {
    expect(attendanceTargetFor(noTargetShift)).toBeNull();
  });
});
