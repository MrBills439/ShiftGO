'use client';
import { useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { FieldShell, Textarea } from '@/components/ui/Input';

export interface WeeklyHoursOverrideDetails {
  projectedHours?: number;
  maxWeeklyScheduledHours?: number;
  scheduledHours?: number;
  shiftHours?: number;
}

/**
 * Consistent weekly-hours prompt for both the Allocation view and the Rota
 * ShiftModal. When `canOverride` (HR/MANAGER) it collects a reason and calls
 * `onConfirm(reason)` — the caller re-sends the SAME PATCH /shifts endpoint with
 * `overrideWeeklyLimit: true`. Team Leaders see the block only, no controls.
 */
export function WeeklyHoursOverrideModal({
  open, onClose, workerName, details, canOverride, isPending, onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  workerName?: string;
  details: WeeklyHoursOverrideDetails | null;
  canOverride: boolean;
  isPending: boolean;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');
  const projected = details?.projectedHours;
  const max = details?.maxWeeklyScheduledHours;

  return (
    <Modal
      open={open}
      onClose={() => { setReason(''); onClose(); }}
      title={canOverride ? 'Override weekly hours limit' : 'Manager approval required'}
    >
      <div className="space-y-4">
        <p className="text-sm text-fg-muted">
          Assigning this shift would put{' '}
          <span className="font-semibold text-fg">{workerName ?? 'this worker'}</span> on{' '}
          <span className="font-semibold text-fg">{projected ?? '—'}h</span> this week, over the agency limit of{' '}
          <span className="font-semibold text-fg">{max ?? '—'}h</span>.
        </p>

        {canOverride ? (
          <>
            <p className="text-xs text-fg-subtle">A reason is required and the override is recorded in the audit log.</p>
            <FieldShell label="Reason for override *">
              <Textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                placeholder="e.g. Emergency cover, no other eligible worker available"
              />
            </FieldShell>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="secondary" onClick={() => { setReason(''); onClose(); }}>Cancel</Button>
              <Button
                variant="primary"
                disabled={reason.trim().length < 3 || isPending}
                onClick={() => onConfirm(reason.trim())}
              >
                {isPending ? 'Assigning…' : 'Confirm override'}
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-fg-muted">
              You are not authorised to override the weekly hours limit. Ask a manager or HR to assign this shift.
            </p>
            <div className="flex justify-end pt-1">
              <Button variant="secondary" onClick={() => { setReason(''); onClose(); }}>Close</Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
