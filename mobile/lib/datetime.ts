/**
 * Shared date / time formatting. Previously copy-pasted into ~8 screens.
 * All wall-clock formatting is en-GB to match the rest of the product.
 *
 * Shift and attendance times are shown in the AGENCY's timezone (the same rule
 * as the web app), not the phone's: a London care worker whose phone is set to
 * New York still sees "09:00". The timezone comes from /users/me and is set by
 * AuthSync via setDisplayTimeZone(); until then (and in tests that don't set
 * it) the phone's own timezone is used, exactly as before.
 *
 * Only single-field toLocale*String calls with `timeZone` are used (no
 * formatToParts), the most widely supported form on Hermes.
 */

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

let displayTimeZone: string | undefined;

/** Use `tz` (the agency's IANA timezone) for every date/time shown. Invalid or empty = phone timezone. */
export function setDisplayTimeZone(tz: string | null | undefined): void {
  if (!tz) { displayTimeZone = undefined; return; }
  try {
    new Date(0).toLocaleString('en-GB', { timeZone: tz });
    displayTimeZone = tz;
  } catch {
    displayTimeZone = undefined;
  }
}

export function getDisplayTimeZone(): string | undefined {
  return displayTimeZone;
}

/** Adds the display timezone (if any) to Intl options. */
function tzOpt<T extends Intl.DateTimeFormatOptions>(o: T): T {
  return displayTimeZone ? { ...o, timeZone: displayTimeZone } : o;
}

/** Calendar/clock fields of an instant in the display timezone. */
function zoned(d: Date): { y: number; m: number; d: number; h: number; mi: number } {
  const num = (o: Intl.DateTimeFormatOptions) => parseInt(d.toLocaleString('en-GB', tzOpt(o)).replace(/\D/g, ''), 10);
  return {
    y: num({ year: 'numeric' }),
    m: num({ month: 'numeric' }),
    d: num({ day: 'numeric' }),
    h: num({ hour: '2-digit', hour12: false }) % 24,
    mi: num({ minute: '2-digit' }),
  };
}

/** "YYYY-MM-DD" calendar date of an instant in the display timezone. */
export function dayKey(dateOrIso: Date | string): string {
  const z = zoned(new Date(dateOrIso));
  return `${z.y}-${String(z.m).padStart(2, '0')}-${String(z.d).padStart(2, '0')}`;
}

/** The instant when the clocks in the display timezone read y-m-d 00:00. */
function zonedMidnight(y: number, m: number, d: number): Date {
  const wall = Date.UTC(y, m - 1, d);
  const offsetAt = (ms: number) => {
    const z = zoned(new Date(ms));
    return Date.UTC(z.y, z.m - 1, z.d, z.h, z.mi) - Math.floor(ms / 60000) * 60000;
  };
  let utc = wall - offsetAt(wall);
  utc = wall - offsetAt(utc);
  return new Date(utc);
}

/** Midnight (display timezone) `n` calendar days after the day containing `ref`. */
export function startOfDayPlus(ref: Date, n: number): Date {
  const z = zoned(ref);
  const base = new Date(Date.UTC(z.y, z.m - 1, z.d + n));
  return zonedMidnight(base.getUTCFullYear(), base.getUTCMonth() + 1, base.getUTCDate());
}

/** True when both instants fall in the same calendar month (display timezone). */
export function sameMonth(a: Date | string, b: Date | string): boolean {
  const x = zoned(new Date(a)); const y = zoned(new Date(b));
  return x.y === y.y && x.m === y.m;
}

export function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', tzOpt({ hour: '2-digit', minute: '2-digit' }));
}

/** "3 Sep 2026" */
export function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', tzOpt({ day: 'numeric', month: 'short', year: 'numeric' }));
}

/** "1 May 2026" (long month) in the display timezone. */
export function fmtDateLongMonth(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', tzOpt({ day: 'numeric', month: 'long', year: 'numeric' }));
}

/** Like fmtDate but tolerates null/undefined -> "—" */
export function fmtDateOrDash(iso?: string | null): string {
  return iso ? fmtDate(iso) : '—';
}

/** "Wednesday, 3 September 2026" */
export function fmtDateLong(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', tzOpt({
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  }));
}

/** Whole-hour duration: "8h" */
export function fmtDur(startIso: string, endIso: string): string {
  const h = Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / HOUR_MS);
  return `${h}h`;
}

