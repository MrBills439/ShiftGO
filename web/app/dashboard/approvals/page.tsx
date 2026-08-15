'use client';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircleIcon, ClockIcon } from '@phosphor-icons/react';
import { useLeaveRequests, useApproveLeaveRequest, useRejectLeaveRequest } from '@/hooks/useLeaveRequests';
import { useHouseTimesheets, useConfirmTimesheet, useRejectTimesheet } from '@/hooks/useTimesheets';
import { useHouses } from '@/hooks/useHouses';
import { useAuthStore } from '@/store/authStore';
import { Header } from '@/components/layout/Header';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/hooks/useToast';
import type { Timesheet, LeaveRequest } from '@/types';

type ApprovalType = 'all' | 'leave' | 'timesheets' | 'rejected' | 'approved' | 'pending';

interface ApprovalItem {
  id: string;
  type: 'leave' | 'timesheet';
  status: string;
  worker: { id: string; name: string };
  createdAt: string;
  leave?: LeaveRequest;
  timesheet?: Timesheet;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function formatTime(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function formatDateRange(start: string, end: string) {
  const startDate = new Date(start);
  const endDate = new Date(end);
  return `${formatDate(start)} – ${formatDate(end)}`;
}

export default function ApprovalsPage() {
  const router = useRouter();
  const { user } = useAuthStore();
  const canApprove = user?.role === 'MANAGER' || user?.role === 'HR';
  const toast = useToast();

  const [filterType, setFilterType] = useState<ApprovalType>('pending');
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectingType, setRejectingType] = useState<'leave' | 'timesheet' | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  // Fetch data
  const { data: leaves = [] } = useLeaveRequests();
  const { data: houses = [] } = useHouses();

  // Fetch timesheets from all houses
  const allTimesheets = useMemo(() => {
    return houses.flatMap((house) => {
      // eslint-disable-next-line react-hooks/rules-of-hooks
      const { data: ts = [] } = useHouseTimesheets(house.id);
      return ts || [];
    });
  }, [houses]);

  // Mutations
  const approveLeave = useApproveLeaveRequest();
  const rejectLeave = useRejectLeaveRequest();
  const confirmTimesheet = useConfirmTimesheet();
  const rejectTimesheetMutation = useRejectTimesheet();

  useEffect(() => {
    if (!canApprove) router.replace('/dashboard');
  }, [canApprove, router]);

  // Build approval items list
  const allItems: ApprovalItem[] = useMemo(() => {
    return [
      ...leaves.map((l) => ({
        id: l.id,
        type: 'leave' as const,
        status: l.status,
        worker: l.worker || { id: '', name: 'Unknown' },
        createdAt: l.createdAt,
        leave: l,
      })),
      ...allTimesheets.map((t) => ({
        id: t.id,
        type: 'timesheet' as const,
        status: t.status,
        worker: t.worker || { id: '', name: 'Unknown' },
        createdAt: t.shift?.startTime || t.clockInAt || new Date().toISOString(),
        timesheet: t,
      })),
    ];
  }, [leaves, allTimesheets]);

  // Filter approvals based on type
  const filteredApprovals = useMemo(() => {
    let items = [...allItems];

    if (filterType === 'pending') items = items.filter((i) => i.status === 'PENDING');
    if (filterType === 'approved') items = items.filter((i) => i.status === 'APPROVED');
    if (filterType === 'rejected') items = items.filter((i) => i.status === 'REJECTED');
    if (filterType === 'leave') items = items.filter((i) => i.type === 'leave');
    if (filterType === 'timesheets') items = items.filter((i) => i.type === 'timesheet');

    return items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [allItems, filterType]);

  // Counters
  const counters = useMemo(() => ({
    pendingLeave: leaves.filter((l) => l.status === 'PENDING').length,
    pendingTimesheets: allTimesheets.filter((t) => t.status === 'PENDING').length,
    rejected: leaves.filter((l) => l.status === 'REJECTED').length + allTimesheets.filter((t) => t.status === 'REJECTED').length,
    total: leaves.filter((l) => l.status === 'PENDING').length + allTimesheets.filter((t) => t.status === 'PENDING').length,
  }), [leaves, allTimesheets]);

  if (!canApprove) return null;

  const handleApproveLeave = async (leaveId: string) => {
    try {
      await approveLeave.mutateAsync(leaveId);
      toast.success('Leave request approved');
    } catch (err: any) {
      toast.error(err.response?.data?.message ?? 'Failed to approve leave');
    }
  };

  const handleRejectLeave = async (leaveId: string) => {
    if (!rejectReason.trim()) {
      toast.error('Please provide a reason');
      return;
    }
    try {
      await rejectLeave.mutateAsync({ id: leaveId, rejectionReason: rejectReason });
      toast.success('Leave request rejected');
      setRejectingId(null);
      setRejectReason('');
    } catch (err: any) {
      toast.error(err.response?.data?.message ?? 'Failed to reject leave');
    }
  };

  const handleApproveTimesheet = async (timesheetId: string) => {
    try {
      await confirmTimesheet.mutateAsync(timesheetId);
      toast.success('Timesheet approved');
    } catch (err: any) {
      toast.error(err.response?.data?.message ?? 'Failed to approve timesheet');
    }
  };

  const handleRejectTimesheet = async (timesheetId: string) => {
    if (!rejectReason.trim()) {
      toast.error('Please provide a reason');
      return;
    }
    try {
      await rejectTimesheetMutation.mutateAsync({ id: timesheetId, reason: rejectReason });
      toast.success('Timesheet rejected');
      setRejectingId(null);
      setRejectReason('');
    } catch (err: any) {
      toast.error(err.response?.data?.message ?? 'Failed to reject timesheet');
    }
  };

  return (
    <div className="space-y-8">
      <Header
        title="Approvals"
        subtitle="Review leave requests, timesheets, and operational exceptions in one place"
      />

      {/* Counters */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card className="p-4">
          <p className="text-xs font-semibold text-fg-muted uppercase tracking-widest">Pending Leave</p>
          <p className="text-2xl font-bold text-fg font-inter mt-2">{counters.pendingLeave}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs font-semibold text-fg-muted uppercase tracking-widest">Pending Timesheets</p>
          <p className="text-2xl font-bold text-fg font-inter mt-2">{counters.pendingTimesheets}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs font-semibold text-fg-muted uppercase tracking-widest">Rejected</p>
          <p className="text-2xl font-bold text-danger font-inter mt-2">{counters.rejected}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs font-semibold text-fg-muted uppercase tracking-widest">Total Pending</p>
          <p className="text-2xl font-bold text-warning font-inter mt-2">{counters.total}</p>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex gap-2 overflow-x-auto pb-2">
        {(['all', 'leave', 'timesheets', 'rejected', 'approved', 'pending'] as const).map((type) => (
          <Button
            key={type}
            variant={filterType === type ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => setFilterType(type)}
            className="capitalize whitespace-nowrap"
          >
            {type}
          </Button>
        ))}
      </div>

      {/* Approvals List */}
      <Card className="overflow-hidden">
        {filteredApprovals.length === 0 ? (
          <div className="p-8 text-center">
            <CheckCircleIcon size={40} className="mx-auto text-success mb-3" weight="regular" />
            <p className="text-fg font-medium">No pending approvals</p>
            <p className="text-sm text-fg-muted mt-1">All requests have been reviewed</p>
          </div>
        ) : (
          <div className="divide-y divide-neutral-200">
            {filteredApprovals.map((item) => {
              if (item.type === 'leave' && item.leave) {
                const leave = item.leave;
                return (
                  <div key={leave.id} className="p-4 hover:bg-neutral-50 transition-colors">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-2">
                          <Badge variant="info" label="Leave" dot={false} />
                          <p className="font-semibold text-fg">{leave.worker?.name || 'Unknown'}</p>
                          <Badge
                            variant={
                              leave.status === 'APPROVED'
                                ? 'success'
                                : leave.status === 'REJECTED'
                                ? 'danger'
                                : 'info'
                            }
                            label={leave.status}
                            dot={false}
                          />
                        </div>
                        <p className="text-sm text-fg-muted mb-2">
                          {formatDateRange(leave.startDate, leave.endDate)} • {leave.reason}
                        </p>
                        {leave.rejectionReason && (
                          <p className="text-sm text-danger mt-2">Reason: {leave.rejectionReason}</p>
                        )}
                        <p className="text-xs text-fg-muted mt-2">{formatDate(leave.createdAt)}</p>
                      </div>
                      {leave.status === 'PENDING' && (
                        <div className="flex gap-2 flex-shrink-0">
                          <Button
                            size="sm"
                            variant="primary"
                            onClick={() => handleApproveLeave(leave.id)}
                            disabled={approveLeave.isPending}
                          >
                            Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => {
                              setRejectingId(leave.id);
                              setRejectingType('leave');
                              setRejectReason('');
                            }}
                          >
                            Reject
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              }

              if (item.type === 'timesheet' && item.timesheet) {
                const ts = item.timesheet;
                return (
                  <div key={ts.id} className="p-4 hover:bg-neutral-50 transition-colors">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-2">
                          <Badge variant="info" label="Timesheet" dot={false} />
                          <p className="font-semibold text-fg">{ts.worker?.name || 'Unknown'}</p>
                          <Badge
                            variant={
                              ts.status === 'APPROVED'
                                ? 'success'
                                : ts.status === 'REJECTED'
                                ? 'danger'
                                : 'info'
                            }
                            label={ts.status}
                            dot={false}
                          />
                        </div>
                        <p className="text-sm text-fg-muted mb-1">
                          {ts.house?.name} • {formatDate(ts.shift?.startTime || ts.clockInAt || '')}
                        </p>
                        <p className="text-sm text-fg-muted mb-2">
                          {formatTime(ts.clockInAt)} – {formatTime(ts.clockOutAt)}
                          {ts.totalHours && ` • ${ts.totalHours.toFixed(1)}h`}
                        </p>
                        {ts.rejectionReason && (
                          <p className="text-sm text-danger mt-2">Reason: {ts.rejectionReason}</p>
                        )}
                        <p className="text-xs text-fg-muted mt-2">{formatDate(ts.shift?.startTime || ts.clockInAt || '')}</p>
                      </div>
                      {ts.status === 'PENDING' && (
                        <div className="flex gap-2 flex-shrink-0">
                          <Button
                            size="sm"
                            variant="primary"
                            onClick={() => handleApproveTimesheet(ts.id)}
                            disabled={confirmTimesheet.isPending}
                          >
                            Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => {
                              setRejectingId(ts.id);
                              setRejectingType('timesheet');
                              setRejectReason('');
                            }}
                          >
                            Reject
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              }

              return null;
            })}
          </div>
        )}
      </Card>

      {/* Reject Modal */}
      <Modal
        open={!!rejectingId}
        onClose={() => {
          setRejectingId(null);
          setRejectingType(null);
          setRejectReason('');
        }}
        title={`Reject ${rejectingType === 'leave' ? 'Leave Request' : 'Timesheet'}`}
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-fg mb-2">Reason for rejection *</label>
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Explain why this request is being rejected..."
              className="w-full px-3 py-2 border border-neutral-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              rows={4}
            />
          </div>
          <div className="flex gap-2 justify-end">
            <Button
              variant="secondary"
              onClick={() => {
                setRejectingId(null);
                setRejectingType(null);
                setRejectReason('');
              }}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                if (rejectingType === 'leave' && rejectingId) {
                  handleRejectLeave(rejectingId);
                } else if (rejectingType === 'timesheet' && rejectingId) {
                  handleRejectTimesheet(rejectingId);
                }
              }}
              disabled={rejectLeave.isPending || rejectTimesheetMutation.isPending}
            >
              Reject
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
