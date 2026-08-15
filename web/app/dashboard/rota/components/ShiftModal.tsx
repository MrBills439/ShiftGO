'use client';
import { useState } from 'react';
import { XIcon } from '@phosphor-icons/react';
import { useHouses } from '@/hooks/useHouses';
import { useWorkers } from '@/hooks/useRota';
import { useCreateShift } from '@/hooks/useShifts';
import type { User, House } from '@/types';
import { Button } from '@/components/ui/Button';
import { FieldShell, Input, Select } from '@/components/ui/Input';

interface ShiftModalProps {
  defaultDate?: string;
  defaultWorkerId?: string;
  defaultHouseId?: string;
  onClose: () => void;
  onSuccess: () => void;
}

export function ShiftModal({
  defaultDate,
  defaultWorkerId,
  defaultHouseId,
  onClose,
  onSuccess,
}: ShiftModalProps) {
  const [form, setForm] = useState({
    workerId: defaultWorkerId || '',
    houseId: defaultHouseId || '',
    date: defaultDate || new Date().toISOString().split('T')[0],
    startTime: '09:00',
    endTime: '17:00',
    shiftType: 'DAY' as const,
  });

  const { data: houses = [] } = useHouses();
  const { data: workers = [] } = useWorkers('WORKER');
  const createShift = useCreateShift();
  const [error, setError] = useState<string | null>(null);

  const handleChange = (field: string, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!form.workerId || !form.houseId) {
      setError('Please select a worker and house');
      return;
    }

    try {
      const startDateTime = new Date(`${form.date}T${form.startTime}:00Z`);
      let endDateTime = new Date(`${form.date}T${form.endTime}:00Z`);

      if (endDateTime <= startDateTime) {
        endDateTime = new Date(endDateTime.getTime() + 24 * 60 * 60 * 1000);
      }

      await createShift.mutateAsync({
        workerId: form.workerId,
        houseId: form.houseId,
        date: form.date,
        startTime: startDateTime.toISOString(),
        endTime: endDateTime.toISOString(),
        shiftType: form.shiftType,
      });

      onSuccess();
    } catch (err: any) {
      const message = err.response?.data?.message || err.message || 'Failed to create shift';

      // Check for leave conflict
      if (err.response?.status === 409) {
        setError(`Conflict: ${message}`);
      } else {
        setError(message);
      }
    }
  };

  const selectedWorker = workers?.find((w: User) => w.id === form.workerId);
  const selectedHouse = houses?.find((h: House) => h.id === form.houseId);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-lg border border-border bg-surface shadow-overlay">
        {/* Header */}
        <div className="sticky top-0 flex items-center justify-between border-b border-border bg-surface px-6 py-4">
          <h2 className="text-lg font-semibold text-fg">Create shift</h2>
          <button
            onClick={onClose}
            className="rounded-md p-1.5 text-fg-muted transition-colors hover:bg-surface-subtle"
            aria-label="Close"
          >
            <XIcon size={20} weight="bold" />
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {error && (
            <div className="rounded-lg border border-danger-border bg-danger-bg p-3 text-sm font-medium text-danger-text">
              {error}
            </div>
          )}

          {/* Worker */}
          <FieldShell label="Worker *">
            <Select
              value={form.workerId}
              onChange={(e) => handleChange('workerId', e.target.value)}
              required
            >
              <option value="">Select a worker</option>
              {workers?.map((w: User) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </Select>
            {selectedWorker && (
              <p className="mt-1 text-xs text-fg-muted">{selectedWorker.email}</p>
            )}
          </FieldShell>

          {/* House */}
          <FieldShell label="House/site *">
            <Select
              value={form.houseId}
              onChange={(e) => handleChange('houseId', e.target.value)}
              required
            >
              <option value="">Select a house</option>
              {houses?.map((h: House) => (
                <option key={h.id} value={h.id}>
                  {h.name}
                </option>
              ))}
            </Select>
            {selectedHouse && (
              <p className="mt-1 text-xs text-fg-muted">{selectedHouse.address}</p>
            )}
          </FieldShell>

          {/* Date */}
          <FieldShell label="Date *">
            <Input
              type="date"
              value={form.date}
              onChange={(e) => handleChange('date', e.target.value)}
              required
            />
          </FieldShell>

          {/* Shift Type */}
          <FieldShell label="Shift type">
            <Select
              value={form.shiftType}
              onChange={(e) => handleChange('shiftType', e.target.value)}
            >
              <option value="DAY">Day</option>
              <option value="WAKE_NIGHT">Wake night</option>
              <option value="SLEEP_IN">Sleep-in</option>
              <option value="EMERGENCY">Emergency</option>
            </Select>
          </FieldShell>

          {/* Times */}
          <div className="grid grid-cols-2 gap-3">
            <FieldShell label="Start time *">
              <Input
                type="time"
                value={form.startTime}
                onChange={(e) => handleChange('startTime', e.target.value)}
                required
              />
            </FieldShell>
            <FieldShell label="End time *" hint="End times before start times are treated as next day.">
              <Input
                type="time"
                value={form.endTime}
                onChange={(e) => handleChange('endTime', e.target.value)}
                required
              />
            </FieldShell>
          </div>

          {/* Actions */}
          <div className="flex gap-3 border-t border-border pt-4">
            <Button variant="secondary" onClick={onClose} className="flex-1">
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={createShift.isPending}
              variant="primary"
              className="flex-1"
            >
              {createShift.isPending ? 'Creating...' : 'Create shift'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
