'use client';
import { useState } from 'react';
import { XIcon } from '@phosphor-icons/react';
import { useHouses } from '@/hooks/useHouses';
import { useWorkers } from '@/hooks/useRota';
import { useCreateShift, useUpdateShift } from '@/hooks/useShifts';
import type { User, House, ShiftType, Role, Shift } from '@/types';
import { Button } from '@/components/ui/Button';
import { FieldShell, Input, Select } from '@/components/ui/Input';
import { LoadingOverlay } from '@/components/ui/LoadingOverlay';
import { SHIFT_TYPE_OPTIONS, SHIFT_TYPE_META } from '@/lib/shiftTypes';
import { COVER_ROLE_GROUPS, isGroupSelected, toggleGroupRoles } from '@/lib/coverRoles';

function toTimeInput(iso: string) {
  return new Date(iso).toISOString().slice(11, 16);
}

interface ShiftModalProps {
  defaultDate?: string;
  defaultWorkerId?: string;
  defaultHouseId?: string;
  defaultShiftType?: ShiftType;
  defaultStartTime?: string;
  defaultEndTime?: string;
  editingShift?: Shift;
  onClose: () => void;
  onSuccess: () => void;
}

export function ShiftModal({
  defaultDate,
  defaultWorkerId,
  defaultHouseId,
  defaultShiftType,
  defaultStartTime,
  defaultEndTime,
  editingShift,
  onClose,
  onSuccess,
}: ShiftModalProps) {
  const isEdit = !!editingShift;

  const [form, setForm] = useState({
    workerId: editingShift?.workerId || defaultWorkerId || '',
    houseId: editingShift?.houseId || defaultHouseId || '',
    date: editingShift?.date.slice(0, 10) || defaultDate || new Date().toISOString().split('T')[0],
    startTime: editingShift ? toTimeInput(editingShift.startTime) : defaultStartTime ? toTimeInput(defaultStartTime) : '09:00',
    endTime: editingShift ? toTimeInput(editingShift.endTime) : defaultEndTime ? toTimeInput(defaultEndTime) : '17:00',
    shiftType: editingShift?.shiftType || defaultShiftType || 'LONG_DAY',
  });
  // Editing an already-open (cover-needed) shift should start with the
  // toggle already on, not force you to re-pick "cover" from scratch.
  const [isCover, setIsCover] = useState(isEdit ? editingShift?.status === 'OPEN' : false);
  const [eligibleRoles, setEligibleRoles] = useState<Role[]>(
    editingShift?.eligibleRoles?.length ? (editingShift.eligibleRoles as Role[]) : ['WORKER']
  );

  const { data: houses = [] } = useHouses();
  const { data: workers = [] } = useWorkers('WORKER');
  const createShift = useCreateShift();
  const updateShift = useUpdateShift();
  const isPending = createShift.isPending || updateShift.isPending;
  const [error, setError] = useState<string | null>(null);

  const handleChange = (field: string, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    setError(null);
    // Picking a worker and marking "cover needed" are mutually exclusive.
    if (field === 'workerId' && value) setIsCover(false);
  };

  const handleToggleCover = () => {
    setIsCover((prev) => {
      const next = !prev;
      if (next) setForm((f) => ({ ...f, workerId: '' }));
      return next;
    });
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!form.houseId) {
      setError('Please select a house');
      return;
    }
    if (!isCover && !form.workerId) {
      setError('Please select a worker, or mark this as a cover shift');
      return;
    }
    if (isCover && eligibleRoles.length === 0) {
      setError('Select at least one eligible role for the cover shift');
      return;
    }

    try {
      const startDateTime = new Date(`${form.date}T${form.startTime}:00Z`);
      let endDateTime = new Date(`${form.date}T${form.endTime}:00Z`);

      if (endDateTime <= startDateTime) {
        endDateTime = new Date(endDateTime.getTime() + 24 * 60 * 60 * 1000);
      }

      if (isEdit && editingShift) {
        await updateShift.mutateAsync({
          id: editingShift.id,
          workerId: form.workerId || null,
          houseId: form.houseId,
          date: form.date,
          startTime: startDateTime.toISOString(),
          endTime: endDateTime.toISOString(),
          shiftType: form.shiftType,
          ...(isCover ? { eligibleRoles } : {}),
        });
      } else if (isCover) {
        await createShift.mutateAsync({
          houseId: form.houseId,
          date: form.date,
          startTime: startDateTime.toISOString(),
          endTime: endDateTime.toISOString(),
          shiftType: form.shiftType,
          status: 'OPEN',
          eligibleRoles,
        });
      } else {
        await createShift.mutateAsync({
          workerId: form.workerId,
          houseId: form.houseId,
          date: form.date,
          startTime: startDateTime.toISOString(),
          endTime: endDateTime.toISOString(),
          shiftType: form.shiftType,
        });
      }

      onSuccess();
    } catch (err: any) {
      const message = err.response?.data?.message || err.message || `Failed to ${isEdit ? 'save' : 'create'} shift`;

      // Check for leave/overlap conflict
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
      <div className="relative max-h-[90vh] w-full max-w-md overflow-y-auto rounded-lg border border-border bg-surface shadow-overlay">
        <LoadingOverlay show={isPending} label={isEdit ? 'Saving…' : 'Creating shift…'} />
        {/* Header */}
        <div className="sticky top-0 flex items-center justify-between border-b border-border bg-surface px-6 py-4">
          <h2 className="text-lg font-semibold text-fg">{isEdit ? 'Edit shift' : 'Create shift'}</h2>
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
          <FieldShell label={`Worker${isEdit || isCover ? '' : ' *'}`}>
            <Select
              value={form.workerId}
              onChange={(e) => handleChange('workerId', e.target.value)}
              required={!isEdit && !isCover}
              disabled={isCover}
            >
              <option value="">{isCover ? 'Cover needed — no worker' : isEdit ? 'Unassigned' : 'Select a worker'}</option>
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

          {/* Cover toggle — mutually exclusive with picking a worker above */}
          <FieldShell label="Cover Needed">
            <button
              type="button"
              onClick={handleToggleCover}
              disabled={!isCover && !!form.workerId}
              className={`flex w-full items-center justify-between rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
                isCover
                  ? 'border-warning-border bg-warning-bg text-warning-text'
                  : form.workerId
                    ? 'cursor-not-allowed border-border bg-surface-muted text-fg-subtle'
                    : 'border-border bg-surface text-fg-muted hover:border-brand-200'
              }`}
            >
              <span>
                {isCover
                  ? 'Cover needed — open for claiming'
                  : form.workerId
                    ? 'Not needed — worker already assigned'
                    : 'Mark as cover needed (no worker yet)'}
              </span>
              <span className={`h-2.5 w-2.5 rounded-full ${isCover ? 'bg-warning-solid' : 'bg-neutral-300'}`} />
            </button>
          </FieldShell>

          {isCover && (
            <FieldShell label="Who can claim this shift? *">
              <div className="flex flex-wrap gap-2">
                {COVER_ROLE_GROUPS.map((group) => (
                  <button
                    key={group.key}
                    type="button"
                    onClick={() => setEligibleRoles((prev) => toggleGroupRoles(prev, group))}
                    className={`rounded-md border px-3 py-1.5 text-xs font-semibold transition-colors ${
                      isGroupSelected(group, eligibleRoles)
                        ? 'border-brand-500 bg-brand-50 text-brand-700'
                        : 'border-border bg-surface text-fg-muted hover:border-brand-200'
                    }`}
                  >
                    {group.label}
                  </button>
                ))}
              </div>
            </FieldShell>
          )}

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
              {SHIFT_TYPE_OPTIONS.map((type) => (
                <option key={type} value={type}>{SHIFT_TYPE_META[type].label}</option>
              ))}
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
              disabled={isPending}
              variant="primary"
              className="flex-1"
            >
              {isPending ? (isEdit ? 'Saving...' : 'Creating...') : (isEdit ? 'Save changes' : 'Create shift')}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
