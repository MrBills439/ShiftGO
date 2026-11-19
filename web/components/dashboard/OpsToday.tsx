'use client';
import Link from 'next/link';
import {
  CheckCircleIcon, WarningCircleIcon, ExclamationMarkIcon, InfoIcon,
  ArrowRightIcon, CalendarPlusIcon, UserPlusIcon, ArrowClockwiseIcon,
} from '@phosphor-icons/react';
import { useDashboardToday } from '@/hooks/useDashboard';
import { useAuthStore } from '@/store/authStore';
import { firstNameOf } from '@/lib/userName';
import { queryView, coverageView, setupSteps, setupComplete, noFrontlineStaffMessage, type SetupStep } from '@/lib/dashboardView';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { StatsSkeleton } from '@/components/ui/Skeleton';
import { ActivityFeed } from '@/components/operations/ActivityFeed';
import type { DashboardIssue, DashboardShift, DashboardOpenShift, DashboardToday } from '@/types';

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function formatDay(date: Date, timeZone?: string, long = true) {
  const opts: Intl.DateTimeFormatOptions = long
    ? { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }
    : { weekday: 'short', day: 'numeric', month: 'short' };
  try {
    return date.toLocaleDateString('en-GB', { ...opts, timeZone });
  } catch {
    return date.toLocaleDateString('en-GB', opts);
  }
}

function greeting(timeZone?: string) {
  let h = new Date().getHours();
  try {
    h = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone }).format(new Date()));
  } catch { /* browser hour */ }
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

const linkBtn = {
  primary: 'inline-flex items-center justify-center gap-2 rounded-md border border-brand-600 bg-brand-600 px-4 h-10 text-sm font-medium text-white hover:bg-brand-700',
  secondary: 'inline-flex items-center justify-center gap-2 rounded-md border border-border bg-surface px-4 h-10 text-sm font-medium text-fg hover:bg-surface-subtle',
  small: 'inline-flex items-center gap-1 rounded-md border border-border bg-surface px-3 h-8 text-xs font-medium text-fg hover:bg-surface-subtle',
};

const ISSUE_ACTION: Record<DashboardIssue['type'], string> = {
  LATE: 'Open schedule',
  UNCOVERED_SHIFT: 'Cover shift',
  ATTENDANCE_REVIEW: 'Review attendance',
  RIGHT_TO_WORK: 'Open Right to Work',
  TIMESHEET_APPROVAL: 'Review timesheet',
  LEAVE_APPROVAL: 'Review leave',
};

function attendanceBadge(a: DashboardShift['attendance']) {
  const map: Record<DashboardShift['attendance'], 'info' | 'success' | 'warning' | 'danger' | 'neutral'> = {
    Scheduled: 'info', 'Clocked in': 'success', Late: 'warning', Completed: 'neutral', 'Needs review': 'danger', Open: 'warning',
  };
  return <Badge variant={map[a]} label={a} dot={false} />;
}

/* ─── Header ─────────────────────────────────────────────────────────── */

