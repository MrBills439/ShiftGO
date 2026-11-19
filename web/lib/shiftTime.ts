/**
 * THE rule for shift times (both shift forms, edit pre-fill and display):
 *
 *   1. People type a date and wall-clock times in the AGENCY's timezone
 *      (Admin → Agency settings), never the browser's and never UTC.
 *   2. They are converted to real UTC instants for the API and the database.
 *   3. Stored instants are shown back in the agency's timezone.
 *   4. An end time before the start time means the next day (overnight).
 *      An end time EQUAL to the start time is a 24-hour shift, on purpose
 *      (e.g. 09:00 to 09:00 the next day); the forms say so before saving.
 *      Shifts are still checked against the agency's weekly hours limit.
 *   5. Daylight-saving transitions are explicit, never guessed:
 *        - a time that does not exist (clocks go forward) is refused;
 *        - a time that happens twice (clocks go back) must be chosen
 *          ("earlier" = before the change, "later" = after it).
 *
 * The backend uses the same algorithm (backend/src/lib/agencyTime.js
 * resolveWallTime) for shifts it generates itself.
 *
 * Self-contained (no imports) so `node --test` runs it directly.
 */

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const HOUR = 3_600_000;

export const DEFAULT_TIME_ZONE = 'Europe/London';

/** A usable IANA timezone: the given one if valid, otherwise Europe/London. */
export function safeTimeZone(tz: string | null | undefined): string {
  if (tz) {
    try {
      new Intl.DateTimeFormat('en-GB', { timeZone: tz });
      return tz;
    } catch { /* fall through */ }
  }
  return DEFAULT_TIME_ZONE;
}

function wallParts(tz: string, ms: number) {
  const parts: Record<string, string> = {};
  for (const { type, value } of new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(ms))) parts[type] = value;
  return parts;
}

/** Wall clock in `tz` minus UTC, in ms, at instant `ms`. */
function offsetAt(tz: string, ms: number): number {
  const p = wallParts(tz, ms);
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(ms / 1000) * 1000;
}

export type WallTimeResult =
  | { status: 'ok'; instant: Date }
  | { status: 'nonexistent' }
  | { status: 'ambiguous'; earlier: Date; later: Date };

/**
 * Every real instant at which the clocks in `tz` read `date` `time`.
 * 0 instants = skipped by a forward change; 2 = repeated by a backward change.
 */
export function resolveWallTime(tz: string, date: string, time: string): WallTimeResult {
  const d = DATE_RE.exec(date);
  const t = TIME_RE.exec(time);
  if (!d || !t) throw new Error(`Invalid date/time "${date} ${time}"`);
  const wall = Date.UTC(+d[1], +d[2] - 1, +d[3], +t[1], +t[2]);
  // At most one transition can fall within a day either side, so the offsets
  // in force 12h before and after cover every candidate.
  const offsets = [...new Set([offsetAt(tz, wall - 12 * HOUR), offsetAt(tz, wall + 12 * HOUR)])];
  const found = offsets
    .map((off) => wall - off)
    .filter((ms) => offsetAt(tz, ms) === wall - ms)
    .sort((a, b) => a - b);
  const unique = [...new Set(found)];
  if (unique.length === 0) return { status: 'nonexistent' };
  if (unique.length === 1) return { status: 'ok', instant: new Date(unique[0]) };
  return { status: 'ambiguous', earlier: new Date(unique[0]), later: new Date(unique[unique.length - 1]) };
}

/** "YYYY-MM-DD" + n days (calendar arithmetic, no timezone involved). */
export function addCalendarDays(date: string, n: number): string {
  const d = DATE_RE.exec(date);
  if (!d) throw new Error(`Invalid date "${date}"`);
  return new Date(Date.UTC(+d[1], +d[2] - 1, +d[3] + n)).toISOString().slice(0, 10);
}

export type AmbiguousChoice = 'earlier' | 'later';

export interface ShiftTimeInput {
  date: string;       // YYYY-MM-DD, agency calendar date the shift starts on
  startTime: string;  // HH:MM, agency wall clock
  endTime: string;    // HH:MM, agency wall clock; <= startTime means next day
  timeZone: string;
  startChoice?: AmbiguousChoice;
  endChoice?: AmbiguousChoice;
}

export interface TimeProblem {
  field: 'start' | 'end';
  code: 'NONEXISTENT' | 'AMBIGUOUS' | 'INVALID';
  message: string;
  /** For AMBIGUOUS: the two possible instants, with a label each. */
  options?: { choice: AmbiguousChoice; instant: string; label: string }[];
}

export type ShiftTimesResult =
  | { ok: true; date: string; startTime: string; endTime: string; overnight: boolean; durationMinutes: number; fullDay: boolean }
  | { ok: false; problem: TimeProblem };

