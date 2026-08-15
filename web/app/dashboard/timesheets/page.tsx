'use client';
import { useEffect, useState } from 'react';
import { FilePdfIcon, CheckCircleIcon, ListChecksIcon, XCircleIcon } from '@phosphor-icons/react';
import { Header } from '@/components/layout/Header';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { TableSkeleton } from '@/components/ui/Skeleton';
import { Modal } from '@/components/ui/Modal';
import { useHouses } from '@/hooks/useHouses';
import { useHouseTimesheets, useConfirmTimesheet, useRejectTimesheet, exportTimesheetPDF } from '@/hooks/useTimesheets';
import { useAuthStore } from '@/store/authStore';
import { useToast } from '@/hooks/useToast';

function fmt(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

export default function TimesheetsPage() {
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

  const pending    = timesheets.filter((t) => (t.status ?? (t.confirmedAt || t.autoConfirmed ? 'APPROVED' : 'PENDING')) === 'PENDING');
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

      <div className="mb-5">
        <label className="block text-xs font-semibold tracking-wider uppercase text-on-surface-variant font-inter mb-1.5">
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
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="glass-card p-4 text-center">
            <p className="text-2xl font-bold text-primary">{totalHours.toFixed(1)}h</p>
            <p className="text-[11px] uppercase tracking-wider font-semibold text-on-surface-variant font-inter mt-1">Total Hours</p>
          </div>
          <div className="glass-card p-4 text-center">
            <p className="text-2xl font-bold text-[#1a6b8a]">{timesheets.length}</p>
            <p className="text-[11px] uppercase tracking-wider font-semibold text-on-surface-variant font-inter mt-1">Records</p>
          </div>
          <div className="glass-card p-4 text-center">
            <p className="text-2xl font-bold text-tertiary-DEFAULT">{pending.length}</p>
            <p className="text-[11px] uppercase tracking-wider font-semibold text-on-surface-variant font-inter mt-1">Pending</p>
          </div>
        </div>
      )}

      {!selectedHouse ? (
        <div className="glass-card p-10 text-center">
          <p className="text-sm text-on-surface-variant">Select a house above to view its timesheets</p>
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
                const status = t.status ?? (t.confirmedAt || t.autoConfirmed ? 'APPROVED' : 'PENDING');
                const isPending = status === 'PENDING';
                const badgeVariant = status === 'APPROVED' ? 'confirmed' : status === 'REJECTED' ? 'error' : 'pending';
                return (
                  <tr key={t.id} className="hover:bg-surface-lowest/60 transition-colors">
                    <td className="table-td font-medium">{t.worker.name}</td>
                    <td className="table-td font-inter text-xs text-on-surface-variant">
                      {t.clockInAt
                        ? new Date(t.clockInAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
                        : '—'}
                    </td>
                    <td className="table-td font-inter text-xs">{fmt(t.clockInAt)}</td>
                    <td className="table-td font-inter text-xs">{fmt(t.clockOutAt)}</td>
                    <td className="table-td font-semibold text-primary">
                      {t.totalHours != null ? `${t.totalHours.toFixed(2)}h` : '—'}
                    </td>
                    <td className="table-td">
                      <Badge variant={t.autoConfirmed ? 'active' : 'upcoming'} label={t.autoConfirmed ? 'Auto' : 'Manual'} />
                    </td>
                    <td className="table-td">
                      <Badge variant={badgeVariant} label={status === 'APPROVED' ? 'Approved' : status === 'REJECTED' ? 'Rejected' : 'Pending'} />
                      {status === 'REJECTED' && t.rejectionReason && (
                        <p className="mt-1 max-w-48 text-[11px] text-on-surface-variant">{t.rejectionReason}</p>
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
                              className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:bg-[#e6f4f0] px-2.5 py-1.5 rounded-md transition-colors disabled:opacity-50"
                            >
                              <CheckCircleIcon size={14} weight="regular" /> Confirm
                            </button>
                            {canExport && (
                              <button
                                onClick={() => openReject(t.id)}
                                disabled={confirm.isPending || reject.isPending}
                                className="inline-flex items-center gap-1.5 text-xs font-medium text-error-DEFAULT hover:bg-error-container px-2.5 py-1.5 rounded-md transition-colors disabled:opacity-50"
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
            <label className="block text-xs font-semibold tracking-wider uppercase text-on-surface-variant font-inter mb-1.5">
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
          {rejectError && <p className="text-sm text-error-DEFAULT bg-error-container rounded-md px-3 py-2">{rejectError}</p>}
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
