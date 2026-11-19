'use client';
import { shiftTimesFromForm, describeShiftLength, type AmbiguousChoice } from '@/lib/shiftTime';

/**
 * Live line under a shift form's times: "8h", "Overnight: ends 08:00 the next
 * day (12h)" or "24-hour shift: ends 09:00 the next day". Equal start and end
 * times are deliberately a 24-hour shift; this makes that visible before saving.
 */
export function ShiftLengthSummary({ date, startTime, endTime, timeZone, choices }: {
  date: string; startTime: string; endTime: string; timeZone: string;
  choices?: { start?: AmbiguousChoice; end?: AmbiguousChoice };
}) {
  if (!date || !startTime || !endTime) return null;
  const r = shiftTimesFromForm({ date, startTime, endTime, timeZone, startChoice: choices?.start, endChoice: choices?.end });
  if (!r.ok) return null; // the form shows the problem itself
  const text = describeShiftLength(r, endTime);
  return (
    <p role="status" aria-live="polite" className={`text-xs ${r.fullDay ? 'font-medium text-warning-text' : 'text-fg-muted'}`}>
      Length: {text}.{r.fullDay ? ' Counts in full towards the weekly hours limit.' : ''}
    </p>
  );
}
