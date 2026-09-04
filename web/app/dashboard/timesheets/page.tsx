'use client';
import { useEffect, useMemo, useState } from 'react';
import {
  FilePdfIcon, CheckCircleIcon, ListChecksIcon, XCircleIcon,
  CalendarBlankIcon, ClockIcon, AirplaneTiltIcon, HourglassIcon,
  CaretLeftIcon, CaretRightIcon, WarningCircleIcon,
} from '@phosphor-icons/react';
import { Header } from '@/components/layout/Header';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { TableSkeleton } from '@/components/ui/Skeleton';
import { Modal } from '@/components/ui/Modal';
import { useHouses } from '@/hooks/useHouses';
import {
  useHouseTimesheets, useMyTimesheets, useConfirmTimesheet, useRejectTimesheet,
  useNeedsReview, useResolveReview, exportTimesheetPDF,
} from '@/hooks/useTimesheets';
import { useLeaveRequests } from '@/hooks/useLeaveRequests';
import { useAuthStore } from '@/store/authStore';
import { useToast } from '@/hooks/useToast';
import type { AttendanceReviewItem, LeaveRequest, LocationStatus, Timesheet } from '@/types';

function fmt(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function fmtDate(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function monthTitle(d: Date) {
  return d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
}

function inMonth(iso: string | null, year: number, month: number) {
  if (!iso) return false;
  const d = new Date(iso);
  return d.getFullYear() === year && d.getMonth() === month;
}

function statusOf(t: Timesheet) {
  return t.status ?? (t.confirmedAt || t.autoConfirmed ? 'APPROVED' : 'PENDING');
}

/** Approved-leave weekdays (Mon–Fri) that fall within [year, month]. */
function leaveWeekdaysInMonth(requests: LeaveRequest[], year: number, month: number) {
  const monthStart = new Date(year, month, 1);
  const monthEnd = new Date(year, month + 1, 0);
  let days = 0;
  for (const r of requests) {
    if (r.status !== 'APPROVED') continue;
    const from = new Date(Math.max(new Date(r.startDate).getTime(), monthStart.getTime()));
    const to = new Date(Math.min(new Date(r.endDate).getTime(), monthEnd.getTime()));
    if (to < from) continue;
    const cur = new Date(from.getFullYear(), from.getMonth(), from.getDate());
    const last = new Date(to.getFullYear(), to.getMonth(), to.getDate());
    while (cur <= last) {
      const dow = cur.getDay();
      if (dow !== 0 && dow !== 6) days += 1;
      cur.setDate(cur.getDate() + 1);
    }
  }
  return days;
}

export default function TimesheetsPage() {
  const user = useAuthStore((s) => s.user);
  const canManageTimesheets = ['HR', 'MANAGER', 'TEAM_LEADER'].includes(user?.role ?? '');
  return canManageTimesheets ? <ManageTimesheetsView /> : <MyTimesheetsView />;
}

// ─── Worker view ────────────────────────────────────────────────────────────
function SummaryTile({
  icon: Icon, label, value, sub, tone = 'default',
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  sub?: string;
  tone?: 'default' | 'warning';
}) {
  return (
    <div className="glass-card p-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium text-fg-muted">{label}</span>
        <Icon size={16} className={tone === 'warning' ? 'text-warning-text' : 'text-fg-subtle'} weight="regular" />
      </div>
      <p className="font-inter text-2xl font-bold text-fg">{value}</p>
      {sub && <p className="mt-0.5 text-[11px] text-fg-subtle">{sub}</p>}
    </div>
  );
}

function MyTimesheetsView() {
  const { data: timesheets = [], isLoading } = useMyTimesheets();
  const { data: leave = [] } = useLeaveRequests();

  const today = new Date();
  const [cursor, setCursor] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const isCurrentMonth = year === today.getFullYear() && month === today.getMonth();

  const monthData = useMemo(() => {
    const rows = timesheets
      .filter((t) => inMonth(t.clockInAt, year, month))
      .sort((a, b) => new Date(b.clockInAt ?? 0).getTime() - new Date(a.clockInAt ?? 0).getTime());
    const worked = rows.filter((t) => statusOf(t) !== 'REJECTED');
    const hours = worked.reduce((a, t) => a + (t.totalHours ?? 0), 0);
    const pending = rows.filter((t) => statusOf(t) === 'PENDING').length;
    const leaveDays = leaveWeekdaysInMonth(leave, year, month);
    return { rows, shifts: worked.length, hours, pending, leaveDays };
  }, [timesheets, leave, year, month]);

  const ytd = useMemo(() => {
    const y = today.getFullYear();
    let shifts = 0;
    let hours = 0;
    for (const t of timesheets) {
      if (!t.clockInAt) continue;
      const d = new Date(t.clockInAt);
      if (d.getFullYear() !== y || d > today) continue;
      if (statusOf(t) === 'REJECTED') continue;
      shifts += 1;
      hours += t.totalHours ?? 0;
    }
    let leaveDays = 0;
    for (let m = 0; m <= today.getMonth(); m += 1) leaveDays += leaveWeekdaysInMonth(leave, y, m);
    return { year: y, shifts, hours, leaveDays };
  }, [timesheets, leave]);

  return (
    <div className="mx-auto max-w-4xl">
      <Header title="Timesheets" subtitle="Your work hours and time off, month by month" />

      {/* Month navigator */}
      <div className="mb-5 flex items-center justify-between">
        <button
          onClick={() => setCursor(new Date(year, month - 1, 1))}
          className="btn-secondary !px-3"
          aria-label="Previous month"
        >
          <CaretLeftIcon size={15} />
        </button>
        <p className="text-sm font-semibold text-fg">{monthTitle(cursor)}</p>
        <button
          onClick={() => setCursor(new Date(year, month + 1, 1))}
          disabled={isCurrentMonth}
          className="btn-secondary !px-3 disabled:opacity-30"
          aria-label="Next month"
        >
          <CaretRightIcon size={15} />
        </button>
      </div>

      {/* Month summary */}
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SummaryTile icon={CalendarBlankIcon} label="Shifts worked" value={monthData.shifts} sub={monthTitle(cursor)} />
        <SummaryTile icon={ClockIcon} label="Hours worked" value={`${monthData.hours.toFixed(1)}h`} sub="clocked time" />
        <SummaryTile icon={AirplaneTiltIcon} label="Annual leave" value={`${monthData.leaveDays}d`} sub="approved, this month" />
        <SummaryTile icon={HourglassIcon} label="Awaiting approval" value={monthData.pending} sub="timesheets" tone="warning" />
      </div>

      {/* Year to date */}
      <p className="mb-6 rounded-lg bg-surface-subtle px-4 py-2.5 text-xs text-fg-muted">
        <span className="font-semibold text-fg">{ytd.year} so far:</span>{' '}
        {ytd.shifts} shifts · {ytd.hours.toFixed(1)}h worked · {ytd.leaveDays}d annual leave taken
      </p>

      {/* Month detail */}
      {isLoading ? (
        <TableSkeleton cols={5} rows={6} />
      ) : monthData.rows.length === 0 ? (
        <EmptyState
          icon={ListChecksIcon}
          title={`No timesheets in ${monthTitle(cursor)}`}
          description="Shifts you clock in and out of appear here for the month you worked them."
        />
      ) : (
        <div className="glass-card overflow-hidden">
          <table className="w-full">
            <thead>
              <tr>
                {['Date', 'House', 'Clock In', 'Clock Out', 'Hours', 'Status'].map((h) => (
                  <th key={h} className="table-th">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {monthData.rows.map((t) => {
                const status = statusOf(t);
                const badgeVariant = status === 'APPROVED' ? 'confirmed' : status === 'REJECTED' ? 'error' : 'pending';
                return (
                  <tr key={t.id} className="transition-colors hover:bg-surface-subtle">
                    <td className="table-td font-inter text-xs text-fg-muted">{fmtDate(t.clockInAt)}</td>
                    <td className="table-td text-fg-muted">{t.house?.name ?? '—'}</td>
                    <td className="table-td font-inter text-xs">{fmt(t.clockInAt)}</td>
                    <td className="table-td font-inter text-xs">{fmt(t.clockOutAt)}</td>
                    <td className="table-td font-semibold text-brand-700">
                      {t.totalHours != null ? `${t.totalHours.toFixed(2)}h` : '—'}
                    </td>
                    <td className="table-td">
                      <Badge variant={badgeVariant} label={status === 'APPROVED' ? 'Approved' : status === 'REJECTED' ? 'Rejected' : 'Pending'} />
                      {status === 'REJECTED' && t.rejectionReason && (
                        <p className="mt-1 max-w-48 text-[11px] text-fg-muted">{t.rejectionReason}</p>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Needs review (GPS attendance flagged for a manager) ───────────────────
function fmtDateTime(iso: string | null) {
  if (!iso) return '—';
  return `${fmtDate(iso)} · ${fmt(iso)}`;
}

function locationBadge(status: LocationStatus | null | undefined) {
  if (status === 'ONSITE') return <Badge variant="success" label="Onsite" />;
  if (status === 'OFFSITE') return <Badge variant="warning" label="Offsite" />;
  return <Badge variant="neutral" label="Unknown" />;
}

function toLocalInputValue(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function ResolveReviewModal({ item, onClose }: { item: AttendanceReviewItem | null; onClose: () => void }) {
  const resolve = useResolveReview();
  const toast = useToast();
  const [clockOutTime, setClockOutTime] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const stillOpen = !!item && !item.clockOutAt;

  useEffect(() => {
    if (item && !item.clockOutAt) setClockOutTime(toLocalInputValue(new Date().toISOString()));
    else setClockOutTime('');
    setReason('');
    setError('');
  }, [item?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!item) return null;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!item) return;
    setError('');
    if (stillOpen && !clockOutTime) {
      setError('Enter the actual clock-out time.');
      return;
    }
    resolve.mutate(
      {
        id: item.id,
        ...(stillOpen ? { clockOutTime: new Date(clockOutTime).toISOString() } : {}),
        reason: reason.trim() || undefined,
      },
      {
        onSuccess: () => {
          toast.success(stillOpen ? 'Clock-out confirmed' : 'Review cleared');
          onClose();
        },
        onError: (err: any) => setError(err.response?.data?.message ?? 'Failed to resolve attendance review'),
      },
    );
  }

  return (
    <Modal open={!!item} onClose={onClose} title={stillOpen ? 'Confirm clock-out' : 'Clear review'}>
      <form onSubmit={submit} className="space-y-4">
        <p className="text-sm text-fg-muted">{item.worker.name} · {item.house.name}</p>

        {stillOpen ? (
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-fg-muted">
              Actual clock-out time
            </label>
            <input
              type="datetime-local"
              className="input-field"
              value={clockOutTime}
              min={item.clockInAt ? toLocalInputValue(item.clockInAt) : undefined}
              max={toLocalInputValue(new Date().toISOString())}
              onChange={(e) => { setClockOutTime(e.target.value); setError(''); }}
              required
            />
            <p className="mt-1.5 text-[11px] text-fg-subtle">
              No GPS is recorded for this entry — it's logged as a manager-confirmed clock-out, not a GPS-verified one.
            </p>
          </div>
        ) : (
          <p className="rounded-md bg-surface-subtle px-3 py-2 text-xs text-fg-muted">
            This shift is already clocked out at {fmtDateTime(item.clockOutAt)}. Clearing review does not change that time.
          </p>
        )}

        <div>
          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-fg-muted">
            Resolution note (optional)
          </label>
          <textarea
            className="input-field min-h-20 resize-none"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Confirmed with worker by phone"
            maxLength={500}
          />
        </div>

        {error && <p className="rounded-md bg-danger-bg px-3 py-2 text-sm text-danger-text">{error}</p>}

        <div className="flex gap-3 pt-1">
          <button type="button" onClick={onClose} className="btn-secondary flex-1 justify-center">Cancel</button>
          <button type="submit" disabled={resolve.isPending} className="btn-primary flex-1 justify-center">
            {resolve.isPending ? 'Saving…' : stillOpen ? 'Confirm clock-out' : 'Clear review'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function NeedsReviewSection() {
  const { data: items = [], isLoading } = useNeedsReview();
  const [target, setTarget] = useState<AttendanceReviewItem | null>(null);

  if (!isLoading && items.length === 0) return null;

  return (
    <div className="mb-6">
      <div className="mb-3 flex items-center gap-2">
        <WarningCircleIcon size={18} className="text-warning-text" weight="fill" />
        <h2 className="text-sm font-semibold text-fg">
          Needs review{items.length > 0 && <span className="font-normal text-fg-muted"> ({items.length})</span>}
        </h2>
      </div>
      <p className="mb-3 text-xs text-fg-muted">
        ShiftGO could not safely confirm these clock-outs automatically — check the details and resolve them.
      </p>

      {isLoading ? (
        <TableSkeleton cols={4} rows={2} />
      ) : (
        <div className="space-y-3">
          {items.map((t) => {
            const stillOpen = !t.clockOutAt;
            return (
              <div key={t.id} className="glass-card border-warning-border/60 bg-warning-bg/20 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-fg">
                      {t.worker.name} <span className="font-normal text-fg-muted">· {t.house.name}</span>
                    </p>
                    <p className="mt-1 text-xs text-fg-muted">
                      Scheduled {fmtDateTime(t.shift.startTime)} – {fmt(t.shift.endTime)}
                    </p>
                  </div>
                  {stillOpen
                    ? <Badge variant="danger" label="Still clocked in" />
                    : <Badge variant="neutral" label="Clocked out" />}
                </div>

                {t.reviewReason && (
                  <p className="mt-2 rounded-md bg-white/70 px-3 py-2 text-xs text-fg-muted">{t.reviewReason}</p>
                )}

                <div className="mt-3 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">Clock in</p>
                    <p className="mt-0.5 font-inter">{fmtDateTime(t.clockInAt)}</p>
                    <div className="mt-1">{locationBadge(t.clockInLocationStatus)}</div>
                  </div>
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">Clock out</p>
                    <p className="mt-0.5 font-inter">{stillOpen ? '—' : fmtDateTime(t.clockOutAt)}</p>
                    <div className="mt-1">{locationBadge(t.clockOutLocationStatus)}</div>
                  </div>
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">Clock-out method</p>
                    <p className="mt-0.5 font-inter">{t.clockOutMethod ?? '—'}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">Shift status</p>
                    <p className="mt-0.5 font-inter">{t.shift.status}</p>
                  </div>
                </div>

                <div className="mt-3">
                  <button onClick={() => setTarget(t)} className="btn-secondary !px-3 !py-1.5 text-xs">
                    {stillOpen ? 'Confirm clock-out' : 'Clear review'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <ResolveReviewModal item={target} onClose={() => setTarget(null)} />
    </div>
  );
}

// ─── Manager / HR view ──────────────────────────────────────────────────────
function ManageTimesheetsView() {
  const user = useAuthStore((s) => s.user);
  const { data: houses = [], isLoading: housesLoading } = useHouses();
  const [selectedHouse, setSelectedHouse] = useState('');
  const { data: timesheets = [], isLoading: timesheetsLoading } = useHouseTimesheets(selectedHouse);
  const confirm = useConfirmTimesheet();
  const reject = useRejectTimesheet();
  const toast = useToast();
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectError, setRejectError] = useState('');

  useEffect(() => {
    if (!housesLoading && houses.length > 0 && !selectedHouse) {
      setSelectedHouse(houses[0].id);
    }
  }, [housesLoading, houses, selectedHouse]);

  const canConfirm = ['HR', 'MANAGER', 'TEAM_LEADER'].includes(user?.role ?? '');
  const canExport  = ['HR', 'MANAGER'].includes(user?.role ?? '');
  // Attendance-review resolution is MANAGER/HR only — not team leaders or workers.
  const canResolveReview = ['HR', 'MANAGER'].includes(user?.role ?? '');

  const pending    = timesheets.filter((t) => statusOf(t) === 'PENDING');
  const totalHours = timesheets.reduce((a, t) => a + (t.totalHours ?? 0), 0);

  const isLoading = housesLoading || (!!selectedHouse && timesheetsLoading);

  function openReject(id: string) {
    setRejectId(id);
    setRejectReason('');
    setRejectError('');
  }

  function closeReject() {
    setRejectId(null);
    setRejectReason('');
    setRejectError('');
  }

  function submitReject(e: React.FormEvent) {
    e.preventDefault();
    if (!rejectId) return;
    if (!rejectReason.trim()) {
      setRejectError('Rejection reason is required');
      return;
    }
    reject.mutate({ id: rejectId, reason: rejectReason.trim() }, {
      onSuccess: () => {
        closeReject();
        toast.success('Timesheet rejected');
      },
      onError: (err: any) => setRejectError(err.response?.data?.message ?? 'Failed to reject timesheet'),
    });
  }

  return (
    <div>
      <Header
        title="Timesheets"
        subtitle="Review, confirm, and export worker attendance records"
        action={canExport && selectedHouse && (
          <button
            onClick={() => { exportTimesheetPDF(selectedHouse); toast.info('Downloading PDF…'); }}
            className="btn-secondary"
          >
            <FilePdfIcon size={16} /> Export PDF
          </button>
        )}
      />

      {canResolveReview && <NeedsReviewSection />}

      <div className="mb-5">
        <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-fg-muted">
          Filter by House
        </label>
        <select
          className="input-field max-w-xs"
          value={selectedHouse}
          onChange={(e) => setSelectedHouse(e.target.value)}
        >
          <option value="">Select a house…</option>
          {houses.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
        </select>
      </div>

      {selectedHouse && !timesheetsLoading && timesheets.length > 0 && (
        <div className="mb-6 grid grid-cols-3 gap-4">
          <div className="glass-card p-4 text-center">
            <p className="text-2xl font-bold text-brand-700">{totalHours.toFixed(1)}h</p>
            <p className="mt-1 text-[11px] font-semibold uppercase tracking-wider text-fg-muted">Total Hours</p>
          </div>
          <div className="glass-card p-4 text-center">
            <p className="text-2xl font-bold text-info-text">{timesheets.length}</p>
            <p className="mt-1 text-[11px] font-semibold uppercase tracking-wider text-fg-muted">Records</p>
          </div>
          <div className="glass-card p-4 text-center">
            <p className="text-2xl font-bold text-warning-text">{pending.length}</p>
            <p className="mt-1 text-[11px] font-semibold uppercase tracking-wider text-fg-muted">Pending</p>
          </div>
        </div>
      )}

      {!selectedHouse ? (
        <div className="glass-card p-10 text-center">
          <p className="text-sm text-fg-muted">Select a house above to view its timesheets</p>
        </div>
      ) : isLoading ? (
        <TableSkeleton cols={canConfirm ? 8 : 7} rows={6} />
      ) : timesheets.length === 0 ? (
        <EmptyState
          icon={ListChecksIcon}
          title="No timesheet records"
          description="Clock events will appear here once workers start logging attendance."
        />
      ) : (
        <div className="glass-card overflow-hidden">
          <table className="w-full">
            <thead>
              <tr>
                {['Worker', 'Date', 'Clock In', 'Clock Out', 'Hours', 'Method', 'Status', canConfirm ? 'Action' : ''].filter(Boolean).map((h) => (
                  <th key={h} className="table-th">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {timesheets.map((t) => {
                const status = statusOf(t);
                const isPending = status === 'PENDING';
                const badgeVariant = status === 'APPROVED' ? 'confirmed' : status === 'REJECTED' ? 'error' : 'pending';
                return (
                  <tr key={t.id} className="transition-colors hover:bg-surface-subtle">
                    <td className="table-td font-medium">{t.worker.name}</td>
                    <td className="table-td font-inter text-xs text-fg-muted">{fmtDate(t.clockInAt)}</td>
                    <td className="table-td font-inter text-xs">{fmt(t.clockInAt)}</td>
                    <td className="table-td font-inter text-xs">{fmt(t.clockOutAt)}</td>
                    <td className="table-td font-semibold text-brand-700">
                      {t.totalHours != null ? `${t.totalHours.toFixed(2)}h` : '—'}
                    </td>
                    <td className="table-td">
                      <Badge variant={t.autoConfirmed ? 'active' : 'upcoming'} label={t.autoConfirmed ? 'Auto' : 'Manual'} />
                    </td>
                    <td className="table-td">
                      <Badge variant={badgeVariant} label={status === 'APPROVED' ? 'Approved' : status === 'REJECTED' ? 'Rejected' : 'Pending'} />
                      {status === 'REJECTED' && t.rejectionReason && (
                        <p className="mt-1 max-w-48 text-[11px] text-fg-muted">{t.rejectionReason}</p>
                      )}
                    </td>
                    {canConfirm && (
                      <td className="table-td">
                        {isPending && (
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => confirm.mutate(t.id, {
                                onSuccess: () => toast.success('Timesheet confirmed'),
                                onError:   () => toast.error('Failed to confirm timesheet'),
                              })}
                              disabled={confirm.isPending || reject.isPending}
                              className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-brand-700 transition-colors hover:bg-brand-50 disabled:opacity-50"
                            >
                              <CheckCircleIcon size={14} weight="regular" /> Confirm
                            </button>
                            {canExport && (
                              <button
                                onClick={() => openReject(t.id)}
                                disabled={confirm.isPending || reject.isPending}
                                className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-danger-text transition-colors hover:bg-danger-bg disabled:opacity-50"
                              >
                                <XCircleIcon size={14} weight="regular" /> Reject
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={!!rejectId} onClose={closeReject} title="Reject Timesheet">
        <form onSubmit={submitReject} className="space-y-4">
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-fg-muted">
              Reason
            </label>
            <textarea
              className="input-field min-h-28 resize-none"
              value={rejectReason}
              onChange={(e) => {
                setRejectReason(e.target.value);
                setRejectError('');
              }}
              placeholder="Explain why this timesheet is being rejected"
              maxLength={500}
              required
            />
          </div>
          {rejectError && <p className="rounded-md bg-danger-bg px-3 py-2 text-sm text-danger-text">{rejectError}</p>}
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={closeReject} className="btn-secondary flex-1 justify-center">Cancel</button>
            <button type="submit" disabled={reject.isPending} className="btn-primary flex-1 justify-center">
              {reject.isPending ? 'Rejecting...' : 'Reject Timesheet'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
