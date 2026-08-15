import { RotaWeek, Shift, House, User } from '@/types';
import { ShiftCard } from './ShiftCard';
import { PlusIcon, WarningCircleIcon } from '@phosphor-icons/react';
import { useMemo, useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';

interface RotaWeekViewProps {
  rota: RotaWeek;
  houses: House[];
  workers: User[];
  onAddShift: (date: string, workerId?: string, houseId?: string) => void;
}

function activeShift(shift: Shift) {
  return shift.status !== 'CANCELLED';
}

function overlaps(a: Shift, b: Shift) {
  return a.id !== b.id && new Date(a.startTime) < new Date(b.endTime) && new Date(a.endTime) > new Date(b.startTime);
}

function formatDay(dateValue: string) {
  const date = new Date(`${dateValue}T00:00:00`);
  return {
    weekday: date.toLocaleDateString('en-GB', { weekday: 'short' }),
    day: date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }),
  };
}

export function RotaWeekView({ rota, houses, workers, onAddShift }: RotaWeekViewProps) {
  const [draggedWorkerId, setDraggedWorkerId] = useState<string | null>(null);

  const allShifts = useMemo(() => rota.days.flatMap((day) => day.shifts), [rota.days]);
  const conflictIds = useMemo(() => {
    const ids = new Set<string>();
    const byWorker = new Map<string, Shift[]>();
    allShifts.filter(activeShift).forEach((shift) => {
      byWorker.set(shift.workerId, [...(byWorker.get(shift.workerId) ?? []), shift]);
    });
    byWorker.forEach((items) => {
      items.forEach((shift) => {
        if (items.some((candidate) => overlaps(shift, candidate))) ids.add(shift.id);
      });
    });
    return ids;
  }, [allShifts]);

  const coverageGaps = useMemo(() => {
    let count = 0;
    for (const house of houses) {
      for (const day of rota.days) {
        const covered = day.shifts.some((shift) => shift.houseId === house.id && activeShift(shift));
        if (!covered) count += 1;
      }
    }
    return count;
  }, [houses, rota.days]);

  const scheduledHours = useMemo(() => {
    return allShifts.filter(activeShift).reduce((total, shift) => {
      const duration = new Date(shift.endTime).getTime() - new Date(shift.startTime).getTime();
      return total + Math.max(0, duration / 36e5);
    }, 0);
  }, [allShifts]);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded-lg border border-border bg-surface p-4">
          <p className="text-xs font-semibold text-fg-muted">Scheduled hours</p>
          <p className="mt-1 font-inter text-2xl font-semibold tabular-nums text-fg">{scheduledHours.toFixed(1)}</p>
        </div>
        <div className="rounded-lg border border-border bg-surface p-4">
          <p className="text-xs font-semibold text-fg-muted">Coverage gaps</p>
          <p className="mt-1 font-inter text-2xl font-semibold tabular-nums text-warning-text">{coverageGaps}</p>
        </div>
        <div className="rounded-lg border border-border bg-surface p-4">
          <p className="text-xs font-semibold text-fg-muted">Assignment conflicts</p>
          <p className="mt-1 font-inter text-2xl font-semibold tabular-nums text-danger-text">{conflictIds.size}</p>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[240px_1fr]">
        <aside className="rounded-lg border border-border bg-surface p-3">
          <div className="mb-3">
            <h2 className="text-sm font-semibold text-fg">Available staff</h2>
            <p className="mt-1 text-xs text-fg-muted">Drag a worker into a house/day cell to assign a shift.</p>
          </div>
          <div className="space-y-2">
            {workers.map((worker) => (
              <button
                key={worker.id}
                draggable
                onDragStart={() => setDraggedWorkerId(worker.id)}
                onDragEnd={() => setDraggedWorkerId(null)}
                className="flex w-full cursor-grab items-center justify-between rounded-md border border-border bg-surface px-3 py-2 text-left transition-colors hover:border-brand-200 hover:bg-brand-50"
              >
                <span>
                  <span className="block text-sm font-medium text-fg">{worker.name}</span>
                  <span className="block text-xs text-fg-muted">{worker.email}</span>
                </span>
                <Badge variant="neutral" label="Worker" dot={false} />
              </button>
            ))}
          </div>
        </aside>

        <section className="overflow-hidden rounded-lg border border-border bg-surface">
          <div className="overflow-auto">
            <div className="grid min-w-[1120px] grid-cols-[220px_repeat(7,minmax(128px,1fr))]">
              <div className="sticky left-0 top-0 z-20 border-b border-r border-border bg-surface-subtle p-3 text-xs font-semibold text-fg-muted">
                House / Site
              </div>
              {rota.days.map((day) => {
                const label = formatDay(day.date);
                return (
                  <div key={day.date} className="sticky top-0 z-10 border-b border-r border-border bg-surface-subtle p-3 text-center">
                    <p className="text-xs font-semibold text-fg-muted">{label.weekday}</p>
                    <p className="font-inter text-sm font-semibold tabular-nums text-fg">{label.day}</p>
                  </div>
                );
              })}

              {houses.map((house) => (
                <div key={house.id} className="contents">
                  <div className="sticky left-0 z-10 border-b border-r border-border bg-surface p-3">
                    <p className="text-sm font-semibold text-fg">{house.name}</p>
                    <p className="mt-1 line-clamp-2 text-xs text-fg-muted">{house.address}</p>
                  </div>
                  {rota.days.map((day) => {
                    const shifts = day.shifts.filter((shift) => shift.houseId === house.id);
                    const covered = shifts.some(activeShift);
                    return (
                      <div
                        key={`${house.id}-${day.date}`}
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={() => {
                          if (draggedWorkerId) onAddShift(day.date, draggedWorkerId, house.id);
                          setDraggedWorkerId(null);
                        }}
                        className="min-h-[160px] border-b border-r border-border bg-surface p-2"
                      >
                        {!covered && (
                          <div className="mb-2 rounded-md border border-warning-border bg-warning-bg px-2 py-1.5 text-xs text-warning-text">
                            <div className="flex items-center gap-1 font-semibold">
                              <WarningCircleIcon size={13} />
                              Coverage gap
                            </div>
                          </div>
                        )}
                        <div className="space-y-2">
                          {shifts.map((shift) => (
                            <ShiftCard
                              key={shift.id}
                              shift={shift}
                              conflict={conflictIds.has(shift.id)}
                              onDragStart={() => setDraggedWorkerId(shift.workerId)}
                            />
                          ))}
                        </div>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="mt-2 w-full border border-dashed border-border text-xs"
                          onClick={() => onAddShift(day.date, undefined, house.id)}
                          icon={<PlusIcon size={13} />}
                        >
                          Add shift
                        </Button>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
