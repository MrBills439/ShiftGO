/**
 * Attendance Target resolver — Location Attendance Target V1, extended by
 * Location-Backed Shift V1 and Location-Backed Attendance Records V1.
 *
 * Normalises "where is this shift worked, and what geofence applies" into ONE
 * internal shape so geofence evaluation, attendance config, and clock/attendance
 * messages never dereference a `House` or a `Location` directly.
 *
 * A ROTA shift resolves to a HOUSE target built from `shift.house` — the
 * House's own latitude / longitude / geofenceRadius, which stay authoritative
 * for care clock-in. A FIXED shift resolves to a LOCATION target built from
 * `shift.location`. `shiftService.assertShiftAttendanceTarget` guarantees a
 * Shift never has both or neither, so this resolver never has to choose
 * between two present targets in real data — House winning when both are
 * present is a defensive rule, not something normal writes rely on.
 *
 * Pure function: it reads only relations already loaded on the passed shift
 * (which the caller looked up tenant-scoped via `where: { agencyId }`). It does
 * NO database I/O and never consults request data, so it cannot cross a tenant
 * boundary. A future caller that resolves a `Location` itself MUST scope that
 * lookup to `location.id` + `shift.agencyId`.
 *
 * @param {{ house?: object|null, location?: object|null }} shift a loaded Shift
 *   (or Shift-like) with `house` and optionally `location` included.
 * @returns {{
 *   type: 'HOUSE' | 'LOCATION',
 *   id: string,
 *   name: string,
 *   latitude: number | null,
 *   longitude: number | null,
 *   geofenceRadius: number | null,
 *   timezone: string | null,
 * } | null}
 */
function attendanceTargetFor(shift) {
  const house = shift && shift.house;
  if (house) {
    return {
      type: 'HOUSE',
      id: house.id,
      name: house.name,
      latitude: house.latitude,
      longitude: house.longitude,
      geofenceRadius: house.geofenceRadius,
      // House has no timezone column — care attendance inherits the agency
      // timezone exactly as before. Nothing in attendance config reads this.
      timezone: null,
    };
  }

  const location = shift && shift.location;
  if (location) {
    return {
      type: 'LOCATION',
      id: location.id,
      name: location.name,
      latitude: location.latitude ?? null,
      longitude: location.longitude ?? null,
      geofenceRadius: location.geofenceRadius ?? null,
      timezone: location.timezone ?? null,
    };
  }

  return null;
}

/**
 * Location-Backed Attendance Records V1 — the single place that turns a
 * resolved attendance target into the `{ houseId, locationId }` pair written
 * onto ClockEvent / AttendanceMonitor / Timesheet, so no write site
 * duplicates the "exactly one, matching the target type" logic.
 *
 * @param {ReturnType<typeof attendanceTargetFor>} target
 * @returns {{ houseId: string|null, locationId: string|null }}
 */
function attendanceTargetFields(target) {
  if (!target) return { houseId: null, locationId: null };
  return target.type === 'LOCATION'
    ? { houseId: null, locationId: target.id }
    : { houseId: target.id, locationId: null };
}

module.exports = { attendanceTargetFor, attendanceTargetFields };
