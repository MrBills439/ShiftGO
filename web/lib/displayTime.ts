'use client';
/**
 * Display shift and attendance instants in the AGENCY's timezone (from the
 * signed-in user's profile), never the browser's. Signed-in pages only render
 * once the profile is loaded, and an agency's timezone doesn't change
 * mid-session, so reading the store snapshot here is safe.
 */
import { useAuthStore } from '@/store/authStore';
import { safeTimeZone, formatTimeInZone, formatDateInZone } from './shiftTime';

export function agencyTimeZone(): string {
  return safeTimeZone(useAuthStore.getState().user?.agency?.timezone);
}

/** "09:00" in the agency's timezone. */
export function showTime(iso: string | Date): string {
  return formatTimeInZone(iso, agencyTimeZone());
}

/** A date in the agency's timezone, e.g. showDate(iso, { weekday: 'short', day: 'numeric', month: 'short' }). */
export function showDate(iso: string | Date, opts: Intl.DateTimeFormatOptions): string {
  return formatDateInZone(iso, agencyTimeZone(), opts);
}
