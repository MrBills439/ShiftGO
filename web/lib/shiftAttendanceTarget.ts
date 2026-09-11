import type { Shift } from '@/types';

export type AttendanceTargetKind = 'HOUSE' | 'LOCATION';

/**
 * Everything the scheduling UI needs to display a shift, resolved from
 * whichever of `house`/`location` it actually carries. Mirrors the backend's
 * attendanceTargetFor (backend/src/services/attendanceTargetService.js) and
 * the mobile app's lib/attendanceTarget.ts, so the whole system agrees on
 * "where is this shift worked".
 */
export interface ShiftAttendanceTarget {
  kind: AttendanceTargetKind;
  id: string;
  name: string;
  address: string | null;
  /** Neutral copy for the two target kinds — never the word "House" for a
   *  Location target, so office scheduling never shows care wording. */
  label: 'House' | 'Location';
}

/**
 * Resolve a shift's ONE attendance target. A ROTA shift carries `house`; a
 * FIXED shift carries `location`; House wins if both were ever present
 * (defensive — the backend guarantees exactly one). Returns null only for a
 * shift with neither, which should not happen for anything this UI renders.
 */
export function shiftAttendanceTarget(
  shift: Pick<Shift, 'house' | 'location'> | null | undefined,
): ShiftAttendanceTarget | null {
  if (!shift) return null;
  if (shift.house) {
    return {
      kind: 'HOUSE',
      id: shift.house.id,
      name: shift.house.name,
      address: shift.house.address ?? null,
      label: 'House',
    };
  }
  if (shift.location) {
    return {
      kind: 'LOCATION',
      id: shift.location.id,
      name: shift.location.name,
      address: shift.location.address ?? null,
      label: 'Location',
    };
  }
  return null;
}

/** Display name for a shift's target, with a safe fallback — never throws on
 *  `house`/`location` both being null. */
export function shiftAttendanceTargetName(
  shift: Pick<Shift, 'house' | 'location'> | null | undefined,
  fallback = 'Unknown location',
): string {
  return shiftAttendanceTarget(shift)?.name ?? fallback;
}
