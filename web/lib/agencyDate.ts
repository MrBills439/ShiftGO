/**
 * Calendar-date helpers for the agency's timezone. Dates are plain
 * "YYYY-MM-DD" strings so no browser-local timezone sneaks in.
 *
 * Self-contained (no imports) so `node --test` can run it directly.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Today's date in `timeZone` (an IANA name such as "Europe/London").
 *  Falls back to the browser's timezone if `timeZone` is missing or invalid. */
export function todayInTimeZone(timeZone: string | null | undefined, now: Date = new Date()): string {
  const fmt = (tz?: string) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  if (timeZone) {
    try {
      return fmt(timeZone);
    } catch {
      /* invalid timezone: fall through */
    }
  }
  return fmt(undefined);
}

function toUtcDate(dateStr: string): Date {
  if (!ISO_DATE.test(dateStr)) throw new Error(`Expected YYYY-MM-DD, got "${dateStr}"`);
  return new Date(`${dateStr}T00:00:00Z`);
}

function fromUtcDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** `dateStr` moved by `days` calendar days. */
export function addDays(dateStr: string, days: number): string {
  const d = toUtcDate(dateStr);
  d.setUTCDate(d.getUTCDate() + days);
  return fromUtcDate(d);
}

/** The Monday on or before `dateStr` (weeks run Monday–Sunday). */
export function mondayOf(dateStr: string): string {
  const d = toUtcDate(dateStr);
  const day = d.getUTCDay(); // 0 = Sunday
  return addDays(dateStr, day === 0 ? -6 : 1 - day);
}

/**
 * Date to pre-fill when creating a shift.
 *  - From a specific calendar cell: that cell's date, past or future.
 *  - From a generic "Create shift" button: today in the agency's timezone.
 * The person can still change it in the form (e.g. to record a past shift).
 */
export function defaultShiftDate(opts: { cellDate?: string | null; timeZone?: string | null; now?: Date }): string {
  if (opts.cellDate && ISO_DATE.test(opts.cellDate)) return opts.cellDate;
  return todayInTimeZone(opts.timeZone, opts.now);
}
