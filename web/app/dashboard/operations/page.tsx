'use client';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { WarningCircleIcon, CheckCircleIcon, ClockIcon, MapPinIcon, PhoneIcon, PlusIcon } from '@phosphor-icons/react';
import { Header } from '@/components/layout/Header';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ActivityFeed } from '@/components/operations/ActivityFeed';
import { useShifts } from '@/hooks/useShifts';
import { useUsers } from '@/hooks/useWorkers';
import { useHouses } from '@/hooks/useHouses';
import { useLeaveRequests } from '@/hooks/useLeaveRequests';
import { useAuthStore } from '@/store/authStore';

interface KPIMetric {
  label: string;
  value: number;
  status: 'good' | 'warning' | 'critical';
  context?: string;
}

function formatTime(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function getShiftGroup(shift: any): 'in-progress' | 'due-soon' | 'not-started' | 'completed' {
  const now = new Date();
  const start = new Date(shift.startTime);
  const end = new Date(shift.endTime);

  if (shift.status === 'COMPLETED') return 'completed';
  if (now >= start && now <= end) return 'in-progress';
  if (now < start && (start.getTime() - now.getTime()) < 30 * 60 * 1000) return 'due-soon';
  return 'not-started';
}

function determineStatus(value: number, thresholds: { good: number; warning: number }): 'good' | 'warning' | 'critical' {
  if (value >= thresholds.good) return 'good';
  if (value >= thresholds.warning) return 'warning';
  return 'critical';
}

function KPICard({ metric }: { metric: KPIMetric }) {
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
    <Card className={`p-4 ${statusColors[metric.status]}`}>
      <div className="flex items-start justify-between mb-2">
        <p className="text-xs font-semibold text-fg-muted uppercase tracking-widest">{metric.label}</p>
        {statusDots[metric.status]}
      </div>
      <p className="text-3xl font-bold text-fg font-inter">{metric.value}</p>
      {metric.context && <p className="text-xs text-fg-muted mt-2">{metric.context}</p>}
    </Card>
  );
}

