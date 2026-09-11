import type { Shift } from '../types';

export type AttendanceTargetKind = 'HOUSE' | 'LOCATION';

/**
 * Everything the attendance UI needs to display and clock a shift, resolved
 * from whichever of `house`/`location` the Shift actually carries. Mirrors the
 * backend's attendanceTargetFor (services/attendanceTargetService.js) so the
 * mobile app and the API agree on "where is this shift worked".
 */
export interface ShiftAttendanceTarget {
  kind: AttendanceTargetKind;
  id: string;
  name: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  /** Neutral copy for the two target kinds — never the word "House" for a
   *  Location target, so office staff never see care wording. */
  label: 'House' | 'Location';
}

/**
 * Resolve a shift's ONE attendance target. A ROTA shift carries `house`; a
 * FIXED shift carries `location`; House wins if both were ever present
 * (defensive — the backend guarantees exactly one). Returns null only for a
 * shift with neither (should not happen for anything the app can render as
 * clockable, but every caller must handle it without crashing).
 */
export function attendanceTargetFor(
  shift: Pick<Shift, 'house' | 'location'> | null | undefined,
): ShiftAttendanceTarget | null {
  if (!shift) return null;
  if (shift.house) {
    return {
      kind: 'HOUSE',
      id: shift.house.id,
      name: shift.house.name,
      address: shift.house.address ?? null,
      latitude: shift.house.latitude ?? null,
      longitude: shift.house.longitude ?? null,
      label: 'House',
    };
  }
  if (shift.location) {
    return {
      kind: 'LOCATION',
      id: shift.location.id,
      name: shift.location.name,
      address: shift.location.address ?? null,
      latitude: shift.location.latitude ?? null,
      longitude: shift.location.longitude ?? null,
      label: 'Location',
    };
  }
  return null;
}

/** Display name for a shift's target, with a safe fallback — never throws on
 *  `house`/`location` both being null. */
export function attendanceTargetName(
  shift: Pick<Shift, 'house' | 'location'> | null | undefined,
  fallback = 'your shift',
): string {
  return attendanceTargetFor(shift)?.name ?? fallback;
}

/** The `{ houseId, locationId }` consistency-check pair to send on a clock
 *  request — the backend Shift is always authoritative; this is never used to
 *  pick the target, only to catch an app/server disagreement early. */
export function attendanceTargetIds(target: ShiftAttendanceTarget | null): {
  houseId?: string;
  locationId?: string;
} {
  if (!target) return {};
  return target.kind === 'HOUSE' ? { houseId: target.id } : { locationId: target.id };
}
