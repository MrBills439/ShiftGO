/** Leave/PTO display helpers.
 *
 *  The backend accrues and stores leave in *hours* (needed for precise accrual
 *  math). Workers think in *whole days*: "you have 9 days". Any partial day that
 *  hasn't been fully earned yet keeps accruing quietly in the background and only
 *  bumps the day count once it crosses a whole day.
 */

export const DEFAULT_DAILY_HOURS = 7.5; // a standard care-support shift

export interface LeaveDayParts {
  /** Whole days available/used (signed). */
  whole: number;
  /** Leftover hours still accruing toward the next whole day (always ≥ 0). */
  remHours: number;
  /** True when the underlying hours figure is negative. */
  neg: boolean;
  /** The daily-hours figure actually used. */
  dailyHours: number;
}

export function leaveDayParts(hours: number, dailyHours?: number): LeaveDayParts {
  const dh = dailyHours && dailyHours > 0 ? dailyHours : DEFAULT_DAILY_HOURS;
  const neg = hours < 0;
  const abs = Math.abs(hours);
  const whole = Math.floor(abs / dh + 1e-9); // fp guard so 15 / 7.5 is exactly 2
  const remHours = Math.round((abs - whole * dh) * 10) / 10;
  return { whole: neg ? -whole : whole, remHours, neg, dailyHours: dh };
}

/** Whole days only — e.g. "9 days", "1 day". Partial accrual is not shown here. */
export function fmtLeaveDays(hours: number, dailyHours?: number): string {
  const { whole } = leaveDayParts(hours, dailyHours);
  return `${whole} ${Math.abs(whole) === 1 ? 'day' : 'days'}`;
}

/** The partial-day progress line, e.g. "+3h towards your next day".
 *  Returns null when there's nothing pending (or the balance is negative). */
export function nextDayCaption(hours: number, dailyHours?: number): string | null {
  const { remHours, neg } = leaveDayParts(hours, dailyHours);
  if (neg || remHours <= 0) return null;
  return `+${remHours}h towards your next day`;
}
