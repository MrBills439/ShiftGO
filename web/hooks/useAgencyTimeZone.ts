'use client';
import { useAuthStore } from '@/store/authStore';
import { safeTimeZone } from '@/lib/shiftTime';

/**
 * The agency's timezone (from /users/me, so every role has it). Shift times
 * are entered and displayed in it, never in the browser's timezone.
 */
export function useAgencyTimeZone(): string {
  return safeTimeZone(useAuthStore((s) => s.user?.agency?.timezone));
}
