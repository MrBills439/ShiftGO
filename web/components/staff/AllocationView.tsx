'use client';
import { useMemo, useState } from 'react';
import { CaretLeftIcon, CaretRightIcon } from '@phosphor-icons/react';
import { clsx } from 'clsx';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Select as UiSelect } from '@/components/ui/Input';
import { WeeklyHoursOverrideModal, type WeeklyHoursOverrideDetails } from '@/components/staff/WeeklyHoursOverrideModal';
import { useStaffAllocation } from '@/hooks/useStaffAllocation';
import { useAvailableShifts, useUpdateShift } from '@/hooks/useShifts';
import { useAuthStore } from '@/store/authStore';
import { useToast } from '@/hooks/useToast';
import { ROLE_META, ROLE_LABELS, initials } from '@/lib/roles';
import { API_BASE } from '@/lib/api';
import type { AllocationHoursStatus, AllocationCurrentStatus, AllocationAvailability, AllocationWorker } from '@/types';

function mondayOf(d: Date): string {
  const x = new Date(d);
  x.setHours(12, 0, 0, 0);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}
function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const x = new Date(y, m - 1, d + n, 12);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}
const fmtRange = (startIso: string, endIso: string) => {
  const s = new Date(startIso);
  const e = new Date(endIso);
  const opt: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' };
  return `${s.toLocaleDateString('en-GB', opt)} – ${new Date(e.getTime() - 1).toLocaleDateString('en-GB', opt)}`;
};
const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

const HOURS_META: Record<AllocationHoursStatus, { variant: 'success' | 'warning' | 'danger'; label: string }> = {
  SAFE: { variant: 'success', label: 'Safe' },
  OVER_CONTRACT: { variant: 'warning', label: 'Over contract' },
  NEAR_LIMIT: { variant: 'warning', label: 'Near limit' },
  OVER_LIMIT: { variant: 'danger', label: 'Approval required' },
};
const CURRENT_META: Record<AllocationCurrentStatus, { variant: 'info' | 'neutral'; label: string }> = {
  ON_SHIFT: { variant: 'info', label: 'On shift' },
  OFF_SHIFT: { variant: 'neutral', label: 'Off shift' },
};
const AVAIL_META: Record<AllocationAvailability, { variant: 'success' | 'danger' | 'warning'; label: string }> = {
  AVAILABLE: { variant: 'success', label: 'Available' },
  CONFLICT: { variant: 'danger', label: 'Conflict' },
  ON_LEAVE: { variant: 'warning', label: 'On leave' },
};

type FilterKey = 'ALL' | AllocationCurrentStatus | AllocationAvailability | AllocationHoursStatus;
const BASE_FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'ALL', label: 'All' },
  { key: 'ON_SHIFT', label: 'On shift' },
  { key: 'OFF_SHIFT', label: 'Off shift' },
  { key: 'SAFE', label: 'Safe hours' },
  { key: 'NEAR_LIMIT', label: 'Near limit' },
  { key: 'OVER_CONTRACT', label: 'Over contract' },
  { key: 'OVER_LIMIT', label: 'Approval required' },
];
const PROPOSED_FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'AVAILABLE', label: 'Available' },
  { key: 'CONFLICT', label: 'Conflict' },
  { key: 'ON_LEAVE', label: 'On leave' },
];

