/**
 * Pure wording/state rules for the dashboard, kept apart from React so they can
 * be unit-tested (`npm test`). No imports at runtime.
 *
 * Rules:
 *  - Never imply a measured rate without a denominator (no "100%" for zero shifts).
 *  - A failed request is never shown as zeros or as an "all clear".
 *  - Empty states state facts; they don't reassure.
 */

export type QueryView = 'loading' | 'error' | 'stale' | 'ready';

/** Loading, failed (nothing to show), failed refresh (showing older data), or fresh. */
export function queryView(q: { isLoading: boolean; isError: boolean; hasData: boolean }): QueryView {
  if (q.hasData) return q.isError ? 'stale' : 'ready';
  if (q.isError) return 'error';
  return 'loading';
}

export interface CoverageInput { scheduled: number; covered: number; uncovered: number; percent: number | null }

export interface CoverageView {
  /** False when there is nothing to measure: show no rate and no colour. */
  measured: boolean;
  headline: string;
  detail: string;
}

export function coverageView(c: CoverageInput): CoverageView {
  if (!c || c.scheduled === 0) {
    return { measured: false, headline: 'No shifts scheduled', detail: 'Coverage not applicable today' };
  }
  return {
    measured: true,
    headline: `${c.covered} of ${c.scheduled} covered`,
    detail: c.uncovered === 0 ? 'Each shift today has a worker assigned' : `${c.uncovered} without a worker`,
  };
}

/** The count behind "no staff" is active workers + team leaders (not HR/managers). */
export function noFrontlineStaffMessage(): string {
  return 'No workers or team leaders added yet';
}

export interface SetupInput {
  employeeIdPrefixSet: boolean;
  services: number;
  activeStaff: number;
  pendingInvitations: number;
  shifts: number;
}

export interface SetupStep {
  key: 'prefix' | 'service' | 'invite' | 'shift';
  label: string;
  done: boolean;
  /** Where to do it; null when this person can't (see `blockedReason`). */
  href: string | null;
  actionLabel: string;
  /** Why the step can't be done yet (missing prerequisite or permission). */
  blockedReason: string | null;
  /** Extra fact, e.g. invitations waiting to be accepted. */
  note: string | null;
}

export function setupSteps(s: SetupInput, role: string): SetupStep[] {
  const isHR = role === 'HR';
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  return [
    {
      key: 'prefix',
      label: 'Configure employee ID prefix',
      done: s.employeeIdPrefixSet,
      href: isHR ? '/admin' : null,
      actionLabel: 'Set prefix',
      blockedReason: !s.employeeIdPrefixSet && !isHR ? 'Only HR can set this, in Admin → Agency settings.' : null,
      note: null,
    },
    {
      key: 'service',
      label: 'Add a service',
      done: s.services > 0,
      href: '/dashboard/houses',
      actionLabel: 'Add service',
      blockedReason: null,
      note: null,
    },
    {
      key: 'invite',
      label: 'Invite workers',
      done: s.activeStaff > 0,
      href: '/dashboard/workers?add=1',
      actionLabel: 'Invite',
      blockedReason: s.employeeIdPrefixSet
        ? null
        : 'Needs an employee ID prefix first, unless you type each employee ID yourself.',
      note: s.activeStaff === 0 && s.pendingInvitations > 0
        ? `${plural(s.pendingInvitations, 'invitation', 'invitations')} sent, not yet accepted`
        : null,
    },
    {
      key: 'shift',
      label: 'Schedule first shift',
      done: s.shifts > 0,
      href: s.services > 0 ? '/dashboard/rota?create=1' : null,
      actionLabel: 'Create shift',
      blockedReason: s.services > 0 ? null : 'Add a service first: every shift belongs to a service.',
      note: null,
    },
  ];
}

export function setupComplete(steps: SetupStep[]): boolean {
  return steps.every((s) => s.done);
}
