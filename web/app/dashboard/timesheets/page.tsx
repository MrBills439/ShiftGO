'use client';
import { useEffect, useState } from 'react';
import { FilePdfIcon, CheckCircleIcon, ListChecksIcon } from '@phosphor-icons/react';
import { Header } from '@/components/layout/Header';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { TableSkeleton } from '@/components/ui/Skeleton';
import { useHouses } from '@/hooks/useHouses';
import { useHouseTimesheets, useConfirmTimesheet, exportTimesheetPDF } from '@/hooks/useTimesheets';
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
  const toast = useToast();

  useEffect(() => {
    if (!housesLoading && houses.length > 0 && !selectedHouse) {
      setSelectedHouse(houses[0].id);
    }
  }, [housesLoading, houses, selectedHouse]);

  const canConfirm = ['HR', 'MANAGER', 'TEAM_LEADER'].includes(user?.role ?? '');
  const canExport  = ['HR', 'MANAGER'].includes(user?.role ?? '');

  const pending    = timesheets.filter((t) => !t.confirmedAt && !t.autoConfirmed);
  const totalHours = timesheets.reduce((a, t) => a + (t.totalHours ?? 0), 0);

  const isLoading = housesLoading || (!!selectedHouse && timesheetsLoading);

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
            <p className="text-2xl font-bold text-primary-DEFAULT">{totalHours.toFixed(1)}h</p>
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
                const isConfirmed = !!(t.confirmedAt || t.autoConfirmed);
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
                    <td className="table-td font-semibold text-primary-DEFAULT">
                      {t.totalHours != null ? `${t.totalHours.toFixed(2)}h` : '—'}
                    </td>
                    <td className="table-td">
                      <Badge variant={t.autoConfirmed ? 'active' : 'upcoming'} label={t.autoConfirmed ? 'Auto' : 'Manual'} />
                    </td>
                    <td className="table-td">
                      <Badge variant={isConfirmed ? 'confirmed' : 'pending'} label={isConfirmed ? 'Confirmed' : 'Pending'} />
                    </td>
                    {canConfirm && (
                      <td className="table-td">
                        {!isConfirmed && (
                          <button
                            onClick={() => confirm.mutate(t.id, {
                              onSuccess: () => toast.success('Timesheet confirmed'),
                              onError:   () => toast.error('Failed to confirm timesheet'),
                            })}
                            disabled={confirm.isPending}
                            className="inline-flex items-center gap-1.5 text-xs font-medium text-primary-DEFAULT hover:bg-[#e6f4f0] px-2.5 py-1.5 rounded-md transition-colors disabled:opacity-50"
                          >
                            <CheckCircleIcon size={14} weight="regular" /> Confirm
                          </button>
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
    </div>
  );
}
