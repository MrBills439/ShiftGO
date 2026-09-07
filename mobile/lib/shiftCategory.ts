import type { Shift } from '../types';

export type ShiftCategory = 'active' | 'upcoming' | 'past' | 'other';

/**
 * Categorise one of the worker's OWN shifts from its real attendance/shift
 * state — not device time alone.
 *
 *  active   — clocked in and not yet clocked out (or shift status IN_PROGRESS).
 *  past     — clocked out, or shift COMPLETED, or its time window has fully passed.
 *  upcoming — assigned, not started and not clocked into.
 *  other    — cancelled (shown in no list).
 */
export function categorizeShift(shift: Shift, nowMs: number = Date.now()): ShiftCategory {
  if (shift.status === 'CANCELLED') return 'other';
  const ts = shift.timesheet;
  if (ts?.clockOutAt || shift.status === 'COMPLETED') return 'past';
  if (ts?.clockInAt || shift.status === 'IN_PROGRESS') return 'active';
  if (new Date(shift.endTime).getTime() < nowMs) return 'past';
  return 'upcoming';
}
