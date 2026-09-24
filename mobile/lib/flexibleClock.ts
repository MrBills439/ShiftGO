import type { FlexibleSession, LocationOption, Shift } from '../types';

/**
 * Whether an employee records attendance by picking a work Location (FLEXIBLE)
 * instead of clocking into a scheduled shift. It depends on the employment
 * work pattern ONLY — never the system role: an HR administrator can be
 * FLEXIBLE, a manager FIXED, a team leader ROTA. (The backend re-checks this
 * from its own records; this just chooses which screen to show.)
 */
export function isFlexibleEmployee(user?: { workPatternType?: string | null } | null): boolean {
  return user?.workPatternType === 'FLEXIBLE';
}

/** Primary location first (when the employee has one and it is offered), the
 *  rest alphabetical. Never drops or invents an option. */
export function sortLocationsPrimaryFirst(
  options: LocationOption[],
  primaryLocationId?: string | null,
): LocationOption[] {
  return [...options].sort((a, b) => {
    if (primaryLocationId) {
      if (a.id === primaryLocationId && b.id !== primaryLocationId) return -1;
      if (b.id === primaryLocationId && a.id !== primaryLocationId) return 1;
    }
    return a.name.localeCompare(b.name);
  });
}

/** Only the primary location is pre-selected — anything else must be an
 *  explicit choice, so the employee never clocks in somewhere by default. */
export function defaultLocationId(
  options: LocationOption[],
  primaryLocationId?: string | null,
): string | null {
  return primaryLocationId && options.some((o) => o.id === primaryLocationId) ? primaryLocationId : null;
}

/** The slice of a Shift the clock/monitoring hook actually uses. A scheduled
 *  Shift satisfies it as-is; a FLEXIBLE session is described by the same slice. */
export type ClockableShift = Pick<Shift, 'id' | 'house' | 'location'>;

/** Adapt a FLEXIBLE session to what useClockStatus needs (its shift id + its
 *  Location target) without inventing any schedule data. */
export function clockableFromSession(session: FlexibleSession | null): ClockableShift | null {
  if (!session) return null;
  return {
    id: session.shiftId,
    house: null,
    location: { id: session.location.id, name: session.location.name, type: 'OTHER' },
  };
}

/** "3h 12m" / "42m" since a clock-in — the FLEXIBLE session has no scheduled
 *  end, so elapsed time is all there is to show. */
export function elapsedLabel(fromIso: string, now: number = Date.now()): string {
  const ms = Math.max(0, now - new Date(fromIso).getTime());
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
