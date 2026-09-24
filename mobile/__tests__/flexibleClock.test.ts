const mockPost = jest.fn();
const mockGet = jest.fn();
jest.mock('../services/api', () => ({
  api: { post: (...a: unknown[]) => mockPost(...a), get: (...a: unknown[]) => mockGet(...a) },
}));

import {
  manualClockIn, manualClockOut, manualClockInFlexible, getActiveFlexibleSession, getLocationOptions,
} from '../services/clockService';
import {
  sortLocationsPrimaryFirst, defaultLocationId, clockableFromSession, elapsedLabel,
} from '../lib/flexibleClock';
import { attendanceTargetFor, attendanceTargetIds } from '../lib/attendanceTarget';
import type { FlexibleSession, LocationOption } from '../types';

const opts: LocationOption[] = [
  { id: 'l-annex', name: 'Annex', type: 'OFFICE' },
  { id: 'l-head', name: 'Head Office', type: 'OFFICE' },
  { id: 'l-depot', name: 'Depot', type: 'MAINTENANCE_BASE' },
];

const session: FlexibleSession = {
  shiftId: 'shift-flex-1', kind: 'FLEXIBLE', status: 'IN_PROGRESS',
  clockInAt: '2026-09-21T08:43:00.000Z', location: { id: 'l-head', name: 'Head Office' },
};

beforeEach(() => {
  mockPost.mockReset();
  mockGet.mockReset();
  mockPost.mockResolvedValue({ data: { data: {} } });
  mockGet.mockResolvedValue({ data: { data: {} } });
});

describe('location list ordering', () => {
  test('the primary location comes first, the rest alphabetically — nothing dropped', () => {
    const sorted = sortLocationsPrimaryFirst(opts, 'l-head');
    expect(sorted.map((o) => o.id)).toEqual(['l-head', 'l-annex', 'l-depot']);
    expect(sorted).toHaveLength(opts.length);
  });

  test('without a primary (or one that is not offered) it is simply alphabetical', () => {
    expect(sortLocationsPrimaryFirst(opts, null).map((o) => o.name)).toEqual(['Annex', 'Depot', 'Head Office']);
    expect(sortLocationsPrimaryFirst(opts, 'l-gone').map((o) => o.name)).toEqual(['Annex', 'Depot', 'Head Office']);
  });

  test('does not mutate the input array', () => {
    const copy = [...opts];
    sortLocationsPrimaryFirst(opts, 'l-head');
    expect(opts).toEqual(copy);
  });

  test('only the primary location is pre-selected; anything else is an explicit choice', () => {
    expect(defaultLocationId(opts, 'l-head')).toBe('l-head');
    expect(defaultLocationId(opts, null)).toBeNull();
    expect(defaultLocationId(opts, 'l-gone')).toBeNull();
  });
});

describe('FLEXIBLE clock-in / clock-out request shape', () => {
  test('a flexible clock-in names a locationId and sends NO shiftId', async () => {
    mockPost.mockResolvedValue({ data: { data: { ...session, monitorStarted: true } } });
    const res = await manualClockInFlexible('l-head', { latitude: 51.5, longitude: -0.12, accuracy: 9 });
    expect(mockPost).toHaveBeenCalledWith('/clock/in', expect.objectContaining({
      locationId: 'l-head', latitude: 51.5, longitude: -0.12, accuracy: 9,
    }));
    expect(mockPost.mock.calls[0][1]).not.toHaveProperty('shiftId');
    expect(mockPost.mock.calls[0][1]).not.toHaveProperty('houseId');
    expect(mockPost.mock.calls[0][1]).not.toHaveProperty('kind'); // the client never claims to be flexible
    expect(res.shiftId).toBe('shift-flex-1');
  });

  test('clock-out of the flexible session uses the shift id the server returned', async () => {
    const target = attendanceTargetFor(clockableFromSession(session));
    await manualClockOut(session.shiftId, { ...attendanceTargetIds(target), latitude: 51.5, longitude: -0.12 });
    expect(mockPost).toHaveBeenCalledWith('/clock/out', expect.objectContaining({
      shiftId: 'shift-flex-1', locationId: 'l-head',
    }));
    expect(mockPost.mock.calls[0][1]).not.toHaveProperty('houseId');
  });

  test('the active session is read from /clock/active-session, null when none', async () => {
    mockGet.mockResolvedValueOnce({ data: { data: { session } } });
    expect(await getActiveFlexibleSession()).toEqual(session);
    expect(mockGet).toHaveBeenCalledWith('/clock/active-session');
    mockGet.mockResolvedValueOnce({ data: { data: { session: null } } });
    expect(await getActiveFlexibleSession()).toBeNull();
  });

  test('location options come from the employee-safe /locations/options', async () => {
    mockGet.mockResolvedValueOnce({ data: { data: opts } });
    expect(await getLocationOptions()).toEqual(opts);
    expect(mockGet).toHaveBeenCalledWith('/locations/options');
  });

  test('ROTA / FIXED clock-in still requires and sends a shiftId', async () => {
    await manualClockIn('shift-1', { houseId: 'h1' });
    expect(mockPost).toHaveBeenCalledWith('/clock/in', expect.objectContaining({ shiftId: 'shift-1', houseId: 'h1' }));
    expect(mockPost.mock.calls[0][1]).not.toHaveProperty('locationId');
  });
});

describe('FLEXIBLE session adapter', () => {
  test('resolves to a LOCATION attendance target and never a House', () => {
    const clockable = clockableFromSession(session)!;
    expect(clockable.id).toBe('shift-flex-1');
    expect(clockable.house).toBeNull();
    const target = attendanceTargetFor(clockable);
    expect(target).toMatchObject({ kind: 'LOCATION', id: 'l-head', name: 'Head Office', label: 'Location' });
    expect(attendanceTargetIds(target)).toEqual({ locationId: 'l-head' });
  });

  test('no session → nothing to clock', () => {
    expect(clockableFromSession(null)).toBeNull();
  });
});

describe('elapsedLabel', () => {
  const start = '2026-09-21T08:43:00.000Z';
  const at = (mins: number) => new Date(start).getTime() + mins * 60_000;
  test('formats minutes and hours since clock-in', () => {
    expect(elapsedLabel(start, at(42))).toBe('42m');
    expect(elapsedLabel(start, at(60))).toBe('1h 0m');
    expect(elapsedLabel(start, at(8 * 60 + 15))).toBe('8h 15m');
  });
  test('never negative if the device clock is slightly behind', () => {
    expect(elapsedLabel(start, at(-5))).toBe('0m');
  });
});
