import { RotaWeek, Shift, House, User } from '@/types';
import { ShiftCard } from './ShiftCard';
import {
  PlusIcon, WarningCircleIcon, MagnifyingGlassIcon, CheckCircleIcon,
  ClockIcon, CalendarXIcon, UsersThreeIcon,
} from '@phosphor-icons/react';
import { useMemo, useState } from 'react';
import { clsx } from 'clsx';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';

// A House/day cell needs no further shifts once its active shifts already
// add up to a full day — round-the-clock care coverage, same convention as
// "Scheduled hours" elsewhere on this page (sum of durations, not a strict
// gap-free timeline check).
const FULL_DAY_HOURS = 24;

interface RotaWeekViewProps {
  rota: RotaWeek;
  houses: House[];
  workers: User[];
  mode: 'assign' | 'open';
  onAddShift: (date: string, workerId?: string, houseId?: string) => void;
  onOpenShift: (date: string, houseId: string) => void;
  onRequestCover: (shift: Shift) => void;
  onCopyShift: (shift: Shift) => void;
  onEditShift: (shift: Shift) => void;
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

export function RotaWeekView({ rota, houses, workers, mode, onAddShift, onOpenShift, onRequestCover, onCopyShift, onEditShift }: RotaWeekViewProps) {
  const [draggedWorkerId, setDraggedWorkerId] = useState<string | null>(null);
  const [staffSearch, setStaffSearch] = useState('');

  const filteredWorkers = useMemo(() => {
    if (!staffSearch.trim()) return workers;
    const q = staffSearch.toLowerCase();
    return workers.filter((w) => w.name.toLowerCase().includes(q) || w.email.toLowerCase().includes(q));
  }, [workers, staffSearch]);

  const allShifts = useMemo(() => rota.days.flatMap((day) => day.shifts), [rota.days]);

  const houseHours = useMemo(() => {
    const map = new Map<string, number>();
    for (const house of houses) {
      const hours = allShifts
        .filter(activeShift)
        .filter((s) => s.houseId === house.id)
        .reduce((total, shift) => total + Math.max(0, (new Date(shift.endTime).getTime() - new Date(shift.startTime).getTime()) / 36e5), 0);
      map.set(house.id, hours);
    }
    return map;
  }, [houses, allShifts]);
  const conflictIds = useMemo(() => {
    const ids = new Set<string>();
    const byWorker = new Map<string, Shift[]>();
    allShifts.filter(activeShift).filter((shift) => shift.workerId).forEach((shift) => {
      const workerId = shift.workerId as string;
      byWorker.set(workerId, [...(byWorker.get(workerId) ?? []), shift]);
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
        <div className="flex items-center gap-3 rounded-lg border border-border bg-surface p-4">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-600">
            <ClockIcon size={20} weight="bold" />
          </span>
          <div>
            <p className="text-xs font-semibold text-fg-muted">Scheduled hours</p>
            <p className="font-inter text-2xl font-semibold tabular-nums text-fg">{scheduledHours.toFixed(1)}</p>
          </div>
        </div>
        <div className="flex items-center gap-3 rounded-lg border border-border bg-surface p-4">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-warning-bg text-warning-text">
            <CalendarXIcon size={20} weight="bold" />
          </span>
          <div>
            <p className="text-xs font-semibold text-fg-muted">Coverage gaps</p>
            <p className="font-inter text-2xl font-semibold tabular-nums text-warning-text">{coverageGaps}</p>
          </div>
        </div>
        <div className="flex items-center gap-3 rounded-lg border border-border bg-surface p-4">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-danger-bg text-danger-text">
            <WarningCircleIcon size={20} weight="bold" />
          </span>
          <div>
            <p className="text-xs font-semibold text-fg-muted">Assignment conflicts</p>
            <p className="font-inter text-2xl font-semibold tabular-nums text-danger-text">{conflictIds.size}</p>
          </div>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[240px_1fr]">
        <aside className="flex max-h-[720px] flex-col rounded-lg border border-border bg-surface p-3 shadow-sm">
          <div className="mb-3">
            <h2 className="flex items-center gap-1.5 text-sm font-semibold text-fg">
              <UsersThreeIcon size={15} className="text-fg-muted" />
              Available staff ({filteredWorkers.length}{staffSearch ? ` of ${workers.length}` : ''})
            </h2>
            <p className="mt-1 text-xs text-fg-muted">
              {mode === 'assign'
                ? 'Drag a worker into a house/day cell to assign a shift.'
                : 'Switch to Assign Worker mode to drag a worker directly onto a shift.'}
            </p>
          </div>
          <div className="relative mb-2 flex-shrink-0">
            <MagnifyingGlassIcon size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-muted" />
            <input
              type="text"
              placeholder="Search staff…"
              value={staffSearch}
              onChange={(e) => setStaffSearch(e.target.value)}
              className="w-full rounded-md border border-border bg-surface py-1.5 pl-8 pr-2 text-xs focus:outline-none focus:ring-2 focus:ring-brand-600/20"
            />
          </div>
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
            {filteredWorkers.length === 0 ? (
              <p className="px-1 py-4 text-center text-xs text-fg-muted">No staff match "{staffSearch}"</p>
            ) : (
              filteredWorkers.map((worker) => (
                <button
                  key={worker.id}
                  draggable={mode === 'assign'}
                  onDragStart={() => setDraggedWorkerId(worker.id)}
                  onDragEnd={() => setDraggedWorkerId(null)}
                  disabled={mode === 'open'}
                  className="flex w-full cursor-grab items-center justify-between rounded-md border border-border bg-surface px-3 py-2 text-left transition-colors hover:border-brand-200 hover:bg-brand-50 disabled:cursor-default disabled:opacity-50"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-fg">{worker.name}</span>
                    <span className="block truncate text-xs text-fg-muted">{worker.email}</span>
                  </span>
                  <Badge variant="neutral" label="Worker" dot={false} />
                </button>
              ))
            )}
          </div>
        </aside>

        <section className="overflow-hidden rounded-lg border border-border bg-surface shadow-sm">
          <div className="max-h-[720px] overflow-auto">
            <div className="grid min-w-[1120px] grid-cols-[220px_repeat(7,minmax(128px,1fr))]">
              <div className="sticky left-0 top-0 z-20 border-b-2 border-r border-b-brand-600/30 border-r-border bg-surface-subtle p-3 text-xs font-semibold uppercase tracking-wide text-fg-muted">
                House / Site
              </div>
              {rota.days.map((day) => {
                const label = formatDay(day.date);
                return (
                  <div key={day.date} className="sticky top-0 z-10 border-b-2 border-r border-b-brand-600/30 border-r-border bg-surface-subtle p-3 text-center">
                    <p className="text-xs font-semibold text-fg-muted">{label.weekday}</p>
                    <p className="font-inter text-sm font-semibold tabular-nums text-fg">{label.day}</p>
                  </div>
                );
              })}

              {houses.map((house) => {
                const usedHours = houseHours.get(house.id) ?? 0;
                const budget = house.assignedHours;
                const remaining = budget != null ? budget - usedHours : null;
                const budgetPct = budget ? Math.min(100, (usedHours / budget) * 100) : 0;
                const overBudget = remaining != null && remaining < 0;
                return (
                <div key={house.id} className="contents">
                  <div className="sticky left-0 z-10 border-b border-r border-border bg-surface p-3">
                    <p className="text-sm font-semibold text-fg">{house.name}</p>
                    <p className="mt-1 line-clamp-2 text-xs text-fg-muted">{house.address}</p>
                    {budget != null && (
                      <div className="mt-2">
                        <p className={clsx(
                          'font-inter text-[11px] font-semibold tabular-nums',
                          overBudget ? 'text-danger-text' : 'text-fg-muted'
                        )}>
                          {usedHours.toFixed(1)}h / {budget}h this week
                          {remaining != null && (
                            <span className="ml-1 font-normal">
                              ({overBudget ? `${Math.abs(remaining).toFixed(1)}h over` : `${remaining.toFixed(1)}h left`})
                            </span>
                          )}
                        </p>
                        <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-surface-muted">
                          <div
                            className={clsx('h-full rounded-full transition-all', overBudget ? 'bg-danger-solid' : 'bg-brand-600')}
                            style={{ width: `${overBudget ? 100 : budgetPct}%` }}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                  {rota.days.map((day) => {
                    const shifts = day.shifts.filter((shift) => shift.houseId === house.id);
                    const activeDayShifts = shifts.filter(activeShift);
                    const covered = activeDayShifts.length > 0;
                    const dayHours = activeDayShifts.reduce(
                      (total, shift) => total + Math.max(0, (new Date(shift.endTime).getTime() - new Date(shift.startTime).getTime()) / 36e5),
                      0,
                    );
                    const fullyCovered = dayHours >= FULL_DAY_HOURS;
                    return (
                      <div
                        key={`${house.id}-${day.date}`}
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={() => {
                          if (mode === 'assign' && draggedWorkerId) onAddShift(day.date, draggedWorkerId, house.id);
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
                              draggable={mode === 'assign'}
                              onDragStart={() => setDraggedWorkerId(shift.workerId)}
                              onRequestCover={() => onRequestCover(shift)}
                              onCopy={() => onCopyShift(shift)}
                              onEdit={() => onEditShift(shift)}
                            />
                          ))}
                        </div>
                        {fullyCovered ? (
                          <div className="mt-2 flex items-center justify-center gap-1.5 rounded-md border border-dashed border-success-border bg-success-bg/40 py-1.5 text-[11px] font-semibold text-success-text">
                            <CheckCircleIcon size={14} weight="fill" />
                            Day fully covered
                          </div>
                        ) : (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="mt-2 w-full border border-dashed border-border text-xs"
                            onClick={() =>
                              mode === 'assign'
                                ? onAddShift(day.date, undefined, house.id)
                                : onOpenShift(day.date, house.id)
                            }
                            icon={<PlusIcon size={13} />}
                          >
                            {mode === 'assign' ? 'Add shift' : 'Post open shift'}
                          </Button>
                        )}
                      </div>
                    );
                  })}
                </div>
                );
              })}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
