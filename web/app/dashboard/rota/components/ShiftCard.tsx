import { Shift } from '@/types';
import { Badge } from '@/components/ui/Badge';
import { clsx } from 'clsx';
import { ClockIcon, HouseIcon, WarningCircleIcon } from '@phosphor-icons/react';

interface ShiftCardProps {
  shift: Shift;
  draggable?: boolean;
  conflict?: boolean;
  onDragStart?: () => void;
}

export function ShiftCard({ shift, draggable = true, conflict = false, onDragStart }: ShiftCardProps) {
  const startTime = new Date(shift.startTime);
  const endTime = new Date(shift.endTime);

  const timeStr = `${startTime.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
  })}-${endTime.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;

  const shiftTypeLabel = {
    DAY: 'Day',
    WAKE_NIGHT: 'Wake night',
    SLEEP_IN: 'Sleep-in',
    EMERGENCY: 'Emergency',
  }[shift.shiftType] || shift.shiftType;

  const badgeVariant = {
    SCHEDULED: 'info',
    IN_PROGRESS: 'success',
    COMPLETED: 'neutral',
    CANCELLED: 'danger',
  }[shift.status] as 'info' | 'success' | 'neutral' | 'danger';

  return (
    <div
      className={clsx(
        'group rounded-md border bg-surface p-2 text-xs transition-colors',
        draggable && 'cursor-grab active:cursor-grabbing',
        shift.status === 'CANCELLED' ? 'border-danger-border bg-danger-bg/50 text-danger-text' : 'border-border text-fg hover:border-brand-200 hover:bg-brand-50/40',
        conflict && 'border-warning-solid bg-warning-bg'
      )}
      title={`${shift.house.name} - ${shift.worker.name}`}
      draggable={draggable}
      onDragStart={onDragStart}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-inter font-semibold tabular-nums">{timeStr}</span>
        {conflict && <WarningCircleIcon size={14} className="text-warning-text" aria-label="Conflict" />}
      </div>
      <div className="mt-1 flex items-center gap-1 truncate text-[11px] text-fg-muted">
        <HouseIcon size={12} />
        <span className="truncate">{shift.worker.name}</span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <Badge variant={badgeVariant} label={shift.status.replace('_', ' ')} dot={false} />
        <Badge variant="neutral" label={shiftTypeLabel} dot={false} />
      </div>

      {shift.status === 'CANCELLED' && shift.cancellationReason && (
        <div className="mt-2 text-[11px] text-danger-text">Reason: {shift.cancellationReason.substring(0, 44)}</div>
      )}

      {shift.timesheet && (
        <div className="mt-2 flex items-center gap-1 border-t border-border pt-1.5 text-[11px] text-fg-muted">
          <ClockIcon size={12} />
          <span className="font-inter tabular-nums">{shift.timesheet.totalHours?.toFixed(1) ?? '?'} hours</span>
          {shift.timesheet.status === 'APPROVED' && <span>approved</span>}
        </div>
      )}
    </div>
  );
}
