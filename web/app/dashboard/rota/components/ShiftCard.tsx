import { Shift } from '@/types';
import { Badge } from '@/components/ui/Badge';
import { clsx } from 'clsx';
import { ClockIcon, HouseIcon, WarningCircleIcon, ArrowsClockwiseIcon, CopyIcon, FireIcon, MoonIcon } from '@phosphor-icons/react';
import { useAuthStore } from '@/store/authStore';
import { SHIFT_TYPE_META } from '@/lib/shiftTypes';

interface ShiftCardProps {
  shift: Shift;
  draggable?: boolean;
  conflict?: boolean;
  onDragStart?: () => void;
  onRequestCover?: () => void;
  onCopy?: () => void;
  onEdit?: () => void;
}

export function ShiftCard({ shift, draggable = true, conflict = false, onDragStart, onRequestCover, onCopy, onEdit }: ShiftCardProps) {
  const user = useAuthStore((s) => s.user);
  const canManage = ['HR', 'MANAGER', 'TEAM_LEADER'].includes(user?.role ?? '');
  const canEdit = canManage && onEdit && !['CANCELLED', 'COMPLETED', 'IN_PROGRESS'].includes(shift.status);
  const startTime = new Date(shift.startTime);
  const endTime = new Date(shift.endTime);

  const timeStr = `${startTime.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
  })}-${endTime.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;

  const typeMeta = SHIFT_TYPE_META[shift.shiftType];

  const badgeVariant = {
    SCHEDULED: 'info',
    OPEN: 'warning',
    CLAIMED: 'success',
    IN_PROGRESS: 'success',
    COMPLETED: 'neutral',
    CANCELLED: 'danger',
  }[shift.status] as 'info' | 'success' | 'neutral' | 'danger' | 'warning';

  const isOpen = shift.status === 'OPEN';
  const canDrag = draggable && Boolean(shift.workerId);

  return (
    <div
      className={clsx(
        'group rounded-md border border-l-4 bg-surface p-2 text-xs transition-colors',
        typeMeta?.stripe ?? 'border-l-border',
        canDrag && 'cursor-grab active:cursor-grabbing',
        shift.status === 'CANCELLED' ? 'border-danger-border bg-danger-bg/50 text-danger-text' : 'border-border text-fg hover:border-brand-200 hover:bg-brand-50/40',
        isOpen && 'border-dashed border-warning-border bg-warning-bg/30',
        conflict && 'border-warning-solid bg-warning-bg',
        shift.urgent && 'ring-1 ring-danger-solid'
      )}
      title={canEdit ? `${shift.house.name} - ${shift.worker?.name ?? 'Open shift'} (double-click to edit)` : `${shift.house.name} - ${shift.worker?.name ?? 'Open shift'}`}
      draggable={canDrag}
      onDragStart={onDragStart}
      onDoubleClick={canEdit ? onEdit : undefined}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-inter font-semibold tabular-nums">{timeStr}</span>
        <div className="flex items-center gap-1">
          {shift.urgent && <FireIcon size={14} className="text-danger-text" weight="fill" aria-label="Urgent" />}
          {conflict && <WarningCircleIcon size={14} className="text-warning-text" aria-label="Conflict" />}
        </div>
      </div>
      <div className="mt-1 flex items-center gap-1 truncate text-[11px] text-fg-muted">
        <HouseIcon size={12} />
        <span className="truncate">
          {shift.worker
            ? shift.worker.name
            : isOpen
              ? `Open — ${shift.claimCount ?? 0} claim${shift.claimCount === 1 ? '' : 's'}`
              : 'Unassigned'}
        </span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <Badge variant={badgeVariant} label={shift.status.replace('_', ' ')} dot={false} />
        <span className={clsx('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold', typeMeta?.badgeClass)}>
          {shift.shiftType === 'SLEEP_IN' ? (
            <MoonIcon size={10} weight="fill" />
          ) : (
            <span className={clsx('h-1.5 w-1.5 rounded-full', typeMeta?.dot)} />
          )}
          {typeMeta?.label ?? shift.shiftType}
        </span>
        {shift.urgent && <Badge variant="danger" label="Urgent" dot={false} />}
      </div>

      {canManage && (onRequestCover || onCopy) && (
        <div className="mt-2 flex gap-1">
          {onCopy && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onCopy();
              }}
              className="flex flex-1 items-center justify-center gap-1 rounded border border-dashed border-border py-1 text-[11px] font-medium text-fg-muted transition-colors hover:border-brand-200 hover:bg-brand-50/40 hover:text-brand-700"
              title="Create a new shift pre-filled with the same worker, house, and type"
            >
              <CopyIcon size={12} /> Copy
            </button>
          )}
          {onRequestCover && shift.status === 'SCHEDULED' && shift.workerId && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onRequestCover();
              }}
              className="flex flex-1 items-center justify-center gap-1 rounded border border-dashed border-border py-1 text-[11px] font-medium text-fg-muted transition-colors hover:border-warning-border hover:bg-warning-bg/40 hover:text-warning-text"
              title="Mark this shift as needing cover — unassigns the current worker and opens it for claiming"
            >
              <ArrowsClockwiseIcon size={12} /> Cover
            </button>
          )}
        </div>
      )}

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
