'use client';
import { useRouter } from 'next/navigation';
import {
  CheckCircleIcon, WarningCircleIcon, ClockIcon, ExclamationMarkIcon,
  CalendarBlankIcon, UsersIcon, ArrowRightIcon,
} from '@phosphor-icons/react';
import { useDashboardToday } from '@/hooks/useDashboard';
import { useAuthStore } from '@/store/authStore';
import { firstNameOf } from '@/lib/userName';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { StatsSkeleton } from '@/components/ui/Skeleton';
import { ActivityFeed } from '@/components/operations/ActivityFeed';
import type { DashboardIssue, DashboardShift, DashboardOpenShift } from '@/types';

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function formatFullDate(date: Date) {
  return date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

function getGreeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

type CardStatus = 'good' | 'warning' | 'critical' | 'neutral';

function KPICard({
  label, value, status, icon: Icon, onClick,
}: {
  label: string;
  value: number | string;
  status: CardStatus;
  icon: React.ElementType;
  onClick?: () => void;
}) {
  const statusColors: Record<CardStatus, string> = {
    good: 'bg-success/10 border-success/20',
    warning: 'bg-warning/10 border-warning/20',
    critical: 'bg-danger/10 border-danger/20',
    neutral: 'bg-surface-subtle border-border',
  };
  const dot: Record<CardStatus, string> = {
    good: 'bg-success', warning: 'bg-warning', critical: 'bg-danger', neutral: 'bg-fg-muted/40',
  };

  return (
    <Card
      className={`p-6 transition-all ${statusColors[status]} ${onClick ? 'cursor-pointer hover:shadow-lg' : ''}`}
      onClick={onClick}
    >
      <div className="flex items-start justify-between mb-4">
        <Icon size={20} className="text-fg-muted" weight="regular" />
        <div className={`w-2 h-2 rounded-full ${dot[status]}`} />
      </div>
      <p className="text-sm font-medium text-fg-muted mb-2">{label}</p>
      <p className="text-3xl font-bold text-fg font-inter">{value}</p>
    </Card>
  );
}

const ISSUE_ACTION: Record<DashboardIssue['type'], string> = {
  LATE: 'Open rota',
  UNCOVERED_SHIFT: 'Cover shift',
  ATTENDANCE_REVIEW: 'Review attendance',
  RIGHT_TO_WORK: 'Open Right to Work',
  TIMESHEET_APPROVAL: 'Review timesheet',
  LEAVE_APPROVAL: 'Review leave',
};

function IssueRow({ issue, onAction }: { issue: DashboardIssue; onAction: () => void }) {
  const styles = {
    critical: 'border-danger/30 bg-danger/5',
    warning: 'border-warning/30 bg-warning/5',
    info: 'border-info/30 bg-info/5',
  }[issue.severity];
  const icon = {
    critical: <ExclamationMarkIcon size={18} className="text-danger" weight="bold" />,
    warning: <WarningCircleIcon size={18} className="text-warning" weight="bold" />,
    info: <CheckCircleIcon size={18} className="text-info" weight="regular" />,
  }[issue.severity];

  const context = [
    issue.house?.name,
    issue.at ? formatTime(issue.at) : null,
  ].filter(Boolean).join(' • ');

  return (
    <div className={`border rounded-lg p-4 ${styles}`}>
      <div className="flex items-start gap-3">
        <div className="mt-0.5">{icon}</div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-fg text-sm">{issue.title}</p>
          <p className="text-sm text-fg-muted mt-1">{issue.detail}</p>
          {context && <p className="text-xs text-fg-muted mt-1">{context}</p>}
          <div className="mt-3">
            <Button size="sm" variant="ghost" onClick={onAction}>
              {ISSUE_ACTION[issue.type]}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function attendanceBadge(a: DashboardShift['attendance']) {
  const map: Record<DashboardShift['attendance'], 'info' | 'success' | 'warning' | 'danger' | 'neutral'> = {
    Scheduled: 'info',
    'Clocked in': 'success',
    Late: 'warning',
    Completed: 'neutral',
    'Needs review': 'danger',
    Open: 'warning',
  };
  return <Badge variant={map[a]} label={a} dot={false} />;
}

export function OpsToday() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const canSee = user?.role !== 'WORKER';
  const { data, isLoading, isError } = useDashboardToday(canSee);

  const now = new Date();
  const greetingName = firstNameOf(user);

  if (isLoading) {
    return (
      <div>
        <div className="mb-8 pb-8 border-b border-neutral-200">
          <div className="animate-pulse">
            <div className="h-8 bg-neutral-200 rounded w-1/3 mb-2" />
            <div className="h-4 bg-neutral-200 rounded w-1/4" />
          </div>
        </div>
        <StatsSkeleton count={4} />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="space-y-8">
        <div className="pb-8 border-b border-neutral-200">
          <h1 className="text-3xl font-bold text-fg tracking-tight">
            {getGreeting()}{greetingName ? `, ${greetingName}` : ''}
          </h1>
          <p className="text-sm text-fg-muted mt-2">{formatFullDate(now)}</p>
        </div>
        <Card className="p-6 text-center">
          <WarningCircleIcon size={32} className="mx-auto text-warning mb-3" weight="regular" />
          <p className="text-fg font-medium">Couldn&apos;t load today&apos;s overview</p>
          <p className="text-sm text-fg-muted mt-1">Refresh the page to try again.</p>
        </Card>
      </div>
    );
  }

  const { coverage, pendingApprovals, issues, todayShifts, tomorrow, permissions, staff, openShifts } = data;
  const agencyName = user?.agency?.name ?? '';

  const statusPill =
    data.openIssues > 0
      ? { cls: 'bg-warning/10 text-warning-text', dot: 'bg-warning', label: 'Attention required' }
      : coverage.percent === null
      ? { cls: 'bg-surface-subtle text-fg-muted', dot: 'bg-fg-muted/40', label: 'No shifts today' }
      : { cls: 'bg-success/10 text-success-text', dot: 'bg-success', label: 'Operations healthy' };

  const coverageStatus: CardStatus =
    coverage.percent === null ? 'neutral'
    : coverage.percent >= 95 ? 'good'
    : coverage.percent >= 80 ? 'warning'
    : 'critical';

  return (
    <div className="space-y-8">
      {/* ─── Header ─────────────────────────────────────────────── */}
      <div className="pb-8 border-b border-neutral-200">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-fg tracking-tight">
              {getGreeting()}{greetingName ? `, ${greetingName}` : ''}
            </h1>
            <p className="text-sm text-fg-muted mt-2">
              {formatFullDate(now)}{agencyName ? ` • ${agencyName}` : ''}
            </p>
          </div>
          <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium ${statusPill.cls}`}>
            <div className={`w-2 h-2 rounded-full ${statusPill.dot}`} />
            {statusPill.label}
          </div>
        </div>
      </div>

      {/* ─── No staff yet ───────────────────────────────────────── */}
      {staff.total === 0 && (
        <div className="rounded-lg border border-info/30 bg-info/5 p-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <UsersIcon size={20} className="text-info" weight="regular" />
            <div>
              <p className="font-semibold text-fg text-sm">No staff have been added yet</p>
              <p className="text-sm text-fg-muted">Invite your team to start scheduling shifts.</p>
            </div>
          </div>
          {permissions.canManageStaff && (
            <Button size="sm" variant="primary" onClick={() => router.push('/dashboard/workers')}>
              Add / invite staff
            </Button>
          )}
        </div>
      )}

      {/* ─── Summary cards ──────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          label="Coverage Today"
          value={coverage.percent === null ? 'No shifts' : `${coverage.percent}%`}
          status={coverageStatus}
          icon={CheckCircleIcon}
          onClick={() => router.push('/dashboard/rota')}
        />
        <KPICard
          label="Workers Live"
          value={data.workersLive}
          status={data.workersLive > 0 ? 'good' : 'neutral'}
          icon={CalendarBlankIcon}
        />
        <KPICard
          label="Open Issues"
          value={data.openIssues}
          status={data.openIssues === 0 ? 'good' : data.openIssues <= 2 ? 'warning' : 'critical'}
          icon={WarningCircleIcon}
        />
        <KPICard
          label="Pending Approvals"
          value={pendingApprovals.total}
          status={pendingApprovals.total === 0 ? 'good' : pendingApprovals.total <= 3 ? 'warning' : 'critical'}
          icon={ClockIcon}
          onClick={permissions.canReviewApprovals ? () => router.push('/dashboard/timesheets') : undefined}
        />
      </div>

      {/* ─── Issues requiring attention ─────────────────────────── */}
      <section>
        <h2 className="text-lg font-semibold text-fg mb-4">Issues Requiring Attention</h2>
        {issues.length === 0 ? (
          <div className="rounded-lg border border-success/20 bg-success/5 p-6 text-center">
            <CheckCircleIcon size={32} className="mx-auto text-success mb-3" weight="regular" />
            <p className="text-fg font-medium">No open issues today</p>
            <p className="text-sm text-fg-muted mt-1">Everything is running smoothly</p>
          </div>
        ) : (
          <div className="space-y-3">
            {issues.map((issue) => (
              <IssueRow key={issue.id} issue={issue} onAction={() => router.push(issue.href)} />
            ))}
          </div>
        )}
      </section>

      {/* ─── Today's shifts ─────────────────────────────────────── */}
      <section>
        <h2 className="text-lg font-semibold text-fg mb-4">Today&apos;s Shifts</h2>
        <Card className="overflow-hidden">
          {todayShifts.length === 0 ? (
            <div className="p-8 text-center">
              <CalendarBlankIcon size={32} className="mx-auto text-fg-muted mb-3" weight="regular" />
              <p className="text-fg font-medium">No shifts scheduled today</p>
              {permissions.canCreateShift && (
                <div className="mt-4">
                  <Button size="sm" variant="primary" onClick={() => router.push('/dashboard/rota')}>
                    Create shift
                  </Button>
                </div>
              )}
            </div>
          ) : (
            <div className="divide-y divide-neutral-200">
              {todayShifts.map((shift) => (
                <div key={shift.id} className="p-4 flex items-center justify-between gap-4 hover:bg-neutral-50 transition-colors">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                      <p className="font-semibold text-fg">{shift.worker?.name ?? 'Open shift'}</p>
                      {attendanceBadge(shift.attendance)}
                    </div>
                    <p className="text-sm text-fg-muted">
                      {shift.house?.name ?? 'Unassigned service'} • {formatTime(shift.startTime)} – {formatTime(shift.endTime)}
                    </p>
                  </div>
                  <span className="text-xs font-medium text-fg-muted flex-shrink-0">
                    {shift.shiftType?.replace(/_/g, ' ') || 'Standard'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </section>

      {/* ─── Open / cover shifts needing a worker ───────────────── */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-fg">Open shifts needing cover</h2>
          {openShifts.length > 0 && (
            <button onClick={() => router.push('/dashboard/rota')} className="text-sm font-medium text-brand-700 hover:underline">
              Manage rota
            </button>
          )}
        </div>
        <Card className="overflow-hidden">
          {openShifts.length === 0 ? (
            <div className="p-8 text-center">
              <CheckCircleIcon size={32} className="mx-auto text-success mb-3" weight="regular" />
              <p className="text-fg font-medium">No open shifts</p>
              <p className="text-sm text-fg-muted mt-1">Every shift in the next two weeks has a worker.</p>
            </div>
          ) : (
            <div className="divide-y divide-neutral-200">
              {openShifts.map((s: DashboardOpenShift) => (
                <button
                  key={s.id}
                  onClick={() => router.push(s.href)}
                  className="w-full p-4 flex items-center justify-between gap-4 text-left hover:bg-neutral-50 transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                      <p className="font-semibold text-fg">{s.house?.name ?? 'Unassigned service'}</p>
                      {s.urgent && <Badge variant="danger" label="Urgent" dot={false} />}
                      <Badge variant="warning" label={`${s.claimCount} claim${s.claimCount === 1 ? '' : 's'}`} dot={false} />
                    </div>
                    <p className="text-sm text-fg-muted">
                      {new Date(s.startTime).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}
                      {' • '}{formatTime(s.startTime)} – {formatTime(s.endTime)}
                      {' • '}{(s.eligibleRoles[0] ?? 'WORKER').replace(/_/g, ' ').toLowerCase()}
                    </p>
                  </div>
                  <span className="flex items-center gap-2 text-xs font-medium text-fg-muted flex-shrink-0">
                    {s.shiftType?.replace(/_/g, ' ') || 'Standard'}
                    <ArrowRightIcon size={16} weight="bold" />
                  </span>
                </button>
              ))}
            </div>
          )}
        </Card>
      </section>

      {/* ─── Pending approvals ──────────────────────────────────── */}
      {permissions.canReviewApprovals && (
        <section>
          <h2 className="text-lg font-semibold text-fg mb-4">Pending Approvals</h2>
          <Card>
            {pendingApprovals.total === 0 ? (
              <div className="p-6 text-center">
                <CheckCircleIcon size={32} className="mx-auto text-success mb-3" weight="regular" />
                <p className="text-fg font-medium">No pending approvals</p>
                <p className="text-sm text-fg-muted mt-1">All requests have been reviewed</p>
              </div>
            ) : (
              <div className="divide-y divide-neutral-200">
                {[
                  { label: 'Timesheets', count: pendingApprovals.timesheets, href: '/dashboard/timesheets' },
                  { label: 'Attendance reviews', count: pendingApprovals.attendanceReviews, href: '/dashboard/timesheets' },
                  { label: 'Leave requests', count: pendingApprovals.leave, href: '/dashboard/leave' },
                ].map((row) => (
                  <button
                    key={row.label}
                    onClick={() => router.push(row.href)}
                    className="w-full p-4 flex items-center justify-between hover:bg-neutral-50 transition-colors text-left disabled:opacity-50"
                    disabled={row.count === 0}
                  >
                    <span className="text-sm font-medium text-fg">{row.label}</span>
                    <span className="flex items-center gap-2 text-sm text-fg-muted">
                      {row.count} pending
                      <ArrowRightIcon size={16} weight="bold" />
                    </span>
                  </button>
                ))}
              </div>
            )}
          </Card>
        </section>
      )}

      {/* ─── Tomorrow preview ───────────────────────────────────── */}
      <section>
        <h2 className="text-lg font-semibold text-fg mb-4">Tomorrow&apos;s Preview</h2>
        <Card className="p-6">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-fg-muted">
              {new Date(now.getTime() + 86_400_000).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' })}
            </p>
            <p className="text-2xl font-bold text-fg font-inter">{tomorrow.count} shifts</p>
          </div>
          {tomorrow.shifts.length > 0 && (
            <div className="pt-4 mt-4 border-t border-neutral-200 space-y-2">
              {tomorrow.shifts.map((shift) => (
                <div key={shift.id} className="flex items-center justify-between text-sm">
                  <span className="text-fg">{shift.worker?.name ?? 'Open shift'}</span>
                  <span className="text-fg-muted">{formatTime(shift.startTime)} – {formatTime(shift.endTime)}</span>
                </div>
              ))}
              {tomorrow.count > tomorrow.shifts.length && (
                <p className="text-sm text-fg-muted pt-2">+{tomorrow.count - tomorrow.shifts.length} more</p>
              )}
            </div>
          )}
        </Card>
      </section>

      {/* ─── Quick actions ──────────────────────────────────────── */}
      {(permissions.canCreateShift || permissions.canManageStaff) && (
        <section>
          <h2 className="text-lg font-semibold text-fg mb-4">Quick Actions</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {permissions.canCreateShift && (
              <Button variant="primary" className="w-full" onClick={() => router.push('/dashboard/rota')}>Create shift</Button>
            )}
            {permissions.canCreateShift && (
              <Button variant="secondary" className="w-full" onClick={() => router.push('/dashboard/workers')}>Assign worker</Button>
            )}
            {permissions.canManageStaff && (
              <Button variant="secondary" className="w-full" onClick={() => router.push('/dashboard/workers')}>Invite staff</Button>
            )}
            {permissions.canManageStaff && (
              <Button variant="secondary" className="w-full" onClick={() => router.push('/dashboard/houses')}>Add service</Button>
            )}
          </div>
        </section>
      )}

      {/* ─── Live activity ──────────────────────────────────────── */}
      <section>
        <ActivityFeed limit={8} title="Live Activity" />
      </section>
    </div>
  );
}
