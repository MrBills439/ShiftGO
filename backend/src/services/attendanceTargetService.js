/**
 * Attendance Target resolver — Location Attendance Target V1.
 *
 * Normalises "where is this shift worked, and what geofence applies" into ONE
 * internal shape so geofence evaluation, attendance config, and clock/attendance
 * messages never dereference a `House` (or, in a future phase, a `Location`)
 * directly.
 *
 * For every shift the current code creates this returns a HOUSE target built
 * from `shift.house` — the House's own latitude / longitude / geofenceRadius,
 * which stay authoritative for care clock-in. The LOCATION branch is foundation
 * only: `Shift.houseId` is still required and no production API sets
 * `Shift.locationId`, so that branch is currently unreachable outside direct
 * unit tests.
 *
 * House ALWAYS wins when both a house and a location are present — existing ROTA
 * attendance must never silently move onto a Location geofence.
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

module.exports = { attendanceTargetFor };
