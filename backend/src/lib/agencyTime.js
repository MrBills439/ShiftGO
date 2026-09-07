/**
 * Agency-day time helpers.
 *
 * An agency's operational "day" is defined by its configured IANA timezone
 * (Agency.timezone), NOT by the server's timezone (UTC on Railway) nor the
 * browser's. Everything that reasons about "today", a shift date, an
 * attendance day, a payroll period or a report bucket should go through here
 * so the boundary rules stay identical across features.
 *
 * No external dependency — uses the platform Intl timezone database.
 */

const DEFAULT_AGENCY_TIMEZONE = 'Europe/London';

const _validCache = new Map();

/** True if `tz` is a resolvable IANA timezone on this runtime. */
function isValidTimeZone(tz) {
  if (typeof tz !== 'string' || tz.length === 0) return false;
  if (_validCache.has(tz)) return _validCache.get(tz);
  let valid = true;
  try {
    // Throws RangeError for an unknown timezone.
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
  } catch {
    valid = false;
  }
  _validCache.set(tz, valid);
  return valid;
}

/** A usable timezone: the given one if valid, otherwise the pilot default. */
function resolveTimeZone(tz) {
  if (isValidTimeZone(tz)) return tz;
  if (tz != null && tz !== '') {
    console.warn(`[agencyTime] unknown timezone "${tz}" — falling back to ${DEFAULT_AGENCY_TIMEZONE}`);
  }
  return DEFAULT_AGENCY_TIMEZONE;
}

/**
 * Milliseconds to ADD to a UTC instant to get the wall-clock reading in `tz`
 * (i.e. `wallClockInterpretedAsUTC - actualUTC`). Positive east of UTC.
 */
function tzOffsetMs(tz, date) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p = {};
  for (const { type, value } of dtf.formatToParts(date)) p[type] = value;
  const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return asUTC - date.getTime();
}

/**
 * The UTC `Date` for a wall-clock time in `tz`. Two-pass so a wall time that
 * lands on/near a DST transition resolves to the correct instant. Month/day
 * overflow is handled by Date.UTC (so day = 32 rolls into the next month).
 */
function zonedWallTimeToUtc(tz, year, month, day, hour = 0, minute = 0, second = 0) {
  const wallAsUTC = Date.UTC(year, month - 1, day, hour, minute, second);
  let utc = wallAsUTC - tzOffsetMs(tz, new Date(wallAsUTC));
  utc = wallAsUTC - tzOffsetMs(tz, new Date(utc));
  return new Date(utc);
}

/** Calendar year/month/day of `instant` as seen in `tz`. */
function ymdInZone(tz, instant) {
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const [year, month, day] = dtf.format(instant).split('-').map(Number);
  return { year, month, day };
}

/**
 * The half-open UTC interval `[start, end)` bounding the agency calendar day
 * that contains `instant`, optionally shifted by whole days.
 *
 *   agencyDayRange('Europe/London', new Date('2025-07-15T09:00Z'))
 *     -> { start: 2025-07-14T23:00:00Z, end: 2025-07-15T23:00:00Z }   // BST
 *
 * @param {string} timeZone  IANA name; invalid/empty -> pilot default.
 * @param {Date}   [instant] reference instant (default: now).
 * @param {number} [offsetDays] 0 = that day, 1 = the next agency day, -1 = previous.
 * @returns {{ start: Date, end: Date, timeZone: string }}
 */
function agencyDayRange(timeZone, instant = new Date(), offsetDays = 0) {
  const tz = resolveTimeZone(timeZone);
  const { year, month, day } = ymdInZone(tz, instant);
  const start = zonedWallTimeToUtc(tz, year, month, day + offsetDays);
  const end = zonedWallTimeToUtc(tz, year, month, day + offsetDays + 1);
  return { start, end, timeZone: tz };
}

/**
 * The agency-day key ("YYYY-MM-DD") an instant falls in — stable string for
 * grouping/bucketing in reporting and payroll.
 */
function agencyDayKey(timeZone, instant = new Date()) {
  const tz = resolveTimeZone(timeZone);
  const { year, month, day } = ymdInZone(tz, instant);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

module.exports = {
  DEFAULT_AGENCY_TIMEZONE,
  isValidTimeZone,
  resolveTimeZone,
  tzOffsetMs,
  zonedWallTimeToUtc,
  ymdInZone,
  agencyDayRange,
  agencyDayKey,
};
