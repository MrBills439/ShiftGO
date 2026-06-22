'use client';
import { useState } from 'react';
import { PlusIcon, CalendarBlankIcon, TrashIcon } from '@phosphor-icons/react';
import { Header } from '@/components/layout/Header';
import { Modal } from '@/components/ui/Modal';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { TableSkeleton } from '@/components/ui/Skeleton';
import { useShifts, useCreateShift, useDeleteShift } from '@/hooks/useShifts';
import { useHouses } from '@/hooks/useHouses';
import { useUsers } from '@/hooks/useWorkers';
import { useAuthStore } from '@/store/authStore';
import { useToast } from '@/hooks/useToast';

function shiftStatus(shift: { startTime: string; endTime: string }): 'active' | 'upcoming' | 'completed' {
  const now = new Date();
  if (new Date(shift.startTime) <= now && new Date(shift.endTime) >= now) return 'active';
  if (new Date(shift.startTime) > now) return 'upcoming';
  return 'completed';
}

export default function ShiftsPage() {
  const user = useAuthStore((s) => s.user);
  const { data: shifts = [], isLoading } = useShifts();
  const { data: houses = [] } = useHouses();
  const { data: workers = [] } = useUsers('WORKER');
  const createShift = useCreateShift();
  const deleteShift = useDeleteShift();
  const toast = useToast();

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ houseId: '', workerId: '', date: '', startTime: '', endTime: '' });
  const [err, setErr] = useState('');
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const canCreate = ['HR', 'MANAGER', 'TEAM_LEADER'].includes(user?.role ?? '');

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    try {
      const startTime = new Date(`${form.date}T${form.startTime}`).toISOString();
      const endTime   = new Date(`${form.date}T${form.endTime}`).toISOString();
      await createShift.mutateAsync({ ...form, startTime, endTime, date: new Date(form.date).toISOString() });
      setOpen(false);
      setForm({ houseId: '', workerId: '', date: '', startTime: '', endTime: '' });
      toast.success('Shift created successfully');
    } catch (e: any) {
      setErr(e.response?.data?.message ?? 'Failed to create shift');
    }
  }

  function handleDelete() {
    if (!confirmId) return;
    deleteShift.mutate(confirmId, {
      onSuccess: () => { setConfirmId(null); toast.success('Shift deleted'); },
      onError:   () => { setConfirmId(null); toast.error('Failed to delete shift'); },
    });
  }

  return (
    <div>
      <Header
        title="Shifts"
        subtitle="Manage and schedule worker shifts across all houses"
        action={canCreate && (
          <button onClick={() => setOpen(true)} className="btn-primary">
            <PlusIcon size={16} /> New Shift
          </button>
        )}
      />

      {isLoading ? (
        <TableSkeleton cols={6} rows={7} />
      ) : shifts.length === 0 ? (
        <EmptyState
          icon={CalendarBlankIcon}
          title="No shifts yet"
          description="Create a shift to get started."
          action={canCreate && <button onClick={() => setOpen(true)} className="btn-primary">New Shift</button>}
        />
      ) : (
        <div className="glass-card overflow-hidden">
          <table className="w-full">
            <thead>
              <tr>
                {['Worker', 'House', 'Date', 'Time', 'Status', ''].map((h) => (
                  <th key={h} className="table-th">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shifts.map((s) => {
                const status = shiftStatus(s);
                return (
                  <tr key={s.id} className="hover:bg-surface-lowest/60 transition-colors">
                    <td className="table-td font-medium">{s.worker.name}</td>
                    <td className="table-td text-on-surface-variant">{s.house.name}</td>
                    <td className="table-td font-inter text-xs">
                      {new Date(s.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </td>
                    <td className="table-td font-inter text-xs">
                      {new Date(s.startTime).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                      {' – '}
                      {new Date(s.endTime).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td className="table-td"><Badge variant={status} label={status} /></td>
                    <td className="table-td">
                      {canCreate && (
                        <button
                          onClick={() => setConfirmId(s.id)}
                          className="p-1.5 rounded text-outline-DEFAULT hover:text-error-DEFAULT hover:bg-error-container transition-colors"
                          aria-label="Delete shift"
                        >
                          <TrashIcon size={15} />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={open} onClose={() => { setOpen(false); setErr(''); }} title="Create Shift">
        <form onSubmit={handleCreate} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold tracking-wider uppercase text-on-surface-variant font-inter mb-1.5">House</label>
            <select value={form.houseId} onChange={(e) => setForm({ ...form, houseId: e.target.value })} className="input-field" required>
              <option value="">Select house…</option>
              {houses.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold tracking-wider uppercase text-on-surface-variant font-inter mb-1.5">Worker</label>
            <select value={form.workerId} onChange={(e) => setForm({ ...form, workerId: e.target.value })} className="input-field" required>
              <option value="">Select worker…</option>
              {workers.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold tracking-wider uppercase text-on-surface-variant font-inter mb-1.5">Date</label>
            <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className="input-field" required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold tracking-wider uppercase text-on-surface-variant font-inter mb-1.5">Start</label>
              <input type="time" value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} className="input-field" required />
            </div>
            <div>
              <label className="block text-xs font-semibold tracking-wider uppercase text-on-surface-variant font-inter mb-1.5">End</label>
              <input type="time" value={form.endTime} onChange={(e) => setForm({ ...form, endTime: e.target.value })} className="input-field" required />
            </div>
          </div>
          {err && <p className="text-sm text-error-DEFAULT bg-error-container rounded-md px-3 py-2">{err}</p>}
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={() => { setOpen(false); setErr(''); }} className="btn-secondary flex-1 justify-center">Cancel</button>
            <button type="submit" disabled={createShift.isPending} className="btn-primary flex-1 justify-center">
              {createShift.isPending ? 'Creating…' : 'Create Shift'}
            </button>
          </div>
        </form>
      </Modal>

      <ConfirmModal
        open={!!confirmId}
        onClose={() => setConfirmId(null)}
        onConfirm={handleDelete}
        title="Delete Shift"
        message="This shift will be permanently removed. Workers will no longer see it in their schedule."
        confirmLabel="Delete Shift"
        isPending={deleteShift.isPending}
      />
    </div>
  );
}
