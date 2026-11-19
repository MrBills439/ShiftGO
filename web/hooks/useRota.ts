import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { instantToAgencyParts } from '@/lib/shiftTime';
import { agencyTimeZone } from '@/lib/displayTime';
import { RotaShiftSummary, RotaWeek, Shift } from '@/types';

function toRotaWeek(startDate: string, items: RotaShiftSummary[]): RotaWeek {
  const start = new Date(`${startDate}T00:00:00.000Z`);
  const days = Array.from({ length: 7 }, (_, idx) => {
    const day = new Date(start);
    day.setUTCDate(start.getUTCDate() + idx);
    return {
      date: day.toISOString().split('T')[0],
      shifts: [] as Shift[],
    };
  });

  for (const item of items) {
    if (!item.house) continue;
    // The agency calendar day the shift starts on (not its UTC date): a shift
    // at 00:30 BST is 23:30 UTC the day before but belongs to this day.
    const date = instantToAgencyParts(item.startTime, agencyTimeZone()).date;
    const day = days.find((d) => d.date === date);
    if (!day) continue;

    day.shifts.push({
      id: item.shiftId,
      houseId: item.house.id,
      // Every item that reaches this point already passed the `!item.house`
      // guard above, so it is always a ROTA (House-backed) shift — the rota
      // week grid is House-indexed and never shows a Location-backed shift.
      locationId: null,
      kind: 'ROTA',
      workerId: item.worker?.id ?? null,
      createdById: '',
      startTime: item.startTime,
      endTime: item.endTime,
      date,
      shiftType: item.shiftType,
      status: item.status,
      urgent: item.urgent,
      eligibleRoles: item.eligibleRoles ?? [],
      claimCount: item.claimCount,
      cancelledAt: null,
      cancelledById: null,
      cancellationReason: item.cancellationReason,
      house: item.house as Shift['house'],
      worker: item.worker,
      cancelledBy: null,
      timesheet: item.timesheet as Shift['timesheet'],
    });
  }

  return {
    startDate: days[0].date,
    endDate: days[6].date,
    days,
  };
}

export function useRotaWeek(startDate: string, filters?: Record<string, string>) {
  const params = { startDate, ...filters };
  return useQuery<RotaWeek>({
    queryKey: ['rota-week', startDate, filters],
    queryFn: async () => {
      const { data } = await api.get('/rota/week', { params });
      return toRotaWeek(startDate, data.data);
    },
    staleTime: 30_000,
  });
}

export function useRotaDay(date: string, filters?: Record<string, string>) {
  const params = { date, ...filters };
  return useQuery<Shift[]>({
    queryKey: ['rota-day', date, filters],
    queryFn: async () => {
      const { data } = await api.get('/rota/day', { params });
      return data.data;
    },
    staleTime: 30_000,
  });
}

export function useWorkers(role?: string) {
  return useQuery({
    queryKey: ['workers', role],
    queryFn: async () => {
      const params = role ? { role } : {};
      const { data } = await api.get('/users', { params });
      return data.data;
    },
    staleTime: 60_000,
  });
}
