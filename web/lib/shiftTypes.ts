import type { ShiftType } from '@/types';

export const SHIFT_TYPE_OPTIONS: ShiftType[] = ['LONG_DAY', 'MID_DAY', 'WAKE_NIGHT', 'SLEEP_IN'];

interface ShiftTypeMeta {
  label: string;
  dot: string;
  badgeClass: string;
  stripe: string;
}

export const SHIFT_TYPE_META: Record<ShiftType, ShiftTypeMeta> = {
  LONG_DAY: {
    label: 'Long Day',
    dot: 'bg-sky-500',
    badgeClass: 'border-sky-200 bg-sky-50 text-sky-700',
    stripe: 'border-l-sky-500',
  },
  MID_DAY: {
    label: 'Mid Day',
    dot: 'bg-amber-500',
    badgeClass: 'border-amber-200 bg-amber-50 text-amber-700',
    stripe: 'border-l-amber-500',
  },
  WAKE_NIGHT: {
    label: 'Wake Night',
    dot: 'bg-indigo-500',
    badgeClass: 'border-indigo-200 bg-indigo-50 text-indigo-700',
    stripe: 'border-l-indigo-500',
  },
  SLEEP_IN: {
    label: 'Sleep In',
    dot: 'bg-slate-500',
    badgeClass: 'border-slate-300 bg-slate-100 text-slate-600',
    stripe: 'border-l-slate-400',
  },
};

export function shiftTypeLabel(type: ShiftType | string): string {
  return SHIFT_TYPE_META[type as ShiftType]?.label ?? type;
}