function zoneLabel(tz: string, at: Date): string {
  const name = new Intl.DateTimeFormat('en-GB', { timeZone: tz, timeZoneName: 'short' })
    .formatToParts(at).find((p) => p.type === 'timeZoneName')?.value;
  return name ?? '';
}

function niceDate(date: string) {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

function pick(field: 'start' | 'end', tz: string, date: string, time: string, choice?: AmbiguousChoice):
  { instant: Date } | { problem: TimeProblem } {
  const r = resolveWallTime(tz, date, time);
  if (r.status === 'ok') return { instant: r.instant };
  const what = field === 'start' ? 'Start' : 'End';
  if (r.status === 'nonexistent') {
    return { problem: {
      field, code: 'NONEXISTENT',
      message: `${what} time ${time} doesn't exist on ${niceDate(date)}: the clocks go forward then. Choose a different time.`,
    } };
  }
  if (choice) return { instant: choice === 'earlier' ? r.earlier : r.later };
  return { problem: {
    field, code: 'AMBIGUOUS',
    message: `${time} happens twice on ${niceDate(date)} because the clocks go back. Choose which one.`,
    options: [
      { choice: 'earlier', instant: r.earlier.toISOString(), label: `${time} ${zoneLabel(tz, r.earlier)} (first, before the clocks go back)` },
      { choice: 'later', instant: r.later.toISOString(), label: `${time} ${zoneLabel(tz, r.later)} (second, after the clocks go back)` },
    ],
  } };
}

/** Convert a shift form's fields into the UTC instants sent to the API. */
export function shiftTimesFromForm(input: ShiftTimeInput): ShiftTimesResult {
  const tz = safeTimeZone(input.timeZone);
  if (!DATE_RE.test(input.date)) return { ok: false, problem: { field: 'start', code: 'INVALID', message: 'Enter a valid date.' } };
  if (!TIME_RE.test(input.startTime)) return { ok: false, problem: { field: 'start', code: 'INVALID', message: 'Enter a valid start time.' } };
  if (!TIME_RE.test(input.endTime)) return { ok: false, problem: { field: 'end', code: 'INVALID', message: 'Enter a valid end time.' } };

  const overnight = input.endTime <= input.startTime; // same-length "HH:MM" strings compare correctly
  const start = pick('start', tz, input.date, input.startTime, input.startChoice);
  if ('problem' in start) return { ok: false, problem: start.problem };
  const end = pick('end', tz, overnight ? addCalendarDays(input.date, 1) : input.date, input.endTime, input.endChoice);
  if ('problem' in end) return { ok: false, problem: end.problem };
  if (end.instant <= start.instant) {
    return { ok: false, problem: { field: 'end', code: 'INVALID', message: 'End time must be after the start time.' } };
  }
  const durationMinutes = Math.round((end.instant.getTime() - start.instant.getTime()) / 60_000);
  return {
    ok: true, date: input.date, startTime: start.instant.toISOString(), endTime: end.instant.toISOString(),
    overnight, durationMinutes, fullDay: input.endTime === input.startTime,
  };
}

function hm(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h}h ${String(m).padStart(2, '0')}m` : `${h}h`;
}

/**
 * One line the forms show under the times, so the length is never a surprise:
 *   "8h"  /  "Overnight: ends 08:00 the next day (12h)"  /
 *   "24-hour shift: ends 09:00 the next day"
 * (Real elapsed time, so a night across a clock change shows 11h or 13h.)
 */
export function describeShiftLength(r: Extract<ShiftTimesResult, { ok: true }>, endTime: string): string {
  if (r.fullDay) {
    return r.durationMinutes === 24 * 60
      ? `24-hour shift: ends ${endTime} the next day`
      : `24-hour shift by the clock: ends ${endTime} the next day (${hm(r.durationMinutes)} because the clocks change)`;
  }
  if (r.overnight) return `Overnight: ends ${endTime} the next day (${hm(r.durationMinutes)})`;
  return hm(r.durationMinutes);
}

/** A stored instant as the agency's calendar date and wall-clock time (for edit forms). */
export function instantToAgencyParts(iso: string, timeZone: string): { date: string; time: string } {
  const p = wallParts(safeTimeZone(timeZone), new Date(iso).getTime());
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

/** "09:00" in the agency's timezone. */
export function formatTimeInZone(iso: string | Date, timeZone: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: safeTimeZone(timeZone) });
}

/** Date in the agency's timezone, e.g. { weekday: 'short', day: 'numeric', month: 'short' }. */
export function formatDateInZone(iso: string | Date, timeZone: string, opts: Intl.DateTimeFormatOptions): string {
  return new Date(iso).toLocaleDateString('en-GB', { ...opts, timeZone: safeTimeZone(timeZone) });
}
