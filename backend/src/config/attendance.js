/**
 * Attendance / geofence configuration.
 *
 * Every tunable in the GPS attendance system lives here — no magic numbers in
 * services or jobs. `attendanceConfigFor()` is the seam for future per-agency /
 * per-house overrides; today it returns the defaults merged with the house's own
 * `geofenceRadius`.
 */

const DEFAULTS = Object.freeze({
  // ── Geofence ──────────────────────────────────────────────────────────────
  /** Fallback radius (metres) when a house has none configured. */
  defaultGeofenceRadiusM: parseInt(process.env.GEOFENCE_DEFAULT_RADIUS || '50', 10),
  /** Extra slack added to the radius when deciding "inside", capped so a wildly
   *  inaccurate fix can't buy its way in. Effective inside test:
   *  distance <= radius + min(accuracy, accuracySlackCapM). */
  accuracySlackCapM: 50,
  /** A reading worse than this (metres) cannot verify ANY geofence decision. */
  maxAccuracyForGeofenceM: 100,

  // ── Location freshness ────────────────────────────────────────────────────
  /** A device fix older than this (ms) at submission time is "stale". */
  maxLocationAgeMs: 60_000,
  /** Coordinates of exactly (0,0) are almost always a null-island bug. */
  rejectNullIsland: true,

  // ── Geofence-exit debounce (while clocked in) ─────────────────────────────
  /** Consecutive OUTSIDE readings required before an exit is "confirmed". */
  exitConfirmReadings: 3,
  /** Max gap (ms) between those readings for them to count as consecutive. */
  exitConfirmWindowMs: 6 * 60_000,
  /** After a worker says "yes, still working", suppress exit prompts for this long. */
  offsitePromptSnoozeMs: 15 * 60_000,
  /** How often the mobile app should report a location while clocked in. */
  locationReportIntervalMs: 60_000,

  // ── Shift-end / auto-clock-out grace machine ─────────────────────────────
  /** Grace after a *confirmed* post-shift-end exit before the FIRST reminder. */
  autoClockOutReminderMs: 5 * 60_000,
  /** Total grace after a confirmed post-shift-end exit before auto clock-out. */
  autoClockOutGraceMs: 10 * 60_000,
  /** A monitor reading older than this can't justify an auto clock-out — flag
   *  the timesheet for review instead. */
  autoClockOutMaxEvidenceAgeMs: 15 * 60_000,
  /** Grace either side of the scheduled window for manual clock in/out. */
  shiftWindowGraceMs: 30 * 60_000,
});

/**
 * Resolve the effective config for an attendance target (see
 * services/attendanceTargetService). A target exposes `geofenceRadius` with the
 * same meaning a House's own `geofenceRadius` had, so a House-backed target
 * yields byte-identical output to the previous House-only behaviour; a target
 * with no radius falls back to the default. This is still the seam for future
 * per-agency / per-location overrides.
 * @param {{ geofenceRadius?: number|null }} [target]
 */
function attendanceConfigFor(target = {}) {
  const radius =
    Number.isFinite(target.geofenceRadius) && target.geofenceRadius > 0
      ? target.geofenceRadius
      : DEFAULTS.defaultGeofenceRadiusM;
  return { ...DEFAULTS, geofenceRadiusM: radius };
}

module.exports = { ATTENDANCE_DEFAULTS: DEFAULTS, attendanceConfigFor };
