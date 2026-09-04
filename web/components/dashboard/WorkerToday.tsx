'use client';
import { useMemo } from 'react';
import Link from 'next/link';
import {
  CalendarBlankIcon, ClockIcon, MapPinIcon, CheckCircleIcon, MegaphoneIcon,
  ListChecksIcon, CaretRightIcon, ShieldCheckIcon, BookOpenIcon, PushPinIcon,
} from '@phosphor-icons/react';
import { Header } from '@/components/layout/Header';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { StatsSkeleton } from '@/components/ui/Skeleton';
import { useShifts } from '@/hooks/useShifts';
import { useMyTimesheets } from '@/hooks/useTimesheets';
import { useLeaveRequests } from '@/hooks/useLeaveRequests';
import { useAnnouncements } from '@/hooks/useAnnouncements';
import { useMyTraining, useMyDbs } from '@/hooks/useProfile';
import { useAuthStore } from '@/store/authStore';
import { SHIFT_TYPE_META } from '@/lib/shiftTypes';
import { clsx } from 'clsx';
import type { Shift, LeaveStatus, ShiftType } from '@/types';

const DAY_MS = 86_400_000;

function getGreeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function fmtFullDate(date: Date) {
  return date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

function fmtRange(start: string, end: string) {
  return `${fmtTime(start)} – ${fmtTime(end)}`;
}

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/** Monday 00:00 of the week containing `d`. */
function startOfWeek(d: Date) {
  const x = startOfDay(d);
  const day = (x.getDay() + 6) % 7; // 0 = Monday
  x.setDate(x.getDate() - day);
  return x;
}

function dayLabel(iso: string) {
  const d = startOfDay(new Date(iso));
  const today = startOfDay(new Date());
  const diff = Math.round((d.getTime() - today.getTime()) / DAY_MS);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

function relativeDate(iso: string) {
  const diff = Math.round((Date.now() - new Date(iso).getTime()) / DAY_MS);
  if (diff <= 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff < 7) return `${diff} days ago`;
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function hoursBetween(start: string, end: string) {
  return (new Date(end).getTime() - new Date(start).getTime()) / 3_600_000;
}

const SHIFT_STATUS_VARIANT: Record<string, 'info' | 'success' | 'neutral' | 'danger' | 'warning'> = {
  SCHEDULED: 'info',
  CLAIMED: 'info',
  OPEN: 'warning',
  IN_PROGRESS: 'success',
  COMPLETED: 'neutral',
  CANCELLED: 'danger',
};

const LEAVE_STATUS_VARIANT: Record<LeaveStatus, 'pending' | 'success' | 'danger' | 'neutral'> = {
  PENDING: 'pending',
  APPROVED: 'success',
  REJECTED: 'danger',
  CANCELLED: 'neutral',
};

function SectionHeading({ title, href, cta }: { title: string; href?: string; cta?: string }) {
  return (
    <div className="mb-4 flex items-center justify-between">
      <h2 className="text-lg font-semibold text-fg">{title}</h2>
      {href && (
        <Link href={href} className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
          {cta ?? 'View all'}
          <CaretRightIcon size={14} weight="bold" />
        </Link>
      )}
    </div>
  );
}

function StatTile({
  label, value, sub, icon: Icon, tone = 'default',
}: {
  label: string;
  value: string | number;
  sub?: string;
  icon: React.ElementType;
  tone?: 'default' | 'warning';
}) {
  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm font-medium text-fg-muted">{label}</span>
        <Icon size={18} className={tone === 'warning' ? 'text-warning-text' : 'text-fg-subtle'} weight="regular" />
      </div>
      <p className="font-inter text-3xl font-bold text-fg">{value}</p>
      {sub && <p className="mt-1 text-xs text-fg-muted">{sub}</p>}
    </Card>
  );
}

function ShiftTypeBadge({ type }: { type: ShiftType }) {
  const meta = SHIFT_TYPE_META[type];
  if (!meta) return null;
  return (
    <span className={clsx('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase font-inter', meta.badgeClass)}>
      <span className={clsx('h-1.5 w-1.5 rounded-full', meta.dot)} />
      {meta.label}
    </span>
  );
}

function NextShiftCard({ shift, live }: { shift: Shift; live: boolean }) {
  return (
    <Card className={clsx('overflow-hidden border-l-4', live ? 'border-l-success-solid' : SHIFT_TYPE_META[shift.shiftType]?.stripe ?? 'border-l-primary')}>
      <div className="p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold uppercase tracking-wide text-fg-muted">
                {live ? 'On shift now' : dayLabel(shift.startTime)}
              </p>
              <Badge
                variant={SHIFT_STATUS_VARIANT[shift.status] ?? 'neutral'}
                label={shift.status.replace(/_/g, ' ')}
                dot={false}
              />
            </div>
            <h3 className="mt-2 text-2xl font-bold text-fg">{shift.house?.name ?? 'Shift'}</h3>
          </div>
          <ShiftTypeBadge type={shift.shiftType} />
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <div className="flex items-center gap-2.5 text-sm text-fg">
            <ClockIcon size={18} className="text-fg-subtle" weight="regular" />
            <span>
              {new Date(shift.startTime).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
              {'  ·  '}
              {fmtRange(shift.startTime, shift.endTime)}
            </span>
          </div>
          {shift.house?.address && (
            <div className="flex items-center gap-2.5 text-sm text-fg">
              <MapPinIcon size={18} className="text-fg-subtle" weight="regular" />
              <span className="truncate">{shift.house.address}</span>
            </div>
          )}
        </div>

        <p className="mt-5 text-xs text-fg-muted">
          {live
            ? 'Remember to clock out from the ShiftGO mobile app when your shift ends.'
            : 'Clock in from the ShiftGO mobile app when you arrive on site.'}
        </p>
      </div>
    </Card>
  );
}

export function WorkerToday() {
  const user = useAuthStore((s) => s.user);
  const { data: shifts = [], isLoading } = useShifts();
  const { data: timesheets = [] } = useMyTimesheets();
  const { data: leave = [] } = useLeaveRequests();
  const { data: announcements = [] } = useAnnouncements();
  const { data: training = [] } = useMyTraining();
  const { data: dbs } = useMyDbs();

  const now = new Date();

  const model = useMemo(() => {
    const live = shifts
      .filter((s) => s.status !== 'CANCELLED' && new Date(s.endTime) > now)
      .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

    const onShiftNow = live.find(
      (s) => s.status === 'IN_PROGRESS' || (new Date(s.startTime) <= now && new Date(s.endTime) >= now)
    );
    const nextShift = onShiftNow ?? live.find((s) => new Date(s.startTime) > now) ?? null;

    const in7 = now.getTime() + 7 * DAY_MS;
    const upcoming7 = live.filter((s) => {
      const t = new Date(s.startTime).getTime();
      return t > now.getTime() && t <= in7;
    });

    const weekStart = startOfWeek(now).getTime();
    const weekEnd = weekStart + 7 * DAY_MS;
    const weekHours = shifts
      .filter((s) => {
        if (s.status === 'CANCELLED') return false;
        const t = new Date(s.startTime).getTime();
        return t >= weekStart && t < weekEnd;
      })
      .reduce((sum, s) => sum + hoursBetween(s.startTime, s.endTime), 0);

    const weekAhead = shifts
      .filter((s) => {
        if (s.status === 'CANCELLED') return false;
        const day = startOfDay(new Date(s.startTime)).getTime();
        return day >= startOfDay(now).getTime() && day <= now.getTime() + 7 * DAY_MS;
      })
      .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

    // A worker can't action these — confirmation is a team-leader+ step. This
    // is informational: how many of their timesheets are still unapproved.
    const timesheetsPending = timesheets.filter((t) => t.status === 'PENDING');
    const leavePending = leave.filter((l) => l.status === 'PENDING');
    const recentLeave = [...leave]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 4);

    const sortedAnnouncements = [...announcements]
      .sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      })
      .slice(0, 4);

    const trainingOutstanding = training.filter((t) => t.status !== 'COMPLETED').length;
    const dbsNeedsAttention = !dbs || dbs.status !== 'CLEAR';

    return {
      onShiftNow: Boolean(onShiftNow),
      nextShift,
      upcomingCount: upcoming7.length,
      weekHours: Math.round(weekHours * 10) / 10,
      weekAhead: weekAhead.slice(0, 8),
      timesheetsPending: timesheetsPending.length,
      leavePendingCount: leavePending.length,
      recentLeave,
      announcements: sortedAnnouncements,
      trainingOutstanding,
      dbsNeedsAttention,
      dbsStatus: dbs?.status ?? 'MISSING',
    };
  }, [shifts, timesheets, leave, announcements, training, dbs, now]);

  const firstName = user?.name?.split(' ')[0] ?? 'there';
  const agencyName = user?.agency?.name;

  const statusPill = (() => {
    if (model.onShiftNow) return { label: 'On shift now', tone: 'bg-success-bg text-success-text', dot: 'bg-success-solid' };
    if (model.nextShift) {
      const isToday = dayLabel(model.nextShift.startTime) === 'Today';
      return {
        label: isToday
          ? `Next shift today · ${fmtTime(model.nextShift.startTime)}`
          : `Next shift ${dayLabel(model.nextShift.startTime)}`,
        tone: 'bg-info-bg text-info-text',
        dot: 'bg-info-solid',
      };
    }
    return { label: 'No upcoming shifts', tone: 'bg-surface-muted text-fg-muted', dot: 'bg-fg-subtle' };
  })();

  if (isLoading) {
    return (
      <div>
        <div className="mb-8 border-b border-neutral-200 pb-8">
          <div className="animate-pulse">
            <div className="mb-2 h-8 w-1/3 rounded bg-neutral-200" />
            <div className="h-4 w-1/4 rounded bg-neutral-200" />
          </div>
        </div>
        <StatsSkeleton count={4} />
      </div>
    );
  }

  return (
    <div>
      <Header
        title={`${getGreeting()}, ${firstName}`}
        subtitle={`${fmtFullDate(now)}${agencyName ? ` · ${agencyName}` : ''}`}
        action={
          <span className={clsx('inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium', statusPill.tone)}>
            <span className={clsx('h-2 w-2 rounded-full', statusPill.dot)} />
            {statusPill.label}
          </span>
        }
      />

      <div className="space-y-8">
        {/* ─── Next shift ──────────────────────────────────────── */}
        <section>
          <SectionHeading title="Your next shift" href="/dashboard/shifts" cta="All shifts" />
          {model.nextShift ? (
            <NextShiftCard shift={model.nextShift} live={model.onShiftNow} />
          ) : (
            <Card className="p-10 text-center">
              <CalendarBlankIcon size={32} className="mx-auto mb-3 text-fg-subtle" weight="regular" />
              <p className="font-medium text-fg">No upcoming shifts</p>
              <p className="mt-1 text-sm text-fg-muted">New shifts assigned to you will show up here.</p>
            </Card>
          )}
        </section>

        {/* ─── At a glance ─────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatTile label="Upcoming shifts" value={model.upcomingCount} sub="next 7 days" icon={CalendarBlankIcon} />
          <StatTile label="Scheduled hours" value={`${model.weekHours}h`} sub="this week" icon={ClockIcon} />
          <StatTile
            label="Timesheets"
            value={model.timesheetsPending}
            sub="awaiting approval"
            icon={ListChecksIcon}
          />
          <StatTile
            label="Time off"
            value={model.leavePendingCount}
            sub="awaiting approval"
            icon={CheckCircleIcon}
          />
        </div>

        {/* ─── The week ahead ──────────────────────────────────── */}
        <section>
          <SectionHeading title="The week ahead" href="/dashboard/shifts" />
          <Card className="overflow-hidden">
            {model.weekAhead.length === 0 ? (
              <div className="p-8 text-center">
                <CalendarBlankIcon size={28} className="mx-auto mb-3 text-fg-subtle" weight="regular" />
                <p className="text-sm text-fg-muted">Nothing scheduled in the next 7 days.</p>
              </div>
            ) : (
              <div className="divide-y divide-neutral-200">
                {model.weekAhead.map((shift) => (
                  <div key={shift.id} className="flex items-center justify-between gap-4 p-4 hover:bg-neutral-50">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-semibold text-fg">{shift.house?.name ?? 'Shift'}</p>
                        {shift.status === 'IN_PROGRESS' && (
                          <Badge variant="success" label="In progress" dot={false} />
                        )}
                      </div>
                      <p className="mt-1 text-sm text-fg-muted">
                        {dayLabel(shift.startTime)} · {fmtRange(shift.startTime, shift.endTime)}
                      </p>
                    </div>
                    <ShiftTypeBadge type={shift.shiftType} />
                  </div>
                ))}
              </div>
            )}
          </Card>
        </section>

        {/* ─── Time off + Announcements ────────────────────────── */}
        <div className="grid gap-6 lg:grid-cols-2">
          <section>
            <SectionHeading title="My time off" href="/dashboard/leave" cta="Manage" />
            <Card className="overflow-hidden">
              {model.recentLeave.length === 0 ? (
                <div className="p-8 text-center">
                  <CheckCircleIcon size={28} className="mx-auto mb-3 text-fg-subtle" weight="regular" />
                  <p className="text-sm text-fg-muted">No time-off requests yet.</p>
                </div>
              ) : (
                <div className="divide-y divide-neutral-200">
                  {model.recentLeave.map((req) => (
                    <div key={req.id} className="flex items-center justify-between gap-3 p-4">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-fg">
                          {new Date(req.startDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                          {' – '}
                          {new Date(req.endDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                        </p>
                        <p className="mt-0.5 truncate text-xs text-fg-muted">{req.reason}</p>
                      </div>
                      <Badge variant={LEAVE_STATUS_VARIANT[req.status]} label={req.status} dot={false} />
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </section>

          <section>
            <SectionHeading title="Announcements" href="/dashboard/announcements" />
            <Card className="overflow-hidden">
              {model.announcements.length === 0 ? (
                <div className="p-8 text-center">
                  <MegaphoneIcon size={28} className="mx-auto mb-3 text-fg-subtle" weight="regular" />
                  <p className="text-sm text-fg-muted">No announcements right now.</p>
                </div>
              ) : (
                <div className="divide-y divide-neutral-200">
                  {model.announcements.map((a) => (
                    <div key={a.id} className="flex items-start gap-3 p-4">
                      <div className="mt-0.5">
                        {a.pinned
                          ? <PushPinIcon size={16} className="text-warning-text" weight="fill" />
                          : <MegaphoneIcon size={16} className="text-fg-subtle" weight="regular" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="truncate text-sm font-semibold text-fg">{a.title}</p>
                          {a.read === false && <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-primary" />}
                        </div>
                        <p className="mt-0.5 line-clamp-2 text-xs text-fg-muted">{a.body}</p>
                        <p className="mt-1 text-[11px] text-fg-subtle">
                          {a.author?.name ?? 'Team'} · {relativeDate(a.createdAt)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </section>
        </div>

        {/* ─── Compliance reminders ────────────────────────────── */}
        {(model.trainingOutstanding > 0 || model.dbsNeedsAttention) && (
          <section>
            <SectionHeading title="Needs your attention" href="/dashboard/profile" cta="Go to profile" />
            <Card className="divide-y divide-neutral-200 overflow-hidden">
              {model.trainingOutstanding > 0 && (
                <div className="flex items-center gap-3 p-4">
                  <BookOpenIcon size={20} className="text-warning-text" weight="regular" />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-fg">
                      {model.trainingOutstanding} training {model.trainingOutstanding === 1 ? 'course' : 'courses'} outstanding
                    </p>
                    <p className="text-xs text-fg-muted">Complete your assigned training to stay compliant.</p>
                  </div>
                </div>
              )}
              {model.dbsNeedsAttention && (
                <div className="flex items-center gap-3 p-4">
                  <ShieldCheckIcon size={20} className="text-warning-text" weight="regular" />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-fg">
                      {model.dbsStatus === 'MISSING' ? 'No DBS check on file' : `DBS status: ${model.dbsStatus}`}
                    </p>
                    <p className="text-xs text-fg-muted">Contact your HR administrator if this looks wrong.</p>
                  </div>
                </div>
              )}
            </Card>
          </section>
        )}
      </div>
    </div>
  );
}