function DashboardHeader({ data, refreshNote }: { data?: DashboardToday; refreshNote?: React.ReactNode }) {
  const user = useAuthStore((s) => s.user);
  const name = firstNameOf(user);
  const tz = data?.timezone;
  const role = user?.role;
  // The weekly Schedule is for managers/HR; team leaders create shifts on the Shifts page.
  const createHref = role === 'MANAGER' || role === 'HR' ? '/dashboard/rota?create=1' : '/dashboard/shifts';
  const canCreate = data ? data.permissions.canCreateShift : role !== 'WORKER';
  const canInvite = data ? data.permissions.canManageStaff : role === 'MANAGER' || role === 'HR';
  const prefixMissing = data?.setup ? !data.setup.employeeIdPrefixSet : false;

  return (
    <div className="border-b border-border pb-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight text-fg sm:text-3xl">
            {greeting(tz)}{name ? `, ${name}` : ''}
          </h1>
          <p className="mt-1 text-sm text-fg-muted">
            {formatDay(new Date(), tz)}{user?.agency?.name ? ` · ${user.agency.name}` : ''}
          </p>
          {refreshNote}
        </div>
        {(canCreate || canInvite) && (
          <div className="flex flex-col gap-1 sm:items-end">
            <div className="flex flex-wrap gap-2">
              {canCreate && (
                <Link href={createHref} className={linkBtn.primary}>
                  <CalendarPlusIcon size={16} aria-hidden="true" /> Create shift
                </Link>
              )}
              {canInvite && (
                <Link href="/dashboard/workers?add=1" className={linkBtn.secondary}>
                  <UserPlusIcon size={16} aria-hidden="true" /> Invite staff
                </Link>
              )}
            </div>
            {canInvite && prefixMissing && (
              <p className="text-xs text-fg-muted sm:text-right">
                Inviting needs an employee ID prefix first (or a typed employee ID).
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Setup checklist ────────────────────────────────────────────────── */

function SetupChecklist({ steps }: { steps: SetupStep[] }) {
  const done = steps.filter((s) => s.done).length;
  return (
    <Card className="p-4 sm:p-5">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-base font-semibold text-fg">Set up your agency</h2>
        <p className="text-xs font-medium text-fg-muted">{done} of {steps.length} done</p>
      </div>
      <ol className="divide-y divide-border">
        {steps.map((step, i) => (
          <li key={step.key} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              {step.done ? (
                <CheckCircleIcon size={22} weight="fill" className="mt-0.5 shrink-0 text-success" aria-hidden="true" />
              ) : (
                <span className="mt-0.5 flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border border-border text-xs font-semibold text-fg-muted" aria-hidden="true">
                  {i + 1}
                </span>
              )}
              <div className="min-w-0">
                <p className={`text-sm font-medium ${step.done ? 'text-fg-muted' : 'text-fg'}`}>
                  {step.label}
                  <span className="sr-only">{step.done ? ' (done)' : ' (to do)'}</span>
                </p>
                {!step.done && step.blockedReason && <p className="text-xs text-fg-muted">{step.blockedReason}</p>}
                {!step.done && step.note && <p className="text-xs text-fg-muted">{step.note}</p>}
              </div>
            </div>
            {!step.done && step.href && (
              <Link href={step.href} className={`${linkBtn.small} self-start sm:self-auto`}>
                {step.actionLabel} <ArrowRightIcon size={12} aria-hidden="true" />
              </Link>
            )}
          </li>
        ))}
      </ol>
    </Card>
  );
}

/* ─── Figures ────────────────────────────────────────────────────────── */

function Figure({ label, value, detail, attention, href }: {
  label: string; value: string | number; detail: string; attention?: boolean; href?: string;
}) {
  const body = (
    <>
      <p className="text-xs font-medium text-fg-muted">{label}</p>
      <p className="mt-1 text-xl font-semibold text-fg font-inter">{value}</p>
      <p className={`mt-0.5 text-xs ${attention ? 'font-medium text-warning-text' : 'text-fg-muted'}`}>{detail}</p>
    </>
  );
  const cls = `block rounded-lg border p-3 ${attention ? 'border-warning/30 bg-warning/5' : 'border-border bg-surface'}`;
  return href ? <Link href={href} className={`${cls} hover:bg-surface-subtle`}>{body}</Link> : <div className={cls}>{body}</div>;
}

/* ─── Main ───────────────────────────────────────────────────────────── */

export function OpsToday() {
  const user = useAuthStore((s) => s.user);
  const query = useDashboardToday(user?.role !== 'WORKER');
  const view = queryView({ isLoading: query.isLoading, isError: query.isError, hasData: !!query.data });

  if (view === 'loading') {
    return (
      <div className="space-y-6">
        <DashboardHeader />
        <StatsSkeleton count={4} />
      </div>
    );
  }

  if (view === 'error' || !query.data) {
    return (
      <div className="space-y-6">
        <DashboardHeader />
        <Card className="p-6 text-center">
          <WarningCircleIcon size={28} className="mx-auto mb-2 text-warning" aria-hidden="true" />
          <p className="font-medium text-fg" role="alert">Today&apos;s overview couldn&apos;t be loaded</p>
          <p className="mt-1 text-sm text-fg-muted">Nothing below is shown until it loads, so no figures are guessed.</p>
          <button type="button" onClick={() => query.refetch()} className={`${linkBtn.secondary} mt-4`}>
            <ArrowClockwiseIcon size={16} aria-hidden="true" /> Try again
          </button>
        </Card>
      </div>
    );
  }

  const data = query.data;
  const { coverage, pendingApprovals, issues, todayShifts, tomorrow, permissions, openShifts, setup } = data;
  const cov = coverageView(coverage);
  const steps = setup ? setupSteps(setup, data.role) : null;
  const settingUp = !!steps && !setupComplete(steps);
  const updatedAt = new Date(query.dataUpdatedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

  const refreshNote = view === 'stale' ? (
    <p className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-warning/10 px-2 py-1 text-xs font-medium text-warning-text" role="status">
      <WarningCircleIcon size={14} aria-hidden="true" /> Couldn&apos;t refresh. Showing figures from {updatedAt}.
      <button type="button" className="underline" onClick={() => query.refetch()}>Retry</button>
    </p>
  ) : (
    <p className="mt-1 text-xs text-fg-subtle">Updated {updatedAt} · refreshes every minute</p>
  );

  const tomorrowDate = new Date(Date.now() + 86_400_000);

  return (
    <div className="space-y-6">
      <DashboardHeader data={data} refreshNote={refreshNote} />

      {settingUp && steps && <SetupChecklist steps={steps} />}

      {!setup && data.staff.total === 0 && (
        <p className="flex items-center gap-2 rounded-lg border border-border bg-surface p-3 text-sm text-fg">
          <InfoIcon size={16} className="text-fg-muted" aria-hidden="true" /> {noFrontlineStaffMessage()}.
        </p>
      )}

      {/* ─── Today at a glance ─────────────────────────────────────────── */}
      <section aria-labelledby="today-figures">
        <h2 id="today-figures" className="sr-only">Today at a glance</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Figure label="Today's shifts" value={cov.measured ? coverage.scheduled : 0} detail={cov.measured ? cov.headline : 'None scheduled'} href="/dashboard/rota" />
          <Figure
            label="Clocked in now"
            value={data.workersLive}
            detail={coverage.scheduled > 0 ? `of ${coverage.scheduled} scheduled today` : 'No shifts today'}
          />
          <Figure
            label="Uncovered shifts"
            value={coverage.uncovered}
            detail={coverage.scheduled === 0 ? 'Not applicable today' : coverage.uncovered > 0 ? 'Today, need a worker' : 'Today'}
            attention={coverage.uncovered > 0}
            href={coverage.uncovered > 0 ? '/dashboard/rota' : undefined}
          />
          <Figure
            label="Pending approvals"
            value={permissions.canReviewApprovals ? pendingApprovals.total : '—'}
            detail={permissions.canReviewApprovals
              ? pendingApprovals.total > 0 ? 'Waiting for review' : 'Nothing waiting'
              : 'Managers and HR approve'}
            attention={permissions.canReviewApprovals && pendingApprovals.total > 0}
            href={permissions.canReviewApprovals && pendingApprovals.total > 0 ? '/dashboard/timesheets' : undefined}
          />
        </div>
      </section>

      {/* ─── Today's shifts + issues ───────────────────────────────────── */}
      <div className="grid gap-6 lg:grid-cols-3">
        <section className="lg:col-span-2" aria-labelledby="today-shifts">
          <h2 id="today-shifts" className="mb-3 text-base font-semibold text-fg">Today&apos;s shifts</h2>
          <Card className="overflow-hidden">
            {todayShifts.length === 0 ? (
              <p className="p-4 text-sm text-fg-muted">No shifts scheduled today.</p>
            ) : (
              <ul className="divide-y divide-border">
                {todayShifts.map((shift) => (
                  <li key={shift.id} className="flex items-center justify-between gap-3 p-3 sm:p-4">
                    <div className="min-w-0">
                      <div className="mb-1 flex flex-wrap items-center gap-2">
                        <p className="font-medium text-fg">{shift.worker?.name ?? 'Open shift'}</p>
                        {attendanceBadge(shift.attendance)}
                      </div>
                      <p className="text-sm text-fg-muted">
                        {shift.house?.name ?? 'No service'} · {formatTime(shift.startTime)}–{formatTime(shift.endTime)}
                      </p>
                    </div>
                    <span className="hidden shrink-0 text-xs text-fg-muted sm:block">
                      {shift.shiftType?.replace(/_/g, ' ').toLowerCase() || 'standard'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </section>

        <section aria-labelledby="today-issues">
          <h2 id="today-issues" className="mb-3 text-base font-semibold text-fg">
            Issues{issues.length > 0 ? ` (${issues.length})` : ''}
          </h2>
          {issues.length === 0 ? (
            <Card className="p-4">
              <p className="text-sm text-fg">No issues flagged.</p>
              <p className="mt-1 text-xs text-fg-muted">
                Checked: late starts, uncovered shifts, attendance reviews, right to work and approvals.
              </p>
            </Card>
          ) : (
            <ul className="space-y-2">
              {issues.map((issue) => {
                const tone = { critical: 'border-danger/30 bg-danger/5', warning: 'border-warning/30 bg-warning/5', info: 'border-border bg-surface' }[issue.severity];
                const Icon = issue.severity === 'critical' ? ExclamationMarkIcon : issue.severity === 'warning' ? WarningCircleIcon : InfoIcon;
                const context = [issue.house?.name, issue.at ? formatTime(issue.at) : null].filter(Boolean).join(' · ');
                return (
                  <li key={issue.id} className={`rounded-lg border p-3 ${tone}`}>
                    <div className="flex gap-2">
                      <Icon size={16} weight="bold" className="mt-0.5 shrink-0 text-fg-muted" aria-hidden="true" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-fg">{issue.title}</p>
                        <p className="text-xs text-fg-muted">{issue.detail}{context ? ` · ${context}` : ''}</p>
                        <Link href={issue.href} className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline">
                          {ISSUE_ACTION[issue.type]} <ArrowRightIcon size={12} aria-hidden="true" />
                        </Link>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      {/* ─── Open shifts (next 14 days) ─────────────────────────────────── */}
      {(openShifts.length > 0 || !settingUp) && (
        <section aria-labelledby="open-shifts">
          <div className="mb-3 flex items-center justify-between">
            <h2 id="open-shifts" className="text-base font-semibold text-fg">Open shifts, next 14 days</h2>
            {openShifts.length > 0 && <Link href="/dashboard/rota" className="text-sm font-medium text-brand-700 hover:underline">Schedule</Link>}
          </div>
          <Card className="overflow-hidden">
            {openShifts.length === 0 ? (
              <p className="p-4 text-sm text-fg-muted">No open shifts in the next 14 days.</p>
            ) : (
              <ul className="divide-y divide-border">
                {openShifts.map((s: DashboardOpenShift) => (
                  <li key={s.id}>
                    <Link href={s.href} className="flex items-center justify-between gap-3 p-3 hover:bg-surface-subtle sm:p-4">
                      <div className="min-w-0">
                        <div className="mb-1 flex flex-wrap items-center gap-2">
                          <p className="font-medium text-fg">{s.house?.name ?? 'No service'}</p>
                          {s.urgent && <Badge variant="danger" label="Urgent" dot={false} />}
                          <Badge variant="neutral" label={`${s.claimCount} claim${s.claimCount === 1 ? '' : 's'}`} dot={false} />
                        </div>
                        <p className="text-sm text-fg-muted">
                          {formatDay(new Date(s.startTime), data.timezone, false)} · {formatTime(s.startTime)}–{formatTime(s.endTime)}
                        </p>
                      </div>
                      <ArrowRightIcon size={16} className="shrink-0 text-fg-muted" aria-hidden="true" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </section>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* ─── Pending approvals breakdown ─────────────────────────────── */}
        {permissions.canReviewApprovals && (pendingApprovals.total > 0 || !settingUp) && (
          <section aria-labelledby="approvals">
            <h2 id="approvals" className="mb-3 text-base font-semibold text-fg">Pending approvals</h2>
            <Card className="overflow-hidden">
              {pendingApprovals.total === 0 ? (
                <p className="p-4 text-sm text-fg-muted">No timesheets, attendance reviews or leave requests waiting.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {[
                    { label: 'Timesheets', count: pendingApprovals.timesheets, href: '/dashboard/timesheets' },
                    { label: 'Attendance reviews', count: pendingApprovals.attendanceReviews, href: '/dashboard/timesheets' },
                    { label: 'Leave requests', count: pendingApprovals.leave, href: '/dashboard/leave' },
                  ].filter((r) => r.count > 0).map((row) => (
                    <li key={row.label}>
                      <Link href={row.href} className="flex items-center justify-between p-3 text-sm hover:bg-surface-subtle sm:p-4">
                        <span className="font-medium text-fg">{row.label}</span>
                        <span className="flex items-center gap-2 text-fg-muted">{row.count} waiting <ArrowRightIcon size={14} aria-hidden="true" /></span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </section>
        )}

        {/* ─── Tomorrow ───────────────────────────────────────────────── */}
        {(tomorrow.count > 0 || !settingUp) && (
          <section aria-labelledby="tomorrow">
            <h2 id="tomorrow" className="mb-3 text-base font-semibold text-fg">
              Tomorrow · {formatDay(tomorrowDate, data.timezone, false)}
            </h2>
            <Card className="p-4">
              {tomorrow.count === 0 ? (
                <p className="text-sm text-fg-muted">No shifts scheduled.</p>
              ) : (
                <>
                  <p className="text-sm font-medium text-fg">{tomorrow.count} shift{tomorrow.count === 1 ? '' : 's'}</p>
                  <ul className="mt-2 space-y-1.5">
                    {tomorrow.shifts.map((shift) => (
                      <li key={shift.id} className="flex justify-between gap-3 text-sm">
                        <span className="truncate text-fg">{shift.worker?.name ?? 'Open shift'}</span>
                        <span className="shrink-0 text-fg-muted">{formatTime(shift.startTime)}–{formatTime(shift.endTime)}</span>
                      </li>
                    ))}
                  </ul>
                  {tomorrow.count > tomorrow.shifts.length && (
                    <p className="mt-2 text-xs text-fg-muted">+{tomorrow.count - tomorrow.shifts.length} more</p>
                  )}
                </>
              )}
            </Card>
          </section>
        )}
      </div>

      <ActivityFeed limit={8} title="Recent activity" />
    </div>
  );
}
