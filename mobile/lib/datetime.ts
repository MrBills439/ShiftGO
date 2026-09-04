/**
 * Shared date / time formatting. Previously copy-pasted into ~8 screens.
 * All wall-clock formatting is en-GB to match the rest of the product.
 */

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

export function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

/** "3 Sep 2026" */
export function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Like fmtDate but tolerates null/undefined -> "—" */
export function fmtDateOrDash(iso?: string | null): string {
  return iso ? fmtDate(iso) : '—';
}

/** "Wednesday, 3 September 2026" */
export function fmtDateLong(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
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
    day: d.toLocaleDateString('en-GB', { weekday: 'short' }).toUpperCase(),
    num: d.getDate(),
    mon: d.toLocaleDateString('en-GB', { month: 'short' }).toUpperCase(),
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

/** Monday 00:00 of the week containing `ref`. */
export function getWeekStart(ref: Date = new Date()): Date {
  const d = new Date(ref);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  d.setHours(0, 0, 0, 0);
  return d;
}

/** "3 Sep" */
export function fmtShortDate(d: Date): string {
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

/** "Wed, 3 Sep" */
export function fmtDayLabel(d: Date): string {
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

/** "Today" / "Tomorrow" / "Wed, 3 Sep" for a date ISO string. */
export function relativeDayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const tmr = new Date();
  tmr.setDate(today.getDate() + 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === tmr.toDateString()) return 'Tomorrow';
  return fmtDayLabel(d);
}

/** "1 Sep – 7 Sep 2026" for the week starting `start`. */
export function fmtWeekRange(start: Date): string {
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return `${fmtShortDate(start)} – ${fmtShortDate(end)} ${end.getFullYear()}`;
}

/** Weekdays (Mon–Fri) in [startIso, endIso] inclusive — mirrors backend leave pricing. */
export function weekdaysInRange(startIso: string, endIso: string): number {
  const s = new Date(startIso);
  const e = new Date(endIso);
  if (isNaN(s.getTime()) || isNaN(e.getTime()) || e < s) return 0;
  const cur = new Date(s.getFullYear(), s.getMonth(), s.getDate());
  const last = new Date(e.getFullYear(), e.getMonth(), e.getDate());
  let n = 0;
  while (cur <= last) {
    const day = cur.getDay();
    if (day !== 0 && day !== 6) n += 1;
    cur.setDate(cur.getDate() + 1);
  }
  return n;
}

export function getGreeting(d: Date = new Date()): string {
  const h = d.getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

export { DAY_MS, HOUR_MS };
