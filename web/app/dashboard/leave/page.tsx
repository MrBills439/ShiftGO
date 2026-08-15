'use client';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircleIcon, CalendarBlankIcon, XCircleIcon, ProhibitIcon } from '@phosphor-icons/react';
import { Header } from '@/components/layout/Header';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { Modal } from '@/components/ui/Modal';
import { TableSkeleton } from '@/components/ui/Skeleton';
import {
  useApproveLeaveRequest,
  useCancelLeaveRequest,
  useLeaveRequests,
  useRejectLeaveRequest,
} from '@/hooks/useLeaveRequests';
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

export default function LeavePage() {
  const user = useAuthStore((s) => s.user);
  const router = useRouter();
  const toast = useToast();
  const canManageLeave = user?.role === 'MANAGER' || user?.role === 'HR';

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

  useEffect(() => {
    if (user && !canManageLeave) router.replace('/dashboard');
  }, [user, canManageLeave, router]);

  const visibleLeave = useMemo(() => {
    return leaveRequests.filter((leave) => {
      const leaveStart = leave.startDate.slice(0, 10);
      const leaveEnd = leave.endDate.slice(0, 10);
      if (startDate && leaveEnd < startDate) return false;
      if (endDate && leaveStart > endDate) return false;
      return true;
    });
  }, [leaveRequests, startDate, endDate]);

  if (user && !canManageLeave) return null;

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
                      <p className="text-sm text-on-surface">{leave.reason}</p>
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
