'use client';
/**
 * Operations: today's shifts grouped by attendance state, plus issues, for
 * managers and HR. Built on GET /dashboard/today, which works out "today" in
 * the agency's timezone and applies each role's visibility rules.
 *
 * It refreshes every minute (not real time), and only shows figures the API
 * actually provides.
 */
import { showTime, showDate } from '@/lib/displayTime';
import { useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { WarningCircleIcon, ArrowClockwiseIcon, ArrowRightIcon } from '@phosphor-icons/react';
import { Header } from '@/components/layout/Header';
import { Card } from '@/components/ui/Card';
import { StatsSkeleton } from '@/components/ui/Skeleton';
import { ActivityFeed } from '@/components/operations/ActivityFeed';
import { useDashboardToday } from '@/hooks/useDashboard';
import { useAuthStore } from '@/store/authStore';
import { queryView } from '@/lib/dashboardView';
import type { DashboardShift } from '@/types';

function formatTime(iso: string) {
  return showTime(iso);
}

type Attendance = DashboardShift['attendance'];
const GROUPS: { key: Attendance; title: string; attention?: boolean }[] = [
  { key: 'Late', title: 'Late (not clocked in)', attention: true },
  { key: 'Open', title: 'No worker assigned', attention: true },
  { key: 'Needs review', title: 'Needs attendance review', attention: true },
  { key: 'Clocked in', title: 'Clocked in' },
  { key: 'Scheduled', title: 'Not started yet' },
  { key: 'Completed', title: 'Completed' },
];

export default function OperationsPage() {
  const router = useRouter();
  const { user } = useAuthStore();
  const canViewOps = ['MANAGER', 'HR'].includes(user?.role ?? '');
  const query = useDashboardToday(canViewOps);
  const view = queryView({ isLoading: query.isLoading, isError: query.isError, hasData: !!query.data });

  useEffect(() => {
    if (user && !canViewOps) router.replace('/dashboard');
  }, [user, canViewOps, router]);

  const groups = useMemo(() => {
    const by = new Map<Attendance, DashboardShift[]>();
    for (const s of query.data?.todayShifts ?? []) by.set(s.attendance, [...(by.get(s.attendance) ?? []), s]);
    return by;
  }, [query.data]);

  if (!canViewOps) return null;

  const updatedAt = query.dataUpdatedAt
    ? showTime(new Date(query.dataUpdatedAt))
    : null;

  return (
    <div className="space-y-6">
      <Header
        title="Operations"
        subtitle={
          view === 'stale'
            ? `Couldn't refresh. Showing figures from ${updatedAt}.`
            : updatedAt
            ? `Today's shifts and attendance for your services. Updated ${updatedAt}, refreshes every minute.`
            : "Today's shifts and attendance for your services. Refreshes every minute."
        }
        action={<Link href="/dashboard/rota" className="inline-flex h-10 items-center rounded-md border border-border bg-surface px-4 text-sm font-medium text-fg hover:bg-surface-subtle">Open schedule</Link>}
      />

      {view === 'loading' && <StatsSkeleton count={4} />}

      {view === 'error' && (
        <Card className="p-6 text-center">
          <WarningCircleIcon size={28} className="mx-auto mb-2 text-warning" aria-hidden="true" />
          <p className="font-medium text-fg" role="alert">Today&apos;s operations couldn&apos;t be loaded</p>
          <p className="mt-1 text-sm text-fg-muted">No figures are shown until they load.</p>
          <button type="button" onClick={() => query.refetch()} className="mt-4 inline-flex h-10 items-center gap-2 rounded-md border border-border bg-surface px-4 text-sm font-medium text-fg hover:bg-surface-subtle">
            <ArrowClockwiseIcon size={16} aria-hidden="true" /> Try again
          </button>
        </Card>
      )}

      {query.data && (() => {
        const d = query.data;
        const total = d.todayShifts.length;
        const figures = [
          { label: 'Shifts today', value: total, detail: total === 0 ? 'None scheduled' : `${d.coverage.covered} with a worker` },
          { label: 'Clocked in now', value: d.workersLive, detail: total === 0 ? 'No shifts today' : `of ${d.coverage.scheduled} scheduled` },
          { label: 'Late', value: groups.get('Late')?.length ?? 0, detail: total === 0 ? 'Not applicable today' : 'Past start, not clocked in', attention: (groups.get('Late')?.length ?? 0) > 0 },
          { label: 'Uncovered', value: d.coverage.uncovered, detail: total === 0 ? 'Not applicable today' : 'Today, need a worker', attention: d.coverage.uncovered > 0 },
        ];
        return (
          <>
            <section aria-labelledby="ops-figures">
              <h2 id="ops-figures" className="sr-only">Today at a glance</h2>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                {figures.map((f) => (
                  <div key={f.label} className={`rounded-lg border p-3 ${f.attention ? 'border-warning/30 bg-warning/5' : 'border-border bg-surface'}`}>
                    <p className="text-xs font-medium text-fg-muted">{f.label}</p>
                    <p className="mt-1 text-xl font-semibold text-fg font-inter">{f.value}</p>
                    <p className={`mt-0.5 text-xs ${f.attention ? 'font-medium text-warning-text' : 'text-fg-muted'}`}>{f.detail}</p>
                  </div>
                ))}
              </div>
            </section>

            <div className="grid gap-6 lg:grid-cols-3">
              <section className="lg:col-span-2" aria-labelledby="ops-board">
                <h2 id="ops-board" className="mb-3 text-base font-semibold text-fg">Today&apos;s shifts by status</h2>
                {total === 0 ? (
                  <Card className="p-4"><p className="text-sm text-fg-muted">No shifts scheduled today.</p></Card>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {GROUPS.filter((g) => (groups.get(g.key)?.length ?? 0) > 0).map((g) => (
                      <Card key={g.key} className={`p-3 ${g.attention ? 'border-warning/30' : ''}`}>
                        <p className="mb-2 text-sm font-semibold text-fg">{g.title} ({groups.get(g.key)!.length})</p>
                        <ul className="max-h-64 space-y-1.5 overflow-y-auto">
                          {groups.get(g.key)!.map((s) => (
                            <li key={s.id} className="rounded bg-surface-subtle p-2 text-xs">
                              <p className="font-medium text-fg">{s.worker?.name ?? 'No worker assigned'}</p>
                              <p className="text-fg-muted">{s.house?.name ?? 'No service'} · {formatTime(s.startTime)}–{formatTime(s.endTime)}</p>
                            </li>
                          ))}
                        </ul>
                      </Card>
                    ))}
                  </div>
                )}
              </section>

              <section aria-labelledby="ops-issues">
                <h2 id="ops-issues" className="mb-3 text-base font-semibold text-fg">Issues{d.issues.length ? ` (${d.issues.length})` : ''}</h2>
                {d.issues.length === 0 ? (
                  <Card className="p-4">
                    <p className="text-sm text-fg">No issues flagged.</p>
                    <p className="mt-1 text-xs text-fg-muted">Checked: late starts, uncovered shifts, attendance reviews, right to work and approvals.</p>
                  </Card>
                ) : (
                  <ul className="space-y-2">
                    {d.issues.map((issue) => (
                      <li key={issue.id} className={`rounded-lg border p-3 ${issue.severity === 'critical' ? 'border-danger/30 bg-danger/5' : issue.severity === 'warning' ? 'border-warning/30 bg-warning/5' : 'border-border bg-surface'}`}>
                        <p className="text-sm font-medium text-fg">{issue.title}</p>
                        <p className="text-xs text-fg-muted">{issue.detail}</p>
                        <Link href={issue.href} className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline">
                          Open <ArrowRightIcon size={12} aria-hidden="true" />
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          </>
        );
      })()}

      <ActivityFeed limit={12} title="Recent activity" />
    </div>
  );
}