export function AllocationView() {
  const user = useAuthStore((s) => s.user);
  const toast = useToast();
  const canOverride = ['HR', 'MANAGER'].includes(user?.role ?? '');

  const [week, setWeek] = useState<string>(() => mondayOf(new Date()));
  const [proposedShiftId, setProposedShiftId] = useState<string>('');
  const [filter, setFilter] = useState<FilterKey>('ALL');
  const [override, setOverride] = useState<{ workerId: string; name: string; details: WeeklyHoursOverrideDetails } | null>(null);

  const { data, isLoading, isError } = useStaffAllocation(week, proposedShiftId || undefined);
  const { data: openShifts = [] } = useAvailableShifts(true);
  const updateShift = useUpdateShift();

  const filters = data?.proposedShift ? [...BASE_FILTERS, ...PROPOSED_FILTERS] : BASE_FILTERS;

  const workers = useMemo(() => {
    const rows = data?.workers ?? [];
    if (filter === 'ALL') return rows;
    return rows.filter(
      (w) => w.currentStatus === filter || w.hoursStatus === filter || w.availabilityForSelectedShift === filter,
    );
  }, [data, filter]);

  async function assign(w: AllocationWorker, overrideReason?: string) {
    if (!proposedShiftId) return;
    try {
      await updateShift.mutateAsync({
        id: proposedShiftId,
        workerId: w.id,
        ...(overrideReason ? { overrideWeeklyLimit: true, overrideReason } : {}),
      });
      toast.success(`Assigned to ${w.name}`);
      setProposedShiftId('');
      setOverride(null);
    } catch (e: any) {
      const code = e.response?.data?.code;
      const details = e.response?.data?.details ?? {};
      if (code === 'APPROVAL_REQUIRED' || code === 'OVERRIDE_NOT_PERMITTED') {
        setOverride({ workerId: w.id, name: w.name, details });
      } else {
        toast.error(e.response?.data?.message ?? 'Could not assign this shift');
      }
    }
  }

  return (
    <div className="space-y-4">
      {/* Week + proposed shift controls */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex items-center rounded-lg border border-border bg-surface">
          <button className="px-2.5 py-1.5 text-fg-muted hover:text-fg" onClick={() => setWeek((w) => addDays(w, -7))} aria-label="Previous week">
            <CaretLeftIcon size={16} weight="bold" />
          </button>
          <span className="px-3 text-sm font-medium text-fg">{data ? fmtRange(data.week, data.weekEnd) : 'Week'}</span>
          <button className="px-2.5 py-1.5 text-fg-muted hover:text-fg" onClick={() => setWeek((w) => addDays(w, 7))} aria-label="Next week">
            <CaretRightIcon size={16} weight="bold" />
          </button>
        </div>
        <button className="text-sm font-medium text-brand-700 hover:underline" onClick={() => setWeek(mondayOf(new Date()))}>
          This week
        </button>
        <div className="ml-auto min-w-[240px]">
          <UiSelect value={proposedShiftId} onChange={(e) => { setProposedShiftId(e.target.value); setFilter('ALL'); }}>
            <option value="">Project an open shift…</option>
            {openShifts.map((s) => (
              <option key={s.id} value={s.id}>
                {s.house?.name} · {new Date(s.startTime).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })} {fmtTime(s.startTime)}–{fmtTime(s.endTime)}
              </option>
            ))}
          </UiSelect>
        </div>
      </div>

      {data?.proposedShift && (
        <div className="rounded-lg border border-info/30 bg-info/5 px-4 py-2.5 text-sm text-fg">
          Projecting <span className="font-semibold">{data.proposedShift.house?.name}</span> ·{' '}
          {fmtTime(data.proposedShift.startTime)}–{fmtTime(data.proposedShift.endTime)} ·{' '}
          {data.proposedShift.durationHours}h · agency limit {data.maxWeeklyScheduledHours}h/week
        </div>
      )}

      <div className="flex flex-wrap gap-1.5">
        {filters.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={clsx(
              'rounded-full px-3 py-1 text-xs font-semibold transition-colors',
              filter === f.key ? 'bg-brand-600 text-white' : 'bg-surface-subtle text-fg-muted hover:text-fg'
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      <Card className="overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-sm text-fg-muted">Loading allocation…</div>
        ) : isError ? (
          <div className="p-8 text-center text-sm text-fg-muted">Couldn&apos;t load the allocation view.</div>
        ) : workers.length === 0 ? (
          <div className="p-8 text-center text-sm text-fg-muted">No staff match this filter.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-fg-subtle">
                  <th className="px-4 py-2.5 font-semibold">Staff</th>
                  <th className="px-3 py-2.5 font-semibold">Now</th>
                  {data?.proposedShift && <th className="px-3 py-2.5 font-semibold">For this shift</th>}
                  <th className="px-3 py-2.5 font-semibold text-right">Contracted</th>
                  <th className="px-3 py-2.5 font-semibold text-right">This week</th>
                  <th className="px-3 py-2.5 font-semibold text-right">Remaining</th>
                  {data?.proposedShift && <th className="px-3 py-2.5 font-semibold text-right">Projected</th>}
                  <th className="px-3 py-2.5 font-semibold">Hours</th>
                  {data?.proposedShift && <th className="px-3 py-2.5 font-semibold text-right">Action</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {workers.map((w) => {
                  const hm = HOURS_META[w.hoursStatus];
                  const cm = CURRENT_META[w.currentStatus];
                  const av = w.availabilityForSelectedShift ? AVAIL_META[w.availabilityForSelectedShift] : null;
                  const roleEligible = !data?.proposedShift
                    || (data.proposedShift.eligibleRoles ?? ['WORKER']).includes(w.role);
                  return (
                    <tr key={w.id} className="hover:bg-neutral-50">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          {w.profilePicture ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={`${API_BASE}${w.profilePicture}`} alt="" className="h-8 w-8 rounded-full object-cover flex-shrink-0" />
                          ) : (
                            <div className={clsx('flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-[11px] font-semibold', ROLE_META[w.role].avatarClass)}>
                              {initials(w.name)}
                            </div>
                          )}
                          <div className="min-w-0">
                            <p className="font-semibold text-fg truncate">{w.name}</p>
                            <p className="text-xs text-fg-muted">{ROLE_LABELS[w.role] ?? w.role}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3"><Badge variant={cm.variant} label={cm.label} dot={false} /></td>
                      {data?.proposedShift && (
                        <td className="px-3 py-3">{av ? <Badge variant={av.variant} label={av.label} dot={false} /> : '—'}</td>
                      )}
                      <td className="px-3 py-3 text-right tabular-nums text-fg-muted">{w.contractedHours ?? '—'}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{w.scheduledHours} / {w.maxWeeklyScheduledHours}</td>
                      <td className="px-3 py-3 text-right tabular-nums text-fg-muted">{w.remainingContractedHours ?? '—'}</td>
                      {data?.proposedShift && (
                        <td className="px-3 py-3 text-right tabular-nums font-semibold">{w.projectedHours}</td>
                      )}
                      <td className="px-3 py-3"><Badge variant={hm.variant} label={hm.label} dot={false} /></td>
                      {data?.proposedShift && (
                        <td className="px-3 py-3 text-right">
                          {w.availabilityForSelectedShift === 'CONFLICT' ? (
                            <span className="text-xs text-danger">Conflict</span>
                          ) : w.availabilityForSelectedShift === 'ON_LEAVE' ? (
                            <span className="text-xs text-warning-text">On leave</span>
                          ) : !roleEligible ? (
                            <span className="text-xs text-fg-subtle">Not eligible</span>
                          ) : (
                            <Button
                              size="sm"
                              variant={w.hoursStatus === 'OVER_LIMIT' ? 'secondary' : 'primary'}
                              disabled={updateShift.isPending}
                              onClick={() => assign(w)}
                            >
                              {w.hoursStatus === 'OVER_LIMIT' ? (canOverride ? 'Assign (override)' : 'Approval req.') : 'Assign'}
                            </Button>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <WeeklyHoursOverrideModal
        open={!!override}
        onClose={() => setOverride(null)}
        workerName={override?.name}
        details={override?.details ?? null}
        canOverride={canOverride}
        isPending={updateShift.isPending}
        onConfirm={(reason) => {
          const w = data?.workers.find((x) => x.id === override?.workerId);
          if (w) assign(w, reason);
        }}
      />
    </div>
  );
}
