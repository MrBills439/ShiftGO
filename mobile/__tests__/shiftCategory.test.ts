import { categorizeShift } from '../lib/shiftCategory';
import type { Shift } from '../types';

const NOW = Date.parse('2026-09-07T12:00:00Z');

function mkShift(over: Partial<Shift>): Shift {
  return {
    id: 's1',
    houseId: 'h1',
    locationId: null,
    kind: 'ROTA',
    workerId: 'w1',
    startTime: '2026-09-07T09:00:00Z',
    endTime: '2026-09-07T17:00:00Z',
    date: '2026-09-07T00:00:00Z',
    shiftType: 'LONG_DAY',
    status: 'SCHEDULED',
    eligibleRoles: [],
    cancelledAt: null,
    cancelledById: null,
    cancellationReason: null,
    house: { id: 'h1', name: 'Elm House' } as Shift['house'],
    location: null,
    ...over,
  };
}

describe('categorizeShift', () => {
  test('assigned, not started, in the future -> upcoming', () => {
    const s = mkShift({ startTime: '2026-09-07T18:00:00Z', endTime: '2026-09-08T02:00:00Z', status: 'SCHEDULED' });
    expect(categorizeShift(s, NOW)).toBe('upcoming');
  });

  test('clocked in (timesheet.clockInAt, no clockOutAt) -> active, NOT upcoming', () => {
    const s = mkShift({
      status: 'IN_PROGRESS',
      timesheet: { id: 't1', clockInAt: '2026-09-07T09:05:00Z', clockOutAt: null, totalHours: null, status: 'PENDING', reviewedAt: null },
    });
    expect(categorizeShift(s, NOW)).toBe('active');
  });

  test('in its time window but not clocked in -> still upcoming (late), not active', () => {
    const s = mkShift({ startTime: '2026-09-07T09:00:00Z', endTime: '2026-09-07T17:00:00Z', status: 'SCHEDULED', timesheet: null });
    expect(categorizeShift(s, NOW)).toBe('upcoming');
  });

  test('clocked out -> past', () => {
    const s = mkShift({
      status: 'COMPLETED',
      timesheet: { id: 't1', clockInAt: '2026-09-07T09:00:00Z', clockOutAt: '2026-09-07T16:30:00Z', totalHours: 7.5, status: 'PENDING', reviewedAt: null },
    });
    expect(categorizeShift(s, NOW)).toBe('past');
  });

  test('COMPLETED status with no timesheet -> past', () => {
    expect(categorizeShift(mkShift({ status: 'COMPLETED', timesheet: null }), NOW)).toBe('past');
  });

  test('time window fully elapsed, never clocked in -> past', () => {
    const s = mkShift({ startTime: '2026-09-06T09:00:00Z', endTime: '2026-09-06T17:00:00Z', status: 'SCHEDULED', timesheet: null });
    expect(categorizeShift(s, NOW)).toBe('past');
  });

  test('still clocked in past the scheduled end -> active, not past', () => {
    const s = mkShift({
      startTime: '2026-09-07T03:00:00Z', endTime: '2026-09-07T11:00:00Z',
      status: 'IN_PROGRESS',
      timesheet: { id: 't1', clockInAt: '2026-09-07T03:02:00Z', clockOutAt: null, totalHours: null, status: 'PENDING', reviewedAt: null },
    });
    expect(categorizeShift(s, NOW)).toBe('active');
  });

  test('cancelled -> other (shown nowhere)', () => {
    expect(categorizeShift(mkShift({ status: 'CANCELLED' }), NOW)).toBe('other');
  });
});
