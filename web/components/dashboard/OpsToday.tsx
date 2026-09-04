'use client';
import { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircleIcon, WarningCircleIcon, ClockIcon, ExclamationMarkIcon, CalendarBlankIcon } from '@phosphor-icons/react';
import { useShifts } from '@/hooks/useShifts';
import { useHouses } from '@/hooks/useHouses';
import { useUsers } from '@/hooks/useWorkers';
import { useLeaveRequests, useApproveLeaveRequest } from '@/hooks/useLeaveRequests';
import { useAuthStore } from '@/store/authStore';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { StatsSkeleton } from '@/components/ui/Skeleton';
import { ActivityFeed } from '@/components/operations/ActivityFeed';
import { useToast } from '@/hooks/useToast';

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function formatFullDate(date: Date) {
  return date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

function getGreeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

// KPI Card Component
function KPICard({
  label,
  value,
  status,
  icon: Icon,
  onClick,
}: {
  label: string;
  value: number | string;
  status: 'good' | 'warning' | 'critical';
  icon: React.ElementType;
  onClick?: () => void;
}) {
  const statusColors = {
    good: 'bg-success/10 border-success/20',
    warning: 'bg-warning/10 border-warning/20',
    critical: 'bg-danger/10 border-danger/20',
  };

  const statusDots = {
    good: <div className="w-2 h-2 rounded-full bg-success" />,
    warning: <div className="w-2 h-2 rounded-full bg-warning" />,
    critical: <div className="w-2 h-2 rounded-full bg-danger" />,
  };

  return (
    <Card
      className={`p-6 cursor-pointer transition-all hover:shadow-lg ${statusColors[status]} ${onClick ? 'cursor-pointer' : ''}`}
      onClick={onClick}
    >
      <div className="flex items-start justify-between mb-4">
        <Icon size={20} className="text-fg-muted" weight="regular" />
        {statusDots[status]}
      </div>
      <div>
        <p className="text-sm font-medium text-fg-muted mb-2">{label}</p>
        <p className="text-3xl font-bold text-fg font-inter">{value}</p>
      </div>
    </Card>
  );
}

// Problem Alert Component
function ProblemAlert({
  severity,
  title,
  description,
  actions,
}: {
  severity: 'critical' | 'warning' | 'info';
  title: string;
  description: string;
  actions: { label: string; onClick?: () => void }[];
}) {
  const severityStyles = {
    critical: 'border-danger/30 bg-danger/5',
    warning: 'border-warning/30 bg-warning/5',
    info: 'border-info/30 bg-info/5',
  };

  const severityIcons = {
    critical: <ExclamationMarkIcon size={18} className="text-danger" weight="bold" />,
    warning: <WarningCircleIcon size={18} className="text-warning" weight="bold" />,
    info: <CheckCircleIcon size={18} className="text-info" weight="regular" />,
  };

  return (
    <div className={`border rounded-lg p-4 ${severityStyles[severity]}`}>
      <div className="flex items-start gap-3">
        <div className="mt-0.5">{severityIcons[severity]}</div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-fg text-sm">{title}</p>
          <p className="text-sm text-fg-muted mt-1">{description}</p>
          <div className="flex gap-2 mt-3">
            {actions.map((action, i) => (
              <Button
                key={i}
                size="sm"
                variant="ghost"
                onClick={action.onClick}
              >
                {action.label}
              </Button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function OpsToday() {
  const router = useRouter();
  const toast = useToast();
  const user = useAuthStore((s) => s.user);
  const { data: shifts = [], isLoading: shiftsLoading } = useShifts();
  const { data: houses = [] } = useHouses();
  const { data: workers = [] } = useUsers('WORKER');
  const { data: leaveRequests = [] } = useLeaveRequests({ status: 'PENDING' });
  const approveLeave = useApproveLeaveRequest();

  async function handleApproveLeave(id: string) {
    try {
      await approveLeave.mutateAsync(id);
      toast.success('Leave request approved');
    } catch (err: any) {
      toast.error(err.response?.data?.message ?? 'Failed to approve leave');
    }
  }

  const now = new Date();
  const todayString = now.toDateString();

  // Calculate operational metrics
  const metrics = useMemo(() => {
    const activeSchedule = shifts.filter((s) => s.status !== 'CANCELLED');
    const todayShifts = activeSchedule.filter((s) => new Date(s.date).toDateString() === todayString);

    // Actually clocked in right now (status flips SCHEDULED -> IN_PROGRESS on clock-in).
    const activeShifts = todayShifts.filter((s) => s.status === 'IN_PROGRESS');

    // Shift window has started but the worker hasn't clocked in yet.
    const lateWorkers = todayShifts.filter(
      (s) => s.status === 'SCHEDULED' && new Date(s.startTime) <= now && new Date(s.endTime) >= now
    );

    // Genuinely unfilled shifts today — no worker assigned, regardless of time.
    const openShifts = todayShifts.filter((s) => s.status === 'OPEN' || !s.workerId);

    // Share of today's shifts that are actually staffed.
    const coverage = todayShifts.length > 0
      ? Math.round(((todayShifts.length - openShifts.length) / todayShifts.length) * 100)
      : 100;

    return {
      coverage,
      workersLive: activeShifts.length,
      openIssues: lateWorkers.length + openShifts.length,
      pendingApprovals: leaveRequests.length,
      todayShifts,
      activeShifts,
      openShifts,
      lateWorkers,
    };
  }, [shifts, leaveRequests, todayString, now]);

  // Generate operational status
  const operationalStatus = metrics.coverage >= 95 && metrics.openIssues === 0
    ? 'healthy'
    : 'attention-required';

  const isLoading = shiftsLoading;
  const firstName = user?.name?.split(' ')[0] ?? 'there';
  const agencyName = user?.agency?.name ?? '';

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

  return (
    <div className="space-y-8">
      {/* ─── Header ─────────────────────────────────────────────── */}
      <div className="pb-8 border-b border-neutral-200">
        <div className="flex items-start justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold text-fg -0.5px tracking-tight">
              {getGreeting()}, {firstName}
            </h1>
            <p className="text-sm text-fg-muted mt-2">
              {formatFullDate(now)} • {agencyName}
            </p>
          </div>
          <div className="text-right">
            <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium ${
              operationalStatus === 'healthy'
                ? 'bg-success/10 text-success-text'
                : 'bg-warning/10 text-warning-text'
            }`}>
              <div className={`w-2 h-2 rounded-full ${operationalStatus === 'healthy' ? 'bg-success' : 'bg-warning'}`} />
              {operationalStatus === 'healthy'
                ? "Operations healthy"
                : "Attention required"}
            </div>
          </div>
        </div>
      </div>

      {/* ─── Operations Summary (4 Cards) ───────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          label="Coverage Today"
          value={`${metrics.coverage}%`}
          status={metrics.coverage >= 95 ? 'good' : metrics.coverage >= 80 ? 'warning' : 'critical'}
          icon={CheckCircleIcon}
        />
        <KPICard
          label="Workers Live"
          value={metrics.workersLive}
          status={metrics.workersLive > 0 ? 'good' : 'warning'}
          icon={CalendarBlankIcon}
        />
        <KPICard
          label="Open Issues"
          value={metrics.openIssues}
          status={metrics.openIssues === 0 ? 'good' : metrics.openIssues <= 2 ? 'warning' : 'critical'}
          icon={WarningCircleIcon}
        />
        <KPICard
          label="Pending Approvals"
          value={metrics.pendingApprovals}
          status={metrics.pendingApprovals === 0 ? 'good' : metrics.pendingApprovals <= 3 ? 'warning' : 'critical'}
          icon={ClockIcon}
        />
      </div>

      {/* ─── Problems That Need Attention ──────────────────────── */}
      <section>
        <h2 className="text-lg font-semibold text-fg mb-4">Issues Requiring Attention</h2>
        <div className="space-y-3">
          {metrics.openIssues === 0 ? (
            <div className="rounded-lg border border-success/20 bg-success/5 p-6 text-center">
              <CheckCircleIcon size={32} className="mx-auto text-success mb-3" weight="regular" />
              <p className="text-fg font-medium">No open issues today</p>
              <p className="text-sm text-fg-muted mt-1">Everything is running smoothly</p>
            </div>
          ) : (
            <>
              {metrics.lateWorkers.map((shift) => (
                <ProblemAlert
                  key={`late-${shift.id}`}
                  severity="warning"
                  title={`${shift.worker?.name ?? 'Worker'} is late`}
                  description={`Expected at ${shift.house.name} at ${formatTime(shift.startTime)}`}
                  actions={[{ label: 'Contact' }, { label: 'Resolve' }]}
                />
              ))}
              {metrics.openShifts.slice(0, 2).map((shift) => (
                <ProblemAlert
                  key={`open-${shift.id}`}
                  severity="critical"
                  title={`Unfilled shift: ${shift.house.name}`}
                  description={`${formatTime(shift.startTime)} – ${formatTime(shift.endTime)}`}
                  actions={[{ label: 'Assign Worker' }, { label: 'Details' }]}
                />
              ))}
            </>
          )}
        </div>
      </section>

      {/* ─── Today's Rota Snapshot ──────────────────────────────── */}
      <section>
        <h2 className="text-lg font-semibold text-fg mb-4">Today's Shifts</h2>
        <Card className="overflow-hidden">
          {metrics.todayShifts.length === 0 ? (
            <div className="p-6 text-center">
              <CalendarBlankIcon size={32} className="mx-auto text-fg-muted mb-3" weight="regular" />
              <p className="text-fg font-medium">No shifts scheduled today</p>
            </div>
          ) : (
            <div className="divide-y divide-neutral-200">
              {metrics.todayShifts.map((shift) => (
                <div key={shift.id} className="p-4 flex items-center justify-between hover:bg-neutral-50 transition-colors">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <p className="font-semibold text-fg">{shift.worker?.name ?? 'Open shift'}</p>
                      <Badge
                        variant={
                          shift.status === 'SCHEDULED'
                            ? 'info'
                            : shift.status === 'IN_PROGRESS'
                            ? 'success'
                            : shift.status === 'COMPLETED'
                            ? 'neutral'
                            : 'danger'
                        }
                        label={shift.status.replace(/_/g, ' ')}
                        dot={false}
                      />
                    </div>
                    <p className="text-sm text-fg-muted">
                      {shift.house.name} • {formatTime(shift.startTime)} – {formatTime(shift.endTime)}
                    </p>
                  </div>
                  <div className="text-right ml-4 flex-shrink-0">
                    <span className="text-xs font-medium text-fg-muted">
                      {shift.shiftType || 'Standard'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </section>

      {/* ─── Pending Approvals ──────────────────────────────────── */}
      <section>
        <h2 className="text-lg font-semibold text-fg mb-4">Pending Approvals</h2>
        <Card>
          {leaveRequests.length === 0 ? (
            <div className="p-6 text-center">
              <CheckCircleIcon size={32} className="mx-auto text-success mb-3" weight="regular" />
              <p className="text-fg font-medium">No pending approvals</p>
              <p className="text-sm text-fg-muted mt-1">All requests have been reviewed</p>
            </div>
          ) : (
            <div className="divide-y divide-neutral-200">
              {leaveRequests.slice(0, 5).map((leave) => (
                <div key={leave.id} className="p-4 flex items-center justify-between hover:bg-neutral-50 transition-colors">
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-fg text-sm">{leave.worker?.name || 'Unknown'}</p>
                    <p className="text-xs text-fg-muted mt-1">
                      {formatDate(leave.startDate)} – {formatDate(leave.endDate)} • {leave.reason}
                    </p>
                  </div>
                  <div className="ml-4 flex-shrink-0 flex gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleApproveLeave(leave.id)}
                      disabled={approveLeave.isPending}
                    >
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => router.push('/dashboard/leave')}
                    >
                      Reject
                    </Button>
                  </div>
                </div>
              ))}
              {leaveRequests.length > 5 && (
                <div className="p-4 text-center">
                  <p className="text-sm text-fg-muted">+{leaveRequests.length - 5} more pending</p>
                </div>
              )}
            </div>
          )}
        </Card>
      </section>

      {/* ─── Tomorrow Preview ───────────────────────────────────── */}
      <section>
        <h2 className="text-lg font-semibold text-fg mb-4">Tomorrow's Preview</h2>
        <Card className="p-6">
          {(() => {
            const tomorrow = new Date(now);
            tomorrow.setDate(tomorrow.getDate() + 1);
            const tomorrowString = tomorrow.toDateString();
            const tomorrowShifts = shifts.filter(
              (s) => s.status !== 'CANCELLED' && new Date(s.date).toDateString() === tomorrowString
            );

            return (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-fg-muted">
                    {tomorrow.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' })}
                  </p>
                  <p className="text-2xl font-bold text-fg font-inter">{tomorrowShifts.length} shifts</p>
                </div>
                {tomorrowShifts.length > 0 && (
                  <div className="pt-4 border-t border-neutral-200 space-y-2">
                    {tomorrowShifts.slice(0, 3).map((shift) => (
                      <div key={shift.id} className="flex items-center justify-between text-sm">
                        <span className="text-fg">{shift.worker?.name ?? 'Open shift'}</span>
                        <span className="text-fg-muted">{formatTime(shift.startTime)} – {formatTime(shift.endTime)}</span>
                      </div>
                    ))}
                    {tomorrowShifts.length > 3 && (
                      <p className="text-sm text-fg-muted pt-2">+{tomorrowShifts.length - 3} more</p>
                    )}
                  </div>
                )}
              </div>
            );
          })()}
        </Card>
      </section>

      {/* ─── Quick Actions ──────────────────────────────────────── */}
      <section>
        <h2 className="text-lg font-semibold text-fg mb-4">Quick Actions</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <Button variant="primary" className="w-full" onClick={() => router.push('/dashboard/rota')}>Create Shift</Button>
          <Button variant="primary" className="w-full" onClick={() => router.push('/dashboard/rota')}>Emergency Shift</Button>
          <Button variant="secondary" className="w-full" onClick={() => router.push('/dashboard/workers')}>Assign Worker</Button>
          <Button variant="secondary" className="w-full" onClick={() => router.push('/dashboard/workers')}>Create Staff</Button>
          <Button variant="secondary" className="w-full" onClick={() => router.push('/dashboard/houses')}>Create Service</Button>
        </div>
      </section>

      {/* ─── Live Activity ──────────────────────────────────────── */}
      <section>
        <ActivityFeed limit={8} title="Live Activity" />
      </section>
    </div>
  );
}
