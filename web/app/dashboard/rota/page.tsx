'use client';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CaretLeftIcon, CaretRightIcon, CalendarBlankIcon } from '@phosphor-icons/react';
import { useRotaWeek, useWorkers } from '@/hooks/useRota';
import { useHouses } from '@/hooks/useHouses';
import { RotaWeekView } from './components/RotaWeekView';
import { ShiftModal } from './components/ShiftModal';
import { useAuthStore } from '@/store/authStore';
import { Header } from '@/components/layout/Header';
import { Button } from '@/components/ui/Button';
import { FilterBar } from '@/components/ui/FilterBar';
import { FieldShell, Select } from '@/components/ui/Input';
import type { User } from '@/types';

function mondayOfWeek(date: Date) {
  const next = new Date(date);
  const day = next.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  next.setDate(next.getDate() + diff);
  next.setHours(0, 0, 0, 0);
  return next;
}

function toDateInput(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatWeekRange(start: Date) {
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return `${start.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })} - ${end.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}`;
}

export default function RotaPage() {
  const router = useRouter();
  const { user } = useAuthStore();
  const canManageRota = user?.role === 'MANAGER' || user?.role === 'HR';
  const [currentDate, setCurrentDate] = useState(() => mondayOfWeek(new Date()));
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [selectedShift, setSelectedShift] = useState<{ date: string; workerId?: string; houseId?: string } | null>(null);

  const startDateStr = toDateInput(currentDate);
  const { data: rota, isLoading, error } = useRotaWeek(startDateStr, filters);
  const { data: houses = [] } = useHouses();
  const { data: workers = [] } = useWorkers('WORKER');

  useEffect(() => {
    if (!canManageRota) router.replace('/dashboard');
  }, [canManageRota, router]);

  const activeFilterCount = Object.values(filters).filter(Boolean).length;

  const operationalSummary = useMemo(() => {
    const shifts = rota?.days.flatMap((day) => day.shifts) ?? [];
    const pendingTimesheets = shifts.filter((shift) => shift.timesheet?.status === 'PENDING').length;
    const liveShifts = shifts.filter((shift) => shift.status === 'IN_PROGRESS').length;
    return { pendingTimesheets, liveShifts, shifts: shifts.length };
  }, [rota]);

  if (!canManageRota) return null;

  function changeWeek(delta: number) {
    setCurrentDate((value) => {
      const next = new Date(value);
      next.setDate(value.getDate() + delta);
      return mondayOfWeek(next);
    });
  }

  function handleFilterChange(key: string, value: string) {
    setFilters((prev) => {
      const next = { ...prev };
      if (value) next[key] = value;
      else delete next[key];
      return next;
    });
  }

  return (
    <div className="space-y-8">
      <Header
        title="Schedule"
        subtitle="Plan, review, and manage weekly shift coverage across all locations"
        action={<Button variant="primary" icon={<CalendarBlankIcon size={16} />} onClick={() => setSelectedShift({ date: startDateStr })}>Create shift</Button>}
      />

      <section className="rounded-lg border border-neutral-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3">
            <Button
              variant="secondary"
              onClick={() => changeWeek(-7)}
              aria-label="Previous week"
              icon={<CaretLeftIcon size={16} />}
            />
            <div className="min-w-[260px] rounded-md border border-neutral-200 bg-neutral-50 px-4 py-3 text-center">
              <p className="text-xs font-semibold text-fg-muted uppercase tracking-widest">Week commencing</p>
              <p className="font-inter text-base font-semibold text-fg mt-1">{formatWeekRange(currentDate)}</p>
            </div>
            <Button
              variant="secondary"
              onClick={() => changeWeek(7)}
              aria-label="Next week"
              icon={<CaretRightIcon size={16} />}
            />
            <Button
              variant="ghost"
              onClick={() => setCurrentDate(mondayOfWeek(new Date()))}
              className="ml-2"
            >
              Today
            </Button>
          </div>
          <div className="grid grid-cols-3 gap-6">
            <div className="text-right">
              <p className="text-xs font-semibold text-fg-muted uppercase tracking-widest">Total Shifts</p>
              <p className="font-inter text-2xl font-semibold text-fg mt-1">{operationalSummary.shifts}</p>
            </div>
            <div className="text-right">
              <p className="text-xs font-semibold text-fg-muted uppercase tracking-widest">Live Now</p>
              <p className="font-inter text-2xl font-semibold text-success mt-1">{operationalSummary.liveShifts}</p>
            </div>
            <div className="text-right">
              <p className="text-xs font-semibold text-fg-muted uppercase tracking-widest">Pending</p>
              <p className="font-inter text-2xl font-semibold text-warning mt-1">{operationalSummary.pendingTimesheets}</p>
            </div>
          </div>
        </div>
      </section>

      <FilterBar activeCount={activeFilterCount} onClear={() => setFilters({})}>
        <FieldShell label="Worker">
          <Select value={filters.workerId || ''} onChange={(e) => handleFilterChange('workerId', e.target.value)}>
            <option value="">All workers</option>
            {workers?.map((worker: User) => (
              <option key={worker.id} value={worker.id}>{worker.name}</option>
            ))}
          </Select>
        </FieldShell>
        <FieldShell label="House/site">
          <Select value={filters.houseId || ''} onChange={(e) => handleFilterChange('houseId', e.target.value)}>
            <option value="">All houses</option>
            {houses?.map((house) => (
              <option key={house.id} value={house.id}>{house.name}</option>
            ))}
          </Select>
        </FieldShell>
        <FieldShell label="Shift type">
          <Select value={filters.shiftType || ''} onChange={(e) => handleFilterChange('shiftType', e.target.value)}>
            <option value="">All types</option>
            <option value="DAY">Day</option>
            <option value="WAKE_NIGHT">Wake night</option>
            <option value="SLEEP_IN">Sleep-in</option>
            <option value="EMERGENCY">Emergency</option>
          </Select>
        </FieldShell>
        <FieldShell label="Status">
          <Select value={filters.status || ''} onChange={(e) => handleFilterChange('status', e.target.value)}>
            <option value="">All statuses</option>
            <option value="SCHEDULED">Scheduled</option>
            <option value="IN_PROGRESS">In progress</option>
            <option value="COMPLETED">Completed</option>
            <option value="CANCELLED">Cancelled</option>
          </Select>
        </FieldShell>
      </FilterBar>

      {isLoading ? (
        <div className="rounded-lg border border-neutral-200 bg-white p-12 text-center">
          <div className="flex justify-center mb-4">
            <div className="w-8 h-8 rounded-full border-2 border-neutral-200 border-t-primary animate-spin" />
          </div>
          <p className="text-sm font-medium text-fg-muted">Loading schedule...</p>
        </div>
      ) : error ? (
        <div className="rounded-lg border border-danger/20 bg-danger/5 p-6">
          <p className="text-sm font-semibold text-danger mb-2">Failed to load schedule</p>
          <p className="text-sm text-fg-muted mb-4">There was a problem loading the schedule data. Please try again or contact support if the issue persists.</p>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => window.location.reload()}
          >
            Reload Schedule
          </Button>
        </div>
      ) : rota ? (
        <RotaWeekView
          rota={rota}
          houses={houses}
          workers={workers}
          onAddShift={(date, workerId, houseId) => setSelectedShift({ date, workerId, houseId })}
        />
      ) : null}

      {selectedShift && (
        <ShiftModal
          defaultDate={selectedShift.date}
          defaultWorkerId={selectedShift.workerId}
          defaultHouseId={selectedShift.houseId}
          onClose={() => setSelectedShift(null)}
          onSuccess={() => setSelectedShift(null)}
        />
      )}
    </div>
  );
}