/** Precise duration: "8h 30m" (minutes shown as "00m" when zero) */
export function fmtDurLong(startIso: string, endIso: string): string {
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  const h = Math.floor(ms / HOUR_MS);
  const m = Math.round((ms % HOUR_MS) / 60_000);
  return m > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${h}h 00m`;
}

/** Precise duration, minutes omitted when zero: "8h" / "8h 30m" */
export function fmtDurCompact(startIso: string, endIso: string): string {
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  const h = Math.floor(ms / HOUR_MS);
  const m = Math.round((ms % HOUR_MS) / 60_000);
  return m > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${h}h`;
}

/** Decimal hours -> "8h 30m" */
export function fmtHM(hours: number): string {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return m > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${h}h 00m`;
}

/** Hours value -> "37.5h" (drops trailing ".0") */
export function fmtHours(hours: number): string {
  return `${Number.isInteger(hours) ? hours : Math.round(hours * 10) / 10}h`;
}

/** Big date-block: { day: "WED", num: 3, mon: "SEP" } */
export function dateParts(iso: string): { day: string; num: number; mon: string } {
  const d = new Date(iso);
  return {
    day: d.toLocaleDateString('en-GB', tzOpt({ weekday: 'short' })).toUpperCase(),
    num: zoned(d).d,
    mon: d.toLocaleDateString('en-GB', tzOpt({ month: 'short' })).toUpperCase(),
  };
}

export type ShiftWindowStatus = 'active' | 'upcoming' | 'completed';

/** Time-window status for a shift (ignores CANCELLED/etc — caller handles those). */
export function shiftWindowStatus(startIso: string, endIso: string): ShiftWindowStatus {
  const now = Date.now();
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  if (now >= start && now <= end) return 'active';
  if (now < start) return 'upcoming';
  return 'completed';
}

/** "Just now" / "5m ago" / "3h ago" / "2d ago" (then falls back to fmtDate). */
export function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return fmtDate(iso);
}

/** Monday 00:00 (display timezone) of the week containing `ref`. */
export function getWeekStart(ref: Date = new Date()): Date {
  const z = zoned(ref);
  const weekday = new Date(Date.UTC(z.y, z.m - 1, z.d)).getUTCDay(); // 0 = Sunday
  return startOfDayPlus(ref, -((weekday + 6) % 7));
}

/** "3 Sep" */
export function fmtShortDate(d: Date): string {
  return d.toLocaleDateString('en-GB', tzOpt({ day: 'numeric', month: 'short' }));
}

/** "Wed, 3 Sep" */
export function fmtDayLabel(d: Date): string {
  return d.toLocaleDateString('en-GB', tzOpt({ weekday: 'short', day: 'numeric', month: 'short' }));
}

/** "Today" / "Tomorrow" / "Wed, 3 Sep" for a date ISO string (display timezone). */
export function relativeDayLabel(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  if (dayKey(d) === dayKey(now)) return 'Today';
  if (dayKey(d) === dayKey(startOfDayPlus(now, 1))) return 'Tomorrow';
  return fmtDayLabel(d);
}

/** "1 Sep – 7 Sep 2026" for the week starting `start`. */
export function fmtWeekRange(start: Date): string {
  const end = startOfDayPlus(start, 6);
  return `${fmtShortDate(start)} – ${fmtShortDate(end)} ${zoned(end).y}`;
}

/** Weekdays (Mon–Fri) in [startIso, endIso] inclusive — mirrors backend leave pricing. */
export function weekdaysInRange(startIso: string, endIso: string): number {
  // A bare "YYYY-MM-DD" is a calendar date, not an instant: use it as-is
  // (parsing it as UTC midnight would make it the previous day on a phone
  // west of the UK). Full timestamps use their date in the display timezone.
  const ymd = (v: string) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
    if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    const d = new Date(v);
    if (isNaN(d.getTime())) return null;
    const z = zoned(d);
    return new Date(Date.UTC(z.y, z.m - 1, z.d));
  };
  const cur = ymd(startIso);
  const last = ymd(endIso);
  if (!cur || !last || last < cur) return 0;
  let n = 0;
  while (cur <= last) {
    const day = cur.getUTCDay();
    if (day !== 0 && day !== 6) n += 1;
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return n;
}

export function getGreeting(d: Date = new Date()): string {
  const h = zoned(d).h;
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

export { DAY_MS, HOUR_MS };
