'use client';
import { useState } from 'react';
import { XIcon } from '@phosphor-icons/react';
import { useHouses } from '@/hooks/useHouses';
import { useCreateShift } from '@/hooks/useShifts';
import type { House, Role } from '@/types';
import { Button } from '@/components/ui/Button';
import { FieldShell, Input, Select } from '@/components/ui/Input';
import { LoadingOverlay } from '@/components/ui/LoadingOverlay';
import { SHIFT_TYPE_OPTIONS, SHIFT_TYPE_META } from '@/lib/shiftTypes';
import { COVER_ROLE_GROUPS, isGroupSelected, toggleGroupRoles } from '@/lib/coverRoles';
import { shiftTimesFromForm, instantToAgencyParts, type AmbiguousChoice, type TimeProblem } from '@/lib/shiftTime';
import { useAgencyTimeZone } from '@/hooks/useAgencyTimeZone';
import { ShiftTimeProblem } from '@/components/shifts/ShiftTimeProblem';
import { ShiftLengthSummary } from '@/components/shifts/ShiftLengthSummary';

interface OpenShiftModalProps {
  defaultDate?: string;
  defaultHouseId?: string;
  onClose: () => void;
  onSuccess: () => void;
}

export function OpenShiftModal({ defaultDate, defaultHouseId, onClose, onSuccess }: OpenShiftModalProps) {
  // Dates and times in this form are the AGENCY's wall clock (lib/shiftTime.ts).
  const timeZone = useAgencyTimeZone();
  const [form, setForm] = useState({
    houseId: defaultHouseId || '',
    date: defaultDate || instantToAgencyParts(new Date().toISOString(), timeZone).date,
    startTime: '09:00',
    endTime: '17:00',
    shiftType: 'LONG_DAY' as const,
    maxClaimsPerWorker: '',
  });
  const [eligibleRoles, setEligibleRoles] = useState<Role[]>(['WORKER']);
  const [urgent, setUrgent] = useState(false);

  const { data: houses = [] } = useHouses();
  const createShift = useCreateShift();
  const [error, setError] = useState<string | null>(null);
  const [choices, setChoices] = useState<{ start?: AmbiguousChoice; end?: AmbiguousChoice }>({});
  const [timeProblem, setTimeProblem] = useState<TimeProblem | null>(null);

  const handleChange = (field: string, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    setError(null);
    if (field === 'date' || field === 'startTime' || field === 'endTime') {
      setChoices({});
      setTimeProblem(null);
    }
  };

  const times = (chosen = choices) => shiftTimesFromForm({
    date: form.date, startTime: form.startTime, endTime: form.endTime, timeZone,
    startChoice: chosen.start, endChoice: chosen.end,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!form.houseId) {
      setError('Please select a service');
      return;
    }
    if (eligibleRoles.length === 0) {
      setError('Select at least one eligible role');
      return;
    }

    const t = times();
    if (!t.ok) {
      setTimeProblem(t.problem);
      return;
    }
    setTimeProblem(null);

    try {
      await createShift.mutateAsync({
        houseId: form.houseId,
        date: t.date,
        startTime: t.startTime,
        endTime: t.endTime,
        shiftType: form.shiftType,
        status: 'OPEN',
        eligibleRoles,
        urgent,
        ...(form.maxClaimsPerWorker ? { maxClaimsPerWorker: Number(form.maxClaimsPerWorker) } : {}),
      });

      onSuccess();
    } catch (err: any) {
      const message = err.response?.data?.message || err.message || 'Failed to post open shift';
      setError(message);
    }
  };

  const selectedHouse = houses?.find((h: House) => h.id === form.houseId);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="relative max-h-[90vh] w-full max-w-md overflow-y-auto rounded-lg border border-border bg-surface shadow-overlay">
        <LoadingOverlay show={createShift.isPending} label="Posting open shift…" />
        <div className="sticky top-0 flex items-center justify-between border-b border-border bg-surface px-6 py-4">
          <h2 className="text-lg font-semibold text-fg">Post open shift</h2>
          <button
            onClick={onClose}
            className="rounded-md p-1.5 text-fg-muted transition-colors hover:bg-surface-subtle"
            aria-label="Close"
          >
            <XIcon size={20} weight="bold" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          <ShiftTimeProblem
            problem={timeProblem}
            chosen={choices}
            onChoose={(field, choice) => {
              const next = { ...choices, [field]: choice };
              setChoices(next);
              const again = times(next);
              if (!again.ok) setTimeProblem(again.problem);
            }}
          />
          {error && (
            <div className="rounded-lg border border-danger-border bg-danger-bg p-3 text-sm font-medium text-danger-text">
              {error}
            </div>
          )}

          <FieldShell label="Service *">
            <Select
              value={form.houseId}
              onChange={(e) => handleChange('houseId', e.target.value)}
              required
            >
              <option value="">Select a service</option>
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

          <FieldShell label="Date *">
            <Input
              type="date"
              value={form.date}
              onChange={(e) => handleChange('date', e.target.value)}
              required
            />
          </FieldShell>

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

          <FieldShell label="Urgency">
            <button
              type="button"
              onClick={() => setUrgent((v) => !v)}
              className={`flex w-full items-center justify-between rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
                urgent
                  ? 'border-danger-solid bg-danger-bg text-danger-text'
                  : 'border-border bg-surface text-fg-muted hover:border-danger-border'
              }`}
            >
              <span>{urgent ? 'Urgent — needs cover ASAP' : 'Not urgent'}</span>
              <span className={`h-2.5 w-2.5 rounded-full ${urgent ? 'bg-danger-solid' : 'bg-neutral-300'}`} />
            </button>
          </FieldShell>

          <div className="grid grid-cols-2 gap-3">
            <FieldShell label="Start time *">
              <Input
                type="time"
                value={form.startTime}
                onChange={(e) => handleChange('startTime', e.target.value)}
                required
              />
            </FieldShell>
            <FieldShell label="End time *" hint={`Earlier than the start = next day; same as the start = a 24-hour shift. Times are ${timeZone} time.`}>
              <Input
                type="time"
                value={form.endTime}
                onChange={(e) => handleChange('endTime', e.target.value)}
                required
              />
            </FieldShell>
          </div>
          <ShiftLengthSummary date={form.date} startTime={form.startTime} endTime={form.endTime} timeZone={timeZone} choices={choices} />

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

          <FieldShell label="Max claims per worker" hint="Optional — reserved for future batch-open shifts.">
            <Input
              type="number"
              min={1}
              value={form.maxClaimsPerWorker}
              onChange={(e) => handleChange('maxClaimsPerWorker', e.target.value)}
            />
          </FieldShell>

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
              {createShift.isPending ? 'Posting...' : 'Post'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
