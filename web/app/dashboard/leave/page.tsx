'use client';
import { useMemo, useState } from 'react';
import { CheckCircleIcon, CalendarBlankIcon, XCircleIcon, ProhibitIcon, PlusIcon } from '@phosphor-icons/react';
import { Header } from '@/components/layout/Header';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { Modal } from '@/components/ui/Modal';
import { TableSkeleton } from '@/components/ui/Skeleton';
import {
  useApproveLeaveRequest,
  useCancelLeaveRequest,
  useCreateLeaveRequest,
  useLeaveBalance,
  useLeaveRequests,
  useRejectLeaveRequest,
} from '@/hooks/useLeaveRequests';
import { LeaveBalanceCard } from '@/components/leave/LeaveBalanceCard';
import { useUsers } from '@/hooks/useWorkers';
import { useAuthStore } from '@/store/authStore';
import { useToast } from '@/hooks/useToast';
import type { LeaveRequest, LeaveStatus } from '@/types';

const STATUS_OPTIONS: LeaveStatus[] = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'];

function formatDate(value: string | null) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatDateTime(value: string | null) {
  if (!value) return '—';
  return new Date(value).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function leaveBadge(status: LeaveStatus) {
  if (status === 'APPROVED') return 'confirmed';
  if (status === 'REJECTED') return 'error';
  if (status === 'CANCELLED') return 'completed';
  return 'pending';
}

function errorMessage(err: any) {
  const fields = err.response?.data?.error?.fields;
  if (fields && typeof fields === 'object') return Object.values(fields).join('. ');
  return err.response?.data?.message ?? err.response?.data?.error?.message ?? 'Request failed';
}

/** Weekdays (Mon–Fri) in [start, end] inclusive — mirrors the backend pricing. */
function weekdaysInRange(start: string, end: string): number {
  const s = new Date(start);
  const e = new Date(end);
  if (isNaN(s.getTime()) || isNaN(e.getTime()) || e < s) return 0;
  const cur = new Date(s.getFullYear(), s.getMonth(), s.getDate());
  const last = new Date(e.getFullYear(), e.getMonth(), e.getDate());
  let n = 0;
  while (cur <= last) {
    const d = cur.getDay();
    if (d !== 0 && d !== 6) n += 1;
    cur.setDate(cur.getDate() + 1);
  }
  return n;
}

export default function LeavePage() {
  const user = useAuthStore((s) => s.user);
  const canManageLeave = user?.role === 'MANAGER' || user?.role === 'HR';
  return canManageLeave ? <ManageLeaveView /> : <MyLeaveView />;
}

function ManageLeaveView() {
  const toast = useToast();

  const [status, setStatus] = useState<LeaveStatus | ''>('');
  const [workerId, setWorkerId] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [rejectTarget, setRejectTarget] = useState<LeaveRequest | null>(null);
  const [cancelTarget, setCancelTarget] = useState<LeaveRequest | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');
  const [actionError, setActionError] = useState('');
  const [conflictWarning, setConflictWarning] = useState('');

  const { data: workers = [] } = useUsers('WORKER', 'ACTIVE');
  const { data: leaveRequests = [], isLoading } = useLeaveRequests({ status, workerId });
  const approveLeave = useApproveLeaveRequest();
  const rejectLeave = useRejectLeaveRequest();
  const cancelLeave = useCancelLeaveRequest();

  const visibleLeave = useMemo(() => {
    return leaveRequests.filter((leave) => {
      const leaveStart = leave.startDate.slice(0, 10);
      const leaveEnd = leave.endDate.slice(0, 10);
      if (startDate && leaveEnd < startDate) return false;
      if (endDate && leaveStart > endDate) return false;
      return true;
    });
  }, [leaveRequests, startDate, endDate]);

  function resetActionState() {
    setActionError('');
    setConflictWarning('');
  }

  function handleApprove(leave: LeaveRequest) {
    resetActionState();
    approveLeave.mutate(leave.id, {
      onSuccess: () => toast.success('Leave approved'),
      onError: (err: any) => {
        if (err.response?.status === 409) {
          const conflicts = err.response?.data?.conflicts;
          const count = Array.isArray(conflicts) ? conflicts.length : 0;
          setConflictWarning(count > 0
            ? `Cannot approve: worker has ${count} scheduled shift${count === 1 ? '' : 's'} during this leave.`
            : errorMessage(err));
        } else {
          toast.error(errorMessage(err));
        }
      },
    });
  }

  function openReject(leave: LeaveRequest) {
    setRejectTarget(leave);
    setRejectionReason('');
    resetActionState();
  }

  function closeReject() {
    setRejectTarget(null);
    setRejectionReason('');
    resetActionState();
  }

  function submitReject(e: React.FormEvent) {
    e.preventDefault();
    if (!rejectTarget) return;
    if (!rejectionReason.trim()) {
      setActionError('Rejection reason is required');
      return;
    }

    rejectLeave.mutate({ id: rejectTarget.id, rejectionReason: rejectionReason.trim() }, {
      onSuccess: () => {
        toast.success('Leave rejected');
        closeReject();
      },
      onError: (err: any) => setActionError(errorMessage(err)),
    });
  }

  function openCancel(leave: LeaveRequest) {
    setCancelTarget(leave);
    resetActionState();
  }

  function closeCancel() {
    setCancelTarget(null);
    resetActionState();
  }

  function submitCancel() {
    if (!cancelTarget) return;
    cancelLeave.mutate(cancelTarget.id, {
      onSuccess: () => {
        toast.success('Leave cancelled');
        closeCancel();
      },
      onError: (err: any) => setActionError(errorMessage(err)),
    });
  }

  return (
    <div>
      <Header title="Leave" subtitle="Review and manage staff leave requests" />

      <div className="glass-card p-4 mb-5">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div>
            <label className="block text-xs font-semibold tracking-wider uppercase text-on-surface-variant font-inter mb-1.5">
              Status
            </label>
            <select className="input-field" value={status} onChange={(e) => setStatus(e.target.value as LeaveStatus | '')}>
              <option value="">All statuses</option>
              {STATUS_OPTIONS.map((option) => (
                <option key={option} value={option}>{option.replace('_', ' ')}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold tracking-wider uppercase text-on-surface-variant font-inter mb-1.5">
              Worker
            </label>
            <select className="input-field" value={workerId} onChange={(e) => setWorkerId(e.target.value)}>
              <option value="">All workers</option>
              {workers.map((worker) => (
                <option key={worker.id} value={worker.id}>{worker.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold tracking-wider uppercase text-on-surface-variant font-inter mb-1.5">
              From
            </label>
            <input className="input-field" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-semibold tracking-wider uppercase text-on-surface-variant font-inter mb-1.5">
              To
            </label>
            <input className="input-field" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </div>
        </div>
      </div>

      {conflictWarning && (
        <div className="mb-4 rounded-lg border border-error-DEFAULT bg-error-container px-4 py-3 text-sm text-error-DEFAULT">
          {conflictWarning}
        </div>
      )}

      {isLoading ? (
        <TableSkeleton cols={9} rows={6} />
      ) : visibleLeave.length === 0 ? (
        <EmptyState icon={CalendarBlankIcon} title="No leave requests found" />
      ) : (
        <div className="glass-card overflow-hidden">
          <table className="w-full">
            <thead>
              <tr>
                {['Worker', 'Dates', 'Reason', 'Status', 'Reviewer', 'Reviewed', 'Rejection', 'Action'].map((h) => (
                  <th key={h} className="table-th">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleLeave.map((leave) => {
                const isPending = leave.status === 'PENDING';
                const canCancel = leave.status === 'PENDING' || leave.status === 'APPROVED';
                return (
                  <tr key={leave.id} className="hover:bg-surface-lowest/60 transition-colors align-top">
                    <td className="table-td">
                      <p className="font-medium">{leave.worker?.name ?? 'Unknown worker'}</p>
                      <p className="text-[11px] text-on-surface-variant font-inter">{leave.worker?.email}</p>
                    </td>
                    <td className="table-td font-inter text-xs whitespace-nowrap">
                      <p>{formatDate(leave.startDate)}</p>
                      <p className="text-on-surface-variant">to {formatDate(leave.endDate)}</p>
                    </td>
                    <td className="table-td max-w-64">
                      <p className="text-sm text-on-surface">{leave.reason ?? '—'}</p>
                    </td>
                    <td className="table-td">
                      <Badge variant={leaveBadge(leave.status) as any} label={leave.status} />
                    </td>
                    <td className="table-td text-sm">
                      {leave.reviewedBy?.name ?? '—'}
                    </td>
                    <td className="table-td text-xs text-on-surface-variant font-inter">
                      {formatDateTime(leave.reviewedAt)}
                    </td>
                    <td className="table-td max-w-56">
                      {leave.rejectionReason ? (
                        <p className="text-sm text-on-surface-variant">{leave.rejectionReason}</p>
                      ) : '—'}
                    </td>
                    <td className="table-td">
                      <div className="flex flex-wrap gap-2">
                        {isPending && (
                          <>
                            <button
                              onClick={() => handleApprove(leave)}
                              disabled={approveLeave.isPending || rejectLeave.isPending || cancelLeave.isPending}
                              className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:bg-[#e6f4f0] px-2.5 py-1.5 rounded-md transition-colors disabled:opacity-50"
                            >
                              <CheckCircleIcon size={14} /> Approve
                            </button>
                            <button
                              onClick={() => openReject(leave)}
                              disabled={approveLeave.isPending || rejectLeave.isPending || cancelLeave.isPending}
                              className="inline-flex items-center gap-1.5 text-xs font-medium text-error-DEFAULT hover:bg-error-container px-2.5 py-1.5 rounded-md transition-colors disabled:opacity-50"
                            >
                              <XCircleIcon size={14} /> Reject
                            </button>
                          </>
                        )}
                        {canCancel && (
                          <button
                            onClick={() => openCancel(leave)}
                            disabled={approveLeave.isPending || rejectLeave.isPending || cancelLeave.isPending}
                            className="inline-flex items-center gap-1.5 text-xs font-medium text-on-surface-variant hover:bg-surface-low px-2.5 py-1.5 rounded-md transition-colors disabled:opacity-50"
                          >
                            <ProhibitIcon size={14} /> Cancel
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={!!rejectTarget} onClose={closeReject} title="Reject Leave Request">
        <form onSubmit={submitReject} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold tracking-wider uppercase text-on-surface-variant font-inter mb-1.5">
              Reason
            </label>
            <textarea
              className="input-field min-h-28 resize-none"
              value={rejectionReason}
              onChange={(e) => {
                setRejectionReason(e.target.value);
                setActionError('');
              }}
              placeholder="Explain why this leave request is being rejected"
              maxLength={500}
              required
            />
          </div>
          {actionError && <p className="text-sm text-error-DEFAULT bg-error-container rounded-md px-3 py-2">{actionError}</p>}
          <div className="flex gap-3">
            <button type="button" onClick={closeReject} className="btn-secondary flex-1 justify-center">Cancel</button>
            <button type="submit" disabled={rejectLeave.isPending} className="btn-primary flex-1 justify-center">
              {rejectLeave.isPending ? 'Rejecting...' : 'Reject Leave'}
            </button>
          </div>
        </form>
      </Modal>

      <Modal open={!!cancelTarget} onClose={closeCancel} title="Cancel Leave Request">
        <div className="space-y-4">
          <p className="text-sm text-on-surface-variant">
            Cancel leave for <span className="font-semibold text-on-surface">{cancelTarget?.worker?.name}</span> from{' '}
            {cancelTarget ? formatDate(cancelTarget.startDate) : '—'} to {cancelTarget ? formatDate(cancelTarget.endDate) : '—'}?
          </p>
          {actionError && <p className="text-sm text-error-DEFAULT bg-error-container rounded-md px-3 py-2">{actionError}</p>}
          <div className="flex gap-3">
            <button type="button" onClick={closeCancel} className="btn-secondary flex-1 justify-center">Keep Leave</button>
            <button type="button" onClick={submitCancel} disabled={cancelLeave.isPending} className="btn-primary flex-1 justify-center">
              {cancelLeave.isPending ? 'Cancelling...' : 'Cancel Leave'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function MyLeaveView() {
  const user = useAuthStore((s) => s.user);
  const toast = useToast();
  const { data: leaveRequests = [], isLoading } = useLeaveRequests({ workerId: user?.id });
  const { data: balance, isLoading: balanceLoading } = useLeaveBalance();
  const createLeave = useCreateLeaveRequest();
  const cancelLeave = useCancelLeaveRequest();

  const [requestOpen, setRequestOpen] = useState(false);
  const [form, setForm] = useState({ startDate: '', endDate: '' });
  const [formError, setFormError] = useState('');
  const [cancelTarget, setCancelTarget] = useState<LeaveRequest | null>(null);
  const [cancelError, setCancelError] = useState('');

  const sorted = useMemo(
    () => [...leaveRequests].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [leaveRequests]
  );

  function closeRequest() {
    setRequestOpen(false);
    setForm({ startDate: '', endDate: '' });
    setFormError('');
  }

  function submitRequest(e: React.FormEvent) {
    e.preventDefault();
    setFormError('');
    if (new Date(form.endDate) < new Date(form.startDate)) {
      setFormError('End date must be on or after the start date');
      return;
    }
    createLeave.mutate(form, {
      onSuccess: () => {
        toast.success('Leave request submitted');
        closeRequest();
      },
      onError: (err: any) => {
        const fields = err.response?.data?.error?.fields;
        setFormError(fields ? Object.values(fields).join('. ') : err.response?.data?.message ?? 'Failed to submit request');
      },
    });
  }

  function submitCancel() {
    if (!cancelTarget) return;
    setCancelError('');
    cancelLeave.mutate(cancelTarget.id, {
      onSuccess: () => {
        toast.success('Leave request cancelled');
        setCancelTarget(null);
      },
      onError: (err: any) => setCancelError(err.response?.data?.message ?? 'Failed to cancel request'),
    });
  }

  const formatDate = (v: string) => new Date(v).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

  return (
    <div>
      <Header
        title="Leave Requests"
        subtitle="Manage your time off"
        action={
          <button onClick={() => setRequestOpen(true)} className="btn-primary">
            <PlusIcon size={16} /> Request Leave
          </button>
        }
      />

      <div className="mb-6">
        <LeaveBalanceCard balance={balance} isLoading={balanceLoading} />
      </div>

      {isLoading ? (
        <TableSkeleton cols={4} rows={4} />
      ) : sorted.length === 0 ? (
        <EmptyState
          icon={CalendarBlankIcon}
          title="No leave requests yet"
          description="Request time off whenever you need it"
          action={<button onClick={() => setRequestOpen(true)} className="btn-primary">Request Leave</button>}
        />
      ) : (
        <div className="space-y-3">
          {sorted.map((leave) => {
            // Workers may only cancel a request still awaiting review — once a manager
            // has approved or rejected it, the backend rejects a worker's cancel attempt.
            const canCancel = user?.role === 'WORKER'
              ? leave.status === 'PENDING'
              : leave.status === 'PENDING' || leave.status === 'APPROVED';
            return (
              <div key={leave.id} className="glass-card p-4 flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <p className="font-medium text-on-surface">
                      {formatDate(leave.startDate)} – {formatDate(leave.endDate)}
                    </p>
                    <Badge variant={leaveBadge(leave.status) as any} label={leave.status} />
                  </div>
                  <p className="text-sm text-on-surface-variant">Annual leave{leave.totalHours > 0 && <span> · {leave.totalHours}h</span>}</p>
                  {leave.status === 'REJECTED' && leave.rejectionReason && (
                    <p className="mt-1 text-xs text-error-DEFAULT">Reason: {leave.rejectionReason}</p>
                  )}
                  {leave.reviewedBy && (
                    <p className="mt-1 text-[11px] text-on-surface-variant font-inter">
                      Reviewed by {leave.reviewedBy.name}
                    </p>
                  )}
                </div>
                {canCancel && (
                  <button
                    onClick={() => { setCancelTarget(leave); setCancelError(''); }}
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-on-surface-variant hover:bg-surface-low px-2.5 py-1.5 rounded-md transition-colors flex-shrink-0"
                  >
                    <ProhibitIcon size={14} /> Cancel
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      <Modal open={requestOpen} onClose={closeRequest} title="Request Leave">
        <form onSubmit={submitRequest} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold tracking-wider uppercase text-on-surface-variant font-inter mb-1.5">
                Start Date
              </label>
              <input
                type="date"
                className="input-field"
                value={form.startDate}
                onChange={(e) => setForm({ ...form, startDate: e.target.value })}
                required
              />
            </div>
            <div>
              <label className="block text-xs font-semibold tracking-wider uppercase text-on-surface-variant font-inter mb-1.5">
                End Date
              </label>
              <input
                type="date"
                className="input-field"
                value={form.endDate}
                onChange={(e) => setForm({ ...form, endDate: e.target.value })}
                required
              />
            </div>
          </div>
          {form.startDate && form.endDate && new Date(form.endDate) >= new Date(form.startDate) && (() => {
            const days = weekdaysInRange(form.startDate, form.endDate);
            const daily = balance?.dailyHours ?? 7.5;
            const cost = Math.round(days * daily * 10) / 10;
            const remaining = balance?.hasConfiguredProfile
              ? Math.round((balance.netUsableBalance - cost) * 10) / 10
              : null;
            return (
              <div className="rounded-md bg-surface-low px-3 py-2 text-xs text-on-surface-variant">
                <span className="font-medium text-on-surface">{cost}h</span> ({days} working {days === 1 ? 'day' : 'days'} × {daily}h)
                {remaining !== null && (
                  <> · balance after: <span className={remaining < 0 ? 'font-medium text-error-DEFAULT' : 'font-medium text-on-surface'}>{remaining}h</span></>
                )}
              </div>
            );
          })()}
          {formError && <p className="text-sm text-error-DEFAULT bg-error-container rounded-md px-3 py-2">{formError}</p>}
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={closeRequest} className="btn-secondary flex-1 justify-center">Cancel</button>
            <button type="submit" disabled={createLeave.isPending} className="btn-primary flex-1 justify-center">
              {createLeave.isPending ? 'Submitting…' : 'Submit Request'}
            </button>
          </div>
        </form>
      </Modal>

      <Modal open={!!cancelTarget} onClose={() => setCancelTarget(null)} title="Cancel Leave Request">
        <div className="space-y-4">
          <p className="text-sm text-on-surface-variant">
            Cancel your leave request from {cancelTarget ? formatDate(cancelTarget.startDate) : '—'} to{' '}
            {cancelTarget ? formatDate(cancelTarget.endDate) : '—'}?
          </p>
          {cancelError && <p className="text-sm text-error-DEFAULT bg-error-container rounded-md px-3 py-2">{cancelError}</p>}
          <div className="flex gap-3">
            <button type="button" onClick={() => setCancelTarget(null)} className="btn-secondary flex-1 justify-center">Keep Request</button>
            <button type="button" onClick={submitCancel} disabled={cancelLeave.isPending} className="btn-primary flex-1 justify-center">
              {cancelLeave.isPending ? 'Cancelling…' : 'Cancel Request'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
