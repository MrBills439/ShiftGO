import type { ShiftType } from '../types';

const LABELS: Record<string, string> = {
  LONG_DAY: 'Long Day',
  MID_DAY: 'Mid Day',
  WAKE_NIGHT: 'Wake Night',
  SLEEP_IN: 'Sleep In',
  // legacy values that may still exist on old records
  DAY: 'Day Shift',
  EMERGENCY: 'Emergency Shift',
};

export function shiftTypeLabel(type?: ShiftType | string | null): string {
  if (!type) return 'Care Support Shift';
  return LABELS[type] ?? 'Care Support Shift';
}