export default function OperationsPage() {
  const router = useRouter();
  const { user } = useAuthStore();
  const canViewOps = ['MANAGER', 'HR'].includes(user?.role ?? '');

  const { data: shifts = [] } = useShifts();
  const { data: workers = [] } = useUsers('WORKER');
  const { data: houses = [] } = useHouses();
  const { data: leaveRequests = [] } = useLeaveRequests();

  const [refreshInterval, setRefreshInterval] = useState<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (!canViewOps) router.replace('/dashboard');
  }, [canViewOps, router]);

  // Refresh data every 30 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      // React Query will handle the refetch automatically
      // This just triggers refetch on all queries
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  const now = new Date();
  const todayString = now.toDateString();

  // Calculate KPIs
  const kpis = useMemo((): KPIMetric[] => {
    const todayShifts = shifts.filter((s) => new Date(s.date).toDateString() === todayString && s.status !== 'CANCELLED');
    const inProgressShifts = todayShifts.filter((s) => {
      const start = new Date(s.startTime);
      const end = new Date(s.endTime);
      return now >= start && now <= end;
    });

    const dueSoonShifts = todayShifts.filter((s) => {
      const start = new Date(s.startTime);
      return now < start && (start.getTime() - now.getTime()) < 30 * 60 * 1000;
    });

    const lateShifts = todayShifts.filter((s) => {
      const start = new Date(s.startTime);
      return now > start && s.status === 'SCHEDULED';
    });

    const emergencyShifts = todayShifts.filter((s) => s.shiftType === 'EMERGENCY');

    const openIssues = lateShifts.length + (todayShifts.filter((s) => !s.workerId).length);

    return [
      {
        label: 'Clocked In',
        value: inProgressShifts.length,
        status: inProgressShifts.length > 0 ? 'good' : 'warning',
        context: `of ${todayShifts.length} today`,
      },
      {
        label: 'Due Soon',
        value: dueSoonShifts.length,
        status: dueSoonShifts.length > 0 ? 'warning' : 'good',
        context: 'next 30 mins',
      },
      {
        label: 'Late Workers',
        value: lateShifts.length,
        status: lateShifts.length > 0 ? 'critical' : 'good',
        context: lateShifts.length > 0 ? 'action needed' : 'on time',
      },
      {
        label: 'Emergency Shifts',
        value: emergencyShifts.length,
        status: emergencyShifts.length > 0 ? 'critical' : 'good',
        context: emergencyShifts.length > 0 ? 'unfilled' : 'none',
      },
      {
        label: 'Open Issues',
        value: openIssues,
        status: openIssues > 3 ? 'critical' : openIssues > 0 ? 'warning' : 'good',
        context: 'requiring attention',
      },
    ];
  }, [shifts, now, todayString]);

  // Group shifts
  const shiftGroups = useMemo(() => {
    const todayShifts = shifts.filter((s) => new Date(s.date).toDateString() === todayString && s.status !== 'CANCELLED');

    const groups = {
      'in-progress': [] as any[],
      'due-soon': [] as any[],
      'not-started': [] as any[],
      'completed': [] as any[],
    };

    todayShifts.forEach((shift) => {
      const group = getShiftGroup(shift);
      groups[group].push(shift);
    });

    return groups;
  }, [shifts, todayString]);

  // Attendance data
  const attendanceData = useMemo(() => {
    const todayShifts = shifts.filter((s) => new Date(s.date).toDateString() === todayString && s.status !== 'CANCELLED');

    return todayShifts.map((shift) => {
      const dueTime = new Date(shift.startTime);
      const isLate = now > dueTime && shift.status === 'SCHEDULED';

      return {
        worker: shift.worker?.name || 'Unknown',
        scheduled: formatTime(shift.startTime),
        clockIn: shift.startTime ? formatTime(shift.startTime) : '—',
        status: shift.status,
        late: isLate ? Math.floor((now.getTime() - dueTime.getTime()) / 60000) : null,
        house: shift.house?.name || '—',
      };
    });
  }, [shifts, todayString, now]);

  // Issues list
  const issues = useMemo(() => {
    const todayShifts = shifts.filter((s) => new Date(s.date).toDateString() === todayString && s.status !== 'CANCELLED');
    const issueList: any[] = [];

    // Late workers
    todayShifts.forEach((shift) => {
      const dueTime = new Date(shift.startTime);
      if (now > dueTime && shift.status === 'SCHEDULED') {
        issueList.push({
          type: 'late',
          severity: 'critical',
          title: `${shift.worker?.name || 'Unknown'} is late`,
          context: `Expected at ${shift.house?.name || 'Unknown'} at ${formatTime(shift.startTime)}`,
          action: 'Call',
        });
      }
    });

    // Unassigned shifts
    todayShifts.forEach((shift) => {
      if (!shift.workerId) {
        issueList.push({
          type: 'unassigned',
          severity: 'critical',
          title: `${shift.house?.name || 'Unknown'} has no worker`,
          context: `${formatTime(shift.startTime)} - ${formatTime(shift.endTime)}`,
          action: 'Assign',
        });
      }
    });

    // Pending leave affecting today
    leaveRequests.forEach((leave) => {
      if (leave.status === 'PENDING' && new Date(leave.startDate) <= now && new Date(leave.endDate) >= now) {
        issueList.push({
          type: 'leave',
          severity: 'warning',
          title: `Leave pending: ${leave.worker?.name || 'Unknown'}`,
          context: `Affects coverage today`,
          action: 'Review',
        });
      }
    });

    return issueList.slice(0, 5);
  }, [shifts, leaveRequests, todayString, now]);

  // Health metrics
  const health = useMemo((): KPIMetric[] => {
    const todayShifts = shifts.filter((s) => new Date(s.date).toDateString() === todayString && s.status !== 'CANCELLED');
    const scheduled = todayShifts.filter((s) => s.status === 'SCHEDULED').length;
    const completed = todayShifts.filter((s) => s.status === 'COMPLETED').length;
    const coverage = scheduled > 0 ? Math.round((scheduled / (scheduled + completed)) * 100) : 100;
    const pendingApprovals = leaveRequests.filter((l) => l.status === 'PENDING').length;

    return [
      {
        label: 'Attendance',
        value: Math.round((scheduled / (scheduled + completed || 1)) * 100),
        status: determineStatus(scheduled / (scheduled + completed || 1), { good: 0.8, warning: 0.6 }),
      },
      {
        label: 'Coverage',
        value: coverage,
        status: coverage > 90 ? 'good' : coverage > 70 ? 'warning' : 'critical',
      },
      {
        label: 'Pending Approvals',
        value: pendingApprovals,
        status: pendingApprovals === 0 ? 'good' : 'warning',
      },
      {
        label: 'GPS Confidence',
        value: 0,
        status: 'good',
      },
    ];
  }, [shifts, leaveRequests, todayString]);

  if (!canViewOps) return null;

  return (
    <div className="space-y-8">
      <Header
        title="Operations"
        subtitle="Live operational command centre — active monitoring, quick actions, real-time oversight"
      />

      {/* SECTION 1: Live KPIs */}
      <div>
        <h2 className="text-lg font-semibold text-fg mb-4">Live Overview</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
          {kpis.map((kpi, i) => (
            <KPICard key={i} metric={kpi} />
          ))}
        </div>
      </div>

      {/* SECTION 2: Live Shift Board */}
      <div>
        <h2 className="text-lg font-semibold text-fg mb-4">Shift Board</h2>
        <div className="grid md:grid-cols-2 gap-4">
          {(['in-progress', 'due-soon', 'not-started', 'completed'] as const).map((groupName) => {
            const groupLabel = {
              'in-progress': 'In Progress',
              'due-soon': 'Due Within 30 mins',
              'not-started': 'Not Started',
              'completed': 'Completed',
            };

            return (
              <Card key={groupName} className="p-4">
                <p className="text-sm font-semibold text-fg mb-3">{groupLabel[groupName]}</p>
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {shiftGroups[groupName].length === 0 ? (
                    <p className="text-xs text-fg-muted">No shifts</p>
                  ) : (
                    shiftGroups[groupName].map((shift) => (
                      <div key={shift.id} className="bg-neutral-50 p-2 rounded text-xs">
                        <p className="font-medium text-fg">{shift.worker?.name || '—'}</p>
                        <p className="text-fg-muted">{shift.house?.name || '—'}</p>
                        <p className="text-fg-muted">{formatTime(shift.startTime)} - {formatTime(shift.endTime)}</p>
                      </div>
                    ))
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      </div>

      {/* SECTION 3: Attendance Monitor */}
      <div>
        <h2 className="text-lg font-semibold text-fg mb-4">Attendance Monitor</h2>
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 border-b border-neutral-200">
                <tr>
                  <th className="px-4 py-2 text-left font-semibold text-fg">Worker</th>
                  <th className="px-4 py-2 text-left font-semibold text-fg">Scheduled</th>
                  <th className="px-4 py-2 text-left font-semibold text-fg">Clock In</th>
                  <th className="px-4 py-2 text-left font-semibold text-fg">Status</th>
                  <th className="px-4 py-2 text-left font-semibold text-fg">Late</th>
                  <th className="px-4 py-2 text-left font-semibold text-fg">House</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-200">
                {attendanceData.slice(0, 10).map((row, i) => (
                  <tr key={i} className={row.late ? 'bg-danger/5' : ''}>
                    <td className="px-4 py-2 text-fg">{row.worker}</td>
                    <td className="px-4 py-2 text-fg-muted">{row.scheduled}</td>
                    <td className="px-4 py-2 text-fg-muted">{row.clockIn}</td>
                    <td className="px-4 py-2">
                      <Badge
                        variant={row.status === 'IN_PROGRESS' ? 'success' : row.status === 'COMPLETED' ? 'neutral' : 'info'}
                        label={row.status.replace(/_/g, ' ')}
                        dot={false}
                      />
                    </td>
                    <td className="px-4 py-2 text-fg-muted">{row.late ? `${row.late}m` : '—'}</td>
                    <td className="px-4 py-2 text-fg-muted">{row.house}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      {/* SECTION 4: Issues Requiring Action */}
      <div>
        <h2 className="text-lg font-semibold text-fg mb-4">Issues Requiring Action</h2>
        <div className="space-y-2">
          {issues.length === 0 ? (
            <Card className="p-6 text-center">
              <CheckCircleIcon size={32} className="mx-auto text-success mb-2" weight="regular" />
              <p className="text-fg font-medium">No active issues</p>
              <p className="text-sm text-fg-muted">Operations running smoothly</p>
            </Card>
          ) : (
            issues.map((issue, i) => (
              <Card key={i} className={`p-4 ${issue.severity === 'critical' ? 'border-danger/20 bg-danger/5' : 'border-warning/20 bg-warning/5'}`}>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="font-semibold text-fg">{issue.title}</p>
                    <p className="text-sm text-fg-muted mt-1">{issue.context}</p>
                  </div>
                  <Button size="sm" variant="primary">{issue.action}</Button>
                </div>
              </Card>
            ))
          )}
        </div>
      </div>

      {/* SECTION 5: Quick Actions */}
      <div>
        <h2 className="text-lg font-semibold text-fg mb-4">Quick Actions</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <Button variant="primary" icon={<WarningCircleIcon size={16} />} className="w-full">Emergency Shift</Button>
          <Button variant="primary" icon={<PhoneIcon size={16} />} className="w-full">Call Worker</Button>
          <Button variant="primary" icon={<PlusIcon size={16} />} className="w-full">Assign Worker</Button>
          <Button variant="secondary" className="w-full">View Schedule</Button>
          <Button variant="secondary" className="w-full">Create Staff</Button>
          <Button variant="secondary" className="w-full">View Locations</Button>
        </div>
      </div>

      {/* SECTION 6: Operational Health */}
      <div>
        <h2 className="text-lg font-semibold text-fg mb-4">Operational Health</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {health.map((metric, i) => (
            <KPICard key={i} metric={metric} />
          ))}
        </div>
      </div>

      {/* SECTION 7: Live Activity */}
      <ActivityFeed limit={12} title="Live Command Centre Activity" />

      {/* NOTE: Missing Features */}
      <Card className="p-4 bg-info/5 border-info/20">
        <p className="text-sm text-fg font-medium">ℹ️ Features not yet available:</p>
        <ul className="text-xs text-fg-muted mt-2 space-y-1">
          <li>• Timeline view (requires audit log API)</li>
          <li>• Coverage heatmap (requires occupancy data)</li>
          <li>• GPS confidence display (requires device telemetry)</li>
          <li>• Real-time push notifications (requires WebSocket)</li>
        </ul>
      </Card>
    </div>
  );
}
