'use client';
import { useMemo, useState } from 'react';
import {
  PlusIcon, CalendarBlankIcon, TrashIcon, ArrowsClockwiseIcon, CopyIcon, FireIcon, MoonIcon,
  HandTapIcon, ClockIcon, MapPinIcon, UsersIcon, CheckCircleIcon,
} from '@phosphor-icons/react';
import { Header } from '@/components/layout/Header';
import { Modal } from '@/components/ui/Modal';
import { Badge } from '@/components/ui/Badge';
import { LoadingOverlay } from '@/components/ui/LoadingOverlay';
import { EmptyState } from '@/components/ui/EmptyState';
import { TableSkeleton } from '@/components/ui/Skeleton';
import { useShifts, useCreateShift, useUpdateShift, useDeleteShift, useOpenShift, useAvailableShifts, useClaimShift, useDropShift } from '@/hooks/useShifts';
import { usePendingShiftChanges } from '@/hooks/useShiftChange';
import { ShiftRequestsPanel } from '@/components/shifts/ShiftRequestsPanel';
import { useHouses } from '@/hooks/useHouses';
import { useLocationOptions } from '@/hooks/useOrgStructure';
import { useUsers } from '@/hooks/useWorkers';
import { useAuthStore } from '@/store/authStore';
import { useToast } from '@/hooks/useToast';
import { SHIFT_TYPE_OPTIONS, SHIFT_TYPE_META } from '@/lib/shiftTypes';
import { COVER_ROLE_GROUPS, isGroupSelected, toggleGroupRoles } from '@/lib/coverRoles';
import { shiftAttendanceTarget } from '@/lib/shiftAttendanceTarget';
import { WeeklyHoursOverrideModal, type WeeklyHoursOverrideDetails } from '@/components/staff/WeeklyHoursOverrideModal';
import { clsx } from 'clsx';
import type { Role, Shift, ShiftKind, User } from '@/types';

function shiftStatus(shift: { startTime: string; endTime: string; status?: string }): 'active' | 'upcoming' | 'completed' | 'cancelled' {
  if (shift.status === 'CANCELLED') return 'cancelled';
  if (shift.status === 'COMPLETED') return 'completed';
  if (shift.status === 'IN_PROGRESS') return 'active';
  const now = new Date();
  if (new Date(shift.startTime) <= now && new Date(shift.endTime) >= now) return 'active';
  if (new Date(shift.startTime) > now) return 'upcoming';
  return 'completed';
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function shiftDur(start: string, end: string) {
  const h = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 3_600_000);
  return `${h}h`;
}

function dateParts(iso: string) {
  const d = new Date(iso);
  return {
    day: d.toLocaleDateString('en-GB', { weekday: 'short' }).toUpperCase(),
    num: d.getDate(),
    mon: d.toLocaleDateString('en-GB', { month: 'short' }).toUpperCase(),
  };
}

/** Small ROTA/FIXED label — the only visual distinction this V1 adds. */
function KindBadge({ kind }: { kind?: ShiftKind }) {
  return (
    <Badge
      variant={kind === 'FIXED' ? 'info' : 'neutral'}
      label={kind === 'FIXED' ? 'Fixed' : 'Rota'}
      dot={false}
    />
  );
}

export default function ShiftsPage() {
  const user = useAuthStore((s) => s.user);
  return user?.role === 'WORKER' ? <MyShiftsView /> : <ManageShiftsView />;
}

const STATUS_BADGE: Record<string, { variant: 'active' | 'confirmed' | 'completed' | 'neutral'; label: string }> = {
  active: { variant: 'active', label: 'Active' },
  upcoming: { variant: 'confirmed', label: 'Confirmed' },
  completed: { variant: 'completed', label: 'Completed' },
  cancelled: { variant: 'neutral', label: 'Cancelled' },
};

function ShiftListCard({ shift, onDrop }: { shift: Shift; onDrop?: () => void }) {
  const status = shiftStatus(shift);
  const { day, num, mon } = dateParts(shift.startTime);
  const isPast = status === 'completed' || status === 'cancelled';
  const badge = STATUS_BADGE[status];
  // Dropping re-opens a shift for cover — a House/ROTA-only concept.
  const canDrop = onDrop && status === 'upcoming' && shift.kind === 'ROTA';
  const target = shiftAttendanceTarget(shift);

  return (
    <div className={clsx('glass-card flex items-center gap-3.5 p-4', status === 'active' && 'border-brand-600')}>
      <div className={clsx('w-12 flex-shrink-0 text-center', isPast && 'opacity-55')}>
        <p className="text-[10px] font-bold tracking-wide text-brand-700">{day}</p>
        <p className="text-2xl font-extrabold leading-tight tracking-tight text-fg">{num}</p>
        <p className="text-[10px] font-bold tracking-wide text-fg-muted">{mon}</p>
      </div>
      <div className="w-px self-stretch bg-border" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <p className="text-sm font-semibold text-fg">{target?.name ?? 'Unknown location'}</p>
          <KindBadge kind={shift.kind} />
        </div>
        <p className="mb-1.5 text-xs text-fg-muted">{shift.kind === 'FIXED' ? 'Fixed Shift' : 'Care Support Shift'}</p>
        <div className="mb-1 flex items-center gap-1.5">
          <ClockIcon size={12} className={isPast ? 'text-fg-subtle' : 'text-brand-700'} />
          <span className={clsx('text-xs font-semibold', isPast ? 'text-fg-muted' : 'text-brand-700')}>
            {fmtTime(shift.startTime)} – {fmtTime(shift.endTime)}
            <span className="font-medium text-fg-subtle"> ({shiftDur(shift.startTime, shift.endTime)})</span>
          </span>
        </div>
        {target?.address && (
          <div className="flex items-center gap-1.5">
            <MapPinIcon size={11} className="text-fg-subtle" />
            <span className="truncate text-[11px] text-fg-muted">{target.address}</span>
          </div>
        )}
        {status === 'completed' && (
          <div className="mt-1 flex items-center gap-1.5">
            <CheckCircleIcon size={12} weight="fill" className="text-fg-subtle" />
            <span className="text-[11px] text-fg-muted">{shiftDur(shift.startTime, shift.endTime)} worked</span>
          </div>
        )}
      </div>
      <div className="flex flex-shrink-0 flex-col items-end gap-2">
        <Badge variant={badge.variant as any} label={badge.label} />
        {canDrop && (
          <button
            onClick={onDrop}
            className="text-[11px] font-semibold text-danger-text transition-colors hover:underline"
          >
            Drop shift
          </button>
        )}
      </div>
    </div>
  );
}

function OpenShiftCard({ shift, onClaim, claiming }: { shift: Shift; onClaim: () => void; claiming: boolean }) {
  const { day, num, mon } = dateParts(shift.startTime);
  // Open shifts remain a House/ROTA-only concept — target is always HOUSE.
  const target = shiftAttendanceTarget(shift);
  return (
    <div className="glass-card border-dashed border-warning-border p-4">
      <div className="flex items-center gap-3.5">
        <div className="w-12 flex-shrink-0 text-center">
          <p className="text-[10px] font-bold tracking-wide text-brand-700">{day}</p>
          <p className="text-2xl font-extrabold leading-tight tracking-tight text-fg">{num}</p>
          <p className="text-[10px] font-bold tracking-wide text-fg-muted">{mon}</p>
        </div>
        <div className="w-px self-stretch bg-border" />
        <div className="min-w-0 flex-1">
          <p className="mb-1 text-sm font-semibold text-fg">{target?.name ?? 'Unknown location'}</p>
          <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-brand-700">
            <ClockIcon size={12} />
            {fmtTime(shift.startTime)} – {fmtTime(shift.endTime)}
            <span className="font-medium text-fg-subtle">({shiftDur(shift.startTime, shift.endTime)})</span>
          </div>
          {target?.address && (
            <div className="mb-1 flex items-center gap-1.5">
              <MapPinIcon size={11} className="text-fg-subtle" />
              <span className="truncate text-[11px] text-fg-muted">{target.address}</span>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-1.5">
            <UsersIcon size={12} className="text-warning-text" />
            <span className="text-[11px] font-semibold text-warning-text">{shift.claimCount ?? 0} claimed so far</span>
            {shift.urgent && (
              <span className="inline-flex items-center gap-1 rounded-full border border-danger-border bg-danger-bg px-2 py-0.5 text-[10px] font-semibold text-danger-text">
                <FireIcon size={10} weight="fill" /> Urgent
              </span>
            )}
          </div>
        </div>
      </div>
      <button onClick={onClaim} disabled={claiming} className="btn-primary mt-3.5 w-full justify-center">
        <HandTapIcon size={15} />
        {claiming ? 'Claiming…' : 'Claim shift'}
      </button>
    </div>
  );
}

type Filter = 'available' | 'upcoming' | 'past';

const PAST_WINDOW_DAYS = 7;

function MyShiftsView() {
  const { data: shifts = [], isLoading } = useShifts();
  const { data: availableShifts = [], isLoading: availableLoading } = useAvailableShifts();
  const claimShift = useClaimShift();
  const dropShift = useDropShift();
  const toast = useToast();
  const [claimId, setClaimId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('upcoming');
  const [dropTarget, setDropTarget] = useState<Shift | null>(null);
  const [dropReason, setDropReason] = useState('');

  function confirmDrop() {
    if (!dropTarget) return;
    dropShift.mutate(
      { id: dropTarget.id, reason: dropReason.trim() || undefined },
      {
        onSuccess: () => {
          toast.success('Shift dropped — your manager and team leader have been notified');
          setDropTarget(null);
          setDropReason('');
        },
        onError: (err: any) => toast.error(err.response?.data?.message ?? 'Could not drop this shift'),
      }
    );
  }

  function handleClaim(shift: Shift) {
    setClaimId(shift.id);
    claimShift.mutate(shift.id, {
      onSuccess: () => {
        toast.success(`You're now on the schedule for ${shiftAttendanceTarget(shift)?.name ?? 'this shift'}`);
        setFilter('upcoming');
        setClaimId(null);
      },
      onError: (err: any) => {
        if (err.response?.status === 409) toast.error('Too late — another worker claimed this shift');
        else if (err.response?.status === 403) toast.error("You're not eligible to claim this shift");
        else toast.error(err.response?.data?.message ?? 'Failed to claim shift');
        setClaimId(null);
      },
    });
  }

  const sorted = useMemo(
    () => [...shifts].sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime()),
    [shifts]
  );
  const upcoming = sorted.filter((s) => ['active', 'upcoming'].includes(shiftStatus(s)));
  const pastCutoff = Date.now() - PAST_WINDOW_DAYS * 86_400_000;
  const recentPast = sorted.filter(
    (s) => ['completed', 'cancelled'].includes(shiftStatus(s)) && new Date(s.endTime).getTime() >= pastCutoff
  );

  const TABS: { key: Filter; label: string }[] = [
    { key: 'available', label: 'Availability' },
    { key: 'upcoming', label: 'Upcoming' },
    { key: 'past', label: 'Past' },
  ];

  return (
    <div>
      <Header title="Shifts" subtitle="Pick up extra shifts, and check what's coming up or recently worked" />

      <div className="mb-5 inline-flex rounded-lg border border-border bg-surface p-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setFilter(t.key)}
            className={clsx(
              'flex items-center gap-1.5 rounded-md px-4 py-1.5 text-sm font-semibold transition-colors',
              filter === t.key ? 'bg-brand-600 text-white' : 'text-fg-muted hover:text-fg'
            )}
          >
            {t.label}
            {t.key === 'available' && availableShifts.length > 0 && (
              <span
                className={clsx(
                  'rounded-full px-1.5 text-[10px] font-bold',
                  filter === 'available' ? 'bg-white/25 text-white' : 'bg-warning-bg text-warning-text'
                )}
              >
                {availableShifts.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── Availability ── */}
      {filter === 'available' && (
        availableLoading ? (
          <TableSkeleton cols={3} rows={3} />
        ) : availableShifts.length === 0 ? (
          <EmptyState
            icon={HandTapIcon}
            title="No open shifts right now"
            description="When a shift needs cover and you're eligible for it, it'll appear here to pick up."
          />
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {availableShifts.map((s) => (
              <OpenShiftCard
                key={s.id}
                shift={s}
                claiming={claimShift.isPending && claimId === s.id}
                onClaim={() => handleClaim(s)}
              />
            ))}
          </div>
        )
      )}

      {/* ── Upcoming ── */}
      {filter === 'upcoming' && (
        isLoading ? (
          <TableSkeleton cols={4} rows={5} />
        ) : upcoming.length === 0 ? (
          <EmptyState
            icon={CalendarBlankIcon}
            title="No upcoming shifts"
            description="You have no upcoming shifts scheduled. Check Availability to pick one up."
          />
        ) : (
          <div className="space-y-3">
            {upcoming.map((s) => (
              <ShiftListCard key={s.id} shift={s} onDrop={() => { setDropTarget(s); setDropReason(''); }} />
            ))}
          </div>
        )
      )}

      {/* ── Past (last 7 days) ── */}
      {filter === 'past' && (
        isLoading ? (
          <TableSkeleton cols={4} rows={4} />
        ) : recentPast.length === 0 ? (
          <EmptyState
            icon={CalendarBlankIcon}
            title="Nothing in the last 7 days"
            description="Shifts you worked in the past week will show here."
          />
        ) : (
          <div>
            <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-fg-muted">Last 7 days</h3>
            <div className="space-y-3">
              {recentPast.map((s) => <ShiftListCard key={s.id} shift={s} />)}
            </div>
          </div>
        )
      )}

      <Modal open={!!dropTarget} onClose={() => setDropTarget(null)} title="Drop this shift?">
        <div className="space-y-4">
          {dropTarget && (
            <p className="text-sm text-fg-muted">
              Your shift at <span className="font-semibold text-fg">{shiftAttendanceTarget(dropTarget)?.name ?? 'this location'}</span> on{' '}
              {new Date(dropTarget.startTime).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
              {' '}({fmtTime(dropTarget.startTime)}–{fmtTime(dropTarget.endTime)}) will be released for cover, and your
              house manager and team leader will be notified.
            </p>
          )}
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-fg-muted">
              Reason (optional)
            </label>
            <textarea
              className="input-field resize-none"
              rows={3}
              value={dropReason}
              onChange={(e) => setDropReason(e.target.value)}
              placeholder="Let your manager know why (e.g. illness, emergency)…"
              maxLength={500}
            />
          </div>
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={() => setDropTarget(null)} className="btn-secondary flex-1 justify-center">
              Keep shift
            </button>
            <button
              type="button"
              onClick={confirmDrop}
              disabled={dropShift.isPending}
              className="btn-danger flex-1 justify-center"
            >
              {dropShift.isPending ? 'Dropping…' : 'Drop shift'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function ManageShiftsView() {
  const user = useAuthStore((s) => s.user);
  const { data: shifts = [], isLoading } = useShifts();
  const { data: houses = [] } = useHouses();
  // Options endpoint (not the full list) so a TEAM_LEADER — who can create
  // shifts but not GET /locations — can still populate this picker; it's
  // already active-only, matching "only active Locations should be selectable".
  const { data: locationOptions = [] } = useLocationOptions();
  // Fixed Staff Scheduling V1 correction: system access role (Role) and
  // employment pattern (workPatternType) are orthogonal, so the schedulable-
  // employee pool must not be defined by Role. GET /users with no `role`
  // filter returns every ACTIVE employee in the caller's agency regardless of
  // role (WORKER, TEAM_LEADER, MANAGER, HR alike) — status/agency scoping
  // happens server-side, so no DEACTIVATED or other-agency user can appear.
  // TEAM_LEADER's access to this unfiltered query was extended specifically
  // for this case (see listUsersGuard in backend/src/routes/users.js);
  // HR/MANAGER already had it. ROTA below filters this same roster back down
  // to WORKER to preserve today's care-scheduling behaviour unchanged.
  const { data: agencyRoster = [] } = useUsers();
  const createShift = useCreateShift();
  const updateShift = useUpdateShift();
  const deleteShift = useDeleteShift();
  const openShift = useOpenShift();
  const toast = useToast();

  const isStaff = user?.role === 'TEAM_LEADER';
  const isManagerLevel = ['HR', 'MANAGER'].includes(user?.role ?? '');
  const [view, setView] = useState<'shifts' | 'requests'>('shifts');
  const { data: pendingReq } = usePendingShiftChanges('PENDING_MANAGER', isManagerLevel);
  const pendingCount = pendingReq?.items?.length ?? 0;
  const { data: availableShifts = [], isLoading: availableLoading } = useAvailableShifts(isStaff);
  const claimShift = useClaimShift();
  const [claimId, setClaimId] = useState<string | null>(null);

  function handleClaim(shift: Shift) {
    setClaimId(shift.id);
    claimShift.mutate(shift.id, {
      onSuccess: () => {
        toast.success('Shift claimed — it now appears in your schedule');
        setClaimId(null);
      },
      onError: (err: any) => {
        toast.error(err.response?.data?.message ?? 'Failed to claim shift');
        setClaimId(null);
      },
    });
  }

  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const emptyForm = { kind: 'ROTA' as ShiftKind, houseId: '', locationId: '', workerId: '', date: '', startTime: '', endTime: '', shiftType: 'LONG_DAY' };
  const [form, setForm] = useState(emptyForm);
  const [err, setErr] = useState('');
  const [cancelId, setCancelId] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelError, setCancelError] = useState('');
  const [coverId, setCoverId] = useState<string | null>(null);
  const [coverRoles, setCoverRoles] = useState<Role[]>(['WORKER']);
  const [coverUrgent, setCoverUrgent] = useState(false);
  const [weeklyBlock, setWeeklyBlock] = useState<{ details: WeeklyHoursOverrideDetails; workerName?: string } | null>(null);

  const canCreate = ['HR', 'MANAGER', 'TEAM_LEADER'].includes(user?.role ?? '');
  const canCancel = ['HR', 'MANAGER'].includes(user?.role ?? '');
  const canRequestCover = ['HR', 'MANAGER', 'TEAM_LEADER'].includes(user?.role ?? '');
  const canOverrideWeeklyHours = ['HR', 'MANAGER'].includes(user?.role ?? '');

  // ROTA: WORKER-role only, matching today's care-scheduling behaviour exactly.
  // FIXED: the whole active agency roster (any system role), prioritising
  // employees whose own workPatternType is FIXED without hard-restricting the
  // picker — HR can still put an occasional FIXED shift on anyone listed.
  const sortedWorkers = useMemo(() => {
    if (form.kind !== 'FIXED') return agencyRoster.filter((u: User) => u.role === 'WORKER');
    return [...agencyRoster].sort((a: User, b: User) => {
      const aFixed = a.workPatternType === 'FIXED' ? 0 : 1;
      const bFixed = b.workPatternType === 'FIXED' ? 0 : 1;
      return aFixed - bFixed || a.name.localeCompare(b.name);
    });
  }, [agencyRoster, form.kind]);

  async function handleRequestCover() {
    if (!coverId) return;
    try {
      await openShift.mutateAsync({ id: coverId, eligibleRoles: coverRoles, urgent: coverUrgent });
      toast.success('Shift opened for cover');
      setCoverId(null);
    } catch (err: any) {
      toast.error(err.response?.data?.message ?? 'Failed to request cover');
    }
  }

  function buildPayload() {
    const startTime = new Date(`${form.date}T${form.startTime}`).toISOString();
    const endTime = new Date(`${form.date}T${form.endTime}`).toISOString();
    // Exactly one target, matching kind — never a fake houseId for FIXED, and
    // never both sent together.
    const target = form.kind === 'FIXED' ? { locationId: form.locationId } : { houseId: form.houseId };
    return {
      kind: form.kind,
      workerId: form.workerId || null,
      ...target,
      date: new Date(form.date).toISOString(),
      startTime,
      endTime,
      shiftType: form.shiftType,
    };
  }

  async function submitShift(extra?: Record<string, unknown>) {
    setErr('');
    const payload = { ...buildPayload(), ...extra };
    try {
      if (editingId) {
        await updateShift.mutateAsync({ id: editingId, ...payload });
        toast.success('Shift updated');
      } else {
        await createShift.mutateAsync(payload);
        toast.success('Shift created successfully');
      }
      setWeeklyBlock(null);
      closeCreate();
    } catch (e: any) {
      const code = e.response?.data?.code;
      if (code === 'APPROVAL_REQUIRED' || code === 'OVERRIDE_NOT_PERMITTED') {
        setWeeklyBlock({
          details: e.response?.data?.details ?? {},
          workerName: sortedWorkers?.find((w: User) => w.id === form.workerId)?.name,
        });
      } else if (code === 'SHIFT_ATTENDANCE_TARGET_LOCKED') {
        setErr('This work location can’t be changed because attendance has already been recorded for this shift.');
      } else {
        setErr(e.response?.data?.message ?? `Failed to ${editingId ? 'update' : 'create'} shift`);
      }
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    await submitShift();
  }

  function closeCreate() {
    setOpen(false);
    setEditingId(null);
    setErr('');
    setForm(emptyForm);
  }

  function openCopy(shift: Shift) {
    setErr('');
    setEditingId(null);
    setForm({
      kind: shift.kind ?? 'ROTA',
      houseId: shift.houseId ?? '',
      locationId: shift.locationId ?? '',
      workerId: shift.workerId ?? '',
      date: shift.date.slice(0, 10),
      startTime: new Date(shift.startTime).toISOString().slice(11, 16),
      endTime: new Date(shift.endTime).toISOString().slice(11, 16),
      shiftType: shift.shiftType,
    });
    setOpen(true);
  }

  function openEdit(shift: Shift) {
    setErr('');
    setEditingId(shift.id);
    setForm({
      kind: shift.kind ?? 'ROTA',
      houseId: shift.houseId ?? '',
      locationId: shift.locationId ?? '',
      workerId: shift.workerId ?? '',
      date: shift.date.slice(0, 10),
      startTime: new Date(shift.startTime).toISOString().slice(11, 16),
      endTime: new Date(shift.endTime).toISOString().slice(11, 16),
      shiftType: shift.shiftType,
    });
    setOpen(true);
  }

  function closeCancel() {
    setCancelId(null);
    setCancelReason('');
    setCancelError('');
  }

  function handleCancelShift(e: React.FormEvent) {
    e.preventDefault();
    if (!cancelId) return;
    if (!cancelReason.trim()) {
      setCancelError('Cancellation reason is required');
      return;
    }
    deleteShift.mutate({ id: cancelId, reason: cancelReason.trim() }, {
      onSuccess: () => { closeCancel(); toast.success('Shift cancelled'); },
      onError:   (error: any) => setCancelError(error.response?.data?.message ?? 'Failed to cancel shift'),
    });
  }

  return (
    <div>
      <Header
        title="Shifts"
        subtitle="Manage and schedule worker shifts across all houses"
        action={view === 'shifts' && canCreate && (
          <button onClick={() => setOpen(true)} className="btn-primary">
            <PlusIcon size={16} /> New Shift
          </button>
        )}
      />

      {isManagerLevel && (
        <div className="inline-flex rounded-lg border border-outline-variant bg-surface p-1 mb-6">
          {([['shifts', 'Shifts'], ['requests', 'Requests']] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setView(key)}
              className={clsx(
                'rounded-md px-4 py-1.5 text-sm font-semibold transition-colors',
                view === key ? 'bg-primary text-white' : 'text-on-surface-variant hover:text-on-surface',
              )}
            >
              {label}
              {key === 'requests' && pendingCount > 0 && (
                <span
                  className={clsx(
                    'ml-2 rounded-full px-1.5 py-0.5 text-[10px] font-bold',
                    view === key ? 'bg-white/25 text-white' : 'bg-primary/10 text-primary',
                  )}
                >
                  {pendingCount}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {isManagerLevel && view === 'requests' ? (
        <ShiftRequestsPanel />
      ) : (
      <>
      {isStaff && (availableLoading || availableShifts.length > 0) && (
        <div className="mb-6">
          <h2 className="text-sm font-semibold text-on-surface mb-3">Open Shifts — Available to Claim</h2>
          {availableLoading ? (
            <TableSkeleton cols={5} rows={2} />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {availableShifts.map((s) => (
                <div key={s.id} className="glass-card p-4 flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <p className="font-medium text-on-surface">{shiftAttendanceTarget(s)?.name ?? 'Unknown location'}</p>
                      <span className={clsx('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold', SHIFT_TYPE_META[s.shiftType]?.badgeClass)}>
                        {s.shiftType === 'SLEEP_IN' ? (
                          <MoonIcon size={10} weight="fill" />
                        ) : (
                          <span className={clsx('h-1.5 w-1.5 rounded-full', SHIFT_TYPE_META[s.shiftType]?.dot)} />
                        )}
                        {SHIFT_TYPE_META[s.shiftType]?.label ?? s.shiftType}
                      </span>
                      {s.urgent && (
                        <span className="inline-flex items-center gap-1 rounded-full border border-error-DEFAULT bg-error-container px-2 py-0.5 text-[10px] font-semibold text-error-DEFAULT">
                          <FireIcon size={10} weight="fill" /> Urgent
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-on-surface-variant font-inter">
                      {new Date(s.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                      {' · '}
                      {new Date(s.startTime).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                      {' – '}
                      {new Date(s.endTime).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                  <button
                    onClick={() => handleClaim(s)}
                    disabled={claimShift.isPending && claimId === s.id}
                    className="btn-primary flex-shrink-0"
                  >
                    <HandTapIcon size={15} />
                    {claimShift.isPending && claimId === s.id ? 'Claiming…' : 'Claim'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {isLoading ? (
        <TableSkeleton cols={7} rows={7} />
      ) : shifts.length === 0 ? (
        <EmptyState
          icon={CalendarBlankIcon}
          title="No shifts yet"
          description="Create a shift to get started."
          action={canCreate && <button onClick={() => setOpen(true)} className="btn-primary">New Shift</button>}
        />
      ) : (
        <div className="glass-card overflow-hidden">
          <table className="w-full">
            <thead>
              <tr>
                {['Worker', 'Location', 'Kind', 'Date', 'Time', 'Type', 'Status', ''].map((h) => (
                  <th key={h} className="table-th">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shifts.map((s) => {
                const status = shiftStatus(s);
                return (
                  <tr
                    key={s.id}
                    className={clsx(
                      'hover:bg-surface-lowest/60 transition-colors',
                      canCreate && !['CANCELLED', 'COMPLETED', 'IN_PROGRESS'].includes(s.status) && 'cursor-pointer'
                    )}
                    onDoubleClick={() => {
                      if (canCreate && !['CANCELLED', 'COMPLETED', 'IN_PROGRESS'].includes(s.status)) openEdit(s);
                    }}
                    title={canCreate && !['CANCELLED', 'COMPLETED', 'IN_PROGRESS'].includes(s.status) ? 'Double-click to edit' : undefined}
                  >
                    <td className="table-td font-medium">{s.worker?.name ?? 'Open shift'}</td>
                    <td className="table-td text-on-surface-variant">{shiftAttendanceTarget(s)?.name ?? 'Unknown'}</td>
                    <td className="table-td"><KindBadge kind={s.kind} /></td>
                    <td className="table-td font-inter text-xs">
                      {new Date(s.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </td>
                    <td className="table-td font-inter text-xs">
                      {new Date(s.startTime).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                      {' – '}
                      {new Date(s.endTime).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td className="table-td">
                      <span className={clsx('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold', SHIFT_TYPE_META[s.shiftType]?.badgeClass)}>
                        {s.shiftType === 'SLEEP_IN' ? (
                          <MoonIcon size={10} weight="fill" />
                        ) : (
                          <span className={clsx('h-1.5 w-1.5 rounded-full', SHIFT_TYPE_META[s.shiftType]?.dot)} />
                        )}
                        {SHIFT_TYPE_META[s.shiftType]?.label ?? s.shiftType}
                      </span>
                      {s.urgent && (
                        <span className="ml-1 inline-flex items-center gap-1 rounded-full border border-error-DEFAULT bg-error-container px-2 py-0.5 text-[10px] font-semibold text-error-DEFAULT">
                          <FireIcon size={10} weight="fill" /> Urgent
                        </span>
                      )}
                    </td>
                    <td className="table-td">
                      <Badge variant={status === 'cancelled' ? 'error' : status} label={status} />
                      {status === 'cancelled' && s.cancellationReason && (
                        <p className="mt-1 max-w-48 text-[11px] text-on-surface-variant">{s.cancellationReason}</p>
                      )}
                    </td>
                    <td className="table-td">
                      <div className="flex items-center gap-1">
                        {canCreate && (
                          <button
                            onClick={() => openCopy(s)}
                            className="p-1.5 rounded text-outline hover:text-primary hover:bg-primary/10 transition-colors"
                            aria-label="Copy shift"
                            title="Create a new shift pre-filled with the same worker, house, and type"
                          >
                            <CopyIcon size={15} />
                          </button>
                        )}
                        {canRequestCover && s.status === 'SCHEDULED' && s.workerId && s.kind === 'ROTA' && (
                          <button
                            onClick={() => {
                              setCoverId(s.id);
                              setCoverRoles(s.eligibleRoles?.length ? (s.eligibleRoles as Role[]) : ['WORKER']);
                              setCoverUrgent(s.urgent ?? false);
                            }}
                            className="p-1.5 rounded text-outline hover:text-warning-text hover:bg-warning-bg transition-colors"
                            aria-label="Request cover"
                            title="Mark this shift as needing cover"
                          >
                            <ArrowsClockwiseIcon size={15} />
                          </button>
                        )}
                        {canCancel && s.status === 'SCHEDULED' && (
                          <button
                            onClick={() => {
                              setCancelId(s.id);
                              setCancelReason('');
                              setCancelError('');
                            }}
                            className="p-1.5 rounded text-outline hover:text-error-DEFAULT hover:bg-error-container transition-colors"
                            aria-label="Cancel shift"
                          >
                            <TrashIcon size={15} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      </>
      )}

      <Modal open={open} onClose={closeCreate} title={editingId ? 'Edit Shift' : 'Create Shift'}>
        <form onSubmit={handleCreate} className="space-y-4">
          <LoadingOverlay show={createShift.isPending || updateShift.isPending} label={editingId ? 'Saving…' : 'Creating shift…'} />

          <div>
            <label className="block text-xs font-semibold tracking-wider uppercase text-on-surface-variant font-inter mb-1.5">Shift kind</label>
            <div className="flex rounded-md border border-outline-variant p-1">
              {(['ROTA', 'FIXED'] as ShiftKind[]).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, kind: k, houseId: k === 'ROTA' ? f.houseId : '', locationId: k === 'FIXED' ? f.locationId : '' }))}
                  className={clsx(
                    'flex-1 rounded px-3 py-1.5 text-xs font-semibold transition-colors',
                    form.kind === k ? 'bg-primary text-white' : 'text-on-surface-variant hover:text-on-surface'
                  )}
                >
                  {k === 'ROTA' ? 'Rota (House)' : 'Fixed (Location)'}
                </button>
              ))}
            </div>
          </div>

          {form.kind === 'ROTA' ? (
            <div>
              <label className="block text-xs font-semibold tracking-wider uppercase text-on-surface-variant font-inter mb-1.5">House</label>
              <select value={form.houseId} onChange={(e) => setForm({ ...form, houseId: e.target.value })} className="input-field" required>
                <option value="">Select house…</option>
                {houses.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
              </select>
            </div>
          ) : (
            <div>
              <label className="block text-xs font-semibold tracking-wider uppercase text-on-surface-variant font-inter mb-1.5">Location</label>
              <select value={form.locationId} onChange={(e) => setForm({ ...form, locationId: e.target.value })} className="input-field" required>
                <option value="">Select location…</option>
                {locationOptions.map((l) => (
                  <option key={l.id} value={l.id}>{l.name}{l.type ? ` (${l.type})` : ''}</option>
                ))}
              </select>
              {locationOptions.length === 0 && (
                <p className="mt-1.5 text-xs text-on-surface-variant">
                  No active locations yet — add one from Settings → Locations first.
                </p>
              )}
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold tracking-wider uppercase text-on-surface-variant font-inter mb-1.5">Worker</label>
            <select value={form.workerId} onChange={(e) => setForm({ ...form, workerId: e.target.value })} className="input-field" required>
              <option value="">Select worker…</option>
              {sortedWorkers.map((w: User) => (
                <option key={w.id} value={w.id}>
                  {w.name}{form.kind === 'FIXED' && w.workPatternType === 'FIXED' ? ' ★' : ''}
                </option>
              ))}
            </select>
            {form.kind === 'FIXED' && (
              <p className="mt-1.5 text-xs text-on-surface-variant">★ = this employee's usual work pattern is Fixed.</p>
            )}
          </div>
          <div>
            <label className="block text-xs font-semibold tracking-wider uppercase text-on-surface-variant font-inter mb-1.5">Date</label>
            <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className="input-field" required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold tracking-wider uppercase text-on-surface-variant font-inter mb-1.5">Start</label>
              <input type="time" value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} className="input-field" required />
            </div>
            <div>
              <label className="block text-xs font-semibold tracking-wider uppercase text-on-surface-variant font-inter mb-1.5">End</label>
              <input type="time" value={form.endTime} onChange={(e) => setForm({ ...form, endTime: e.target.value })} className="input-field" required />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold tracking-wider uppercase text-on-surface-variant font-inter mb-1.5">Shift Type</label>
            <select value={form.shiftType} onChange={(e) => setForm({ ...form, shiftType: e.target.value })} className="input-field">
              {SHIFT_TYPE_OPTIONS.map((type) => (
                <option key={type} value={type}>{SHIFT_TYPE_META[type].label}</option>
              ))}
            </select>
          </div>
          {err && <p className="text-sm text-error-DEFAULT bg-error-container rounded-md px-3 py-2">{err}</p>}
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={closeCreate} className="btn-secondary flex-1 justify-center">Cancel</button>
            <button type="submit" disabled={createShift.isPending || updateShift.isPending} className="btn-primary flex-1 justify-center">
              {editingId
                ? (updateShift.isPending ? 'Saving…' : 'Save Changes')
                : (createShift.isPending ? 'Creating…' : 'Create Shift')}
            </button>
          </div>
        </form>
      </Modal>

      <WeeklyHoursOverrideModal
        open={!!weeklyBlock}
        onClose={() => setWeeklyBlock(null)}
        workerName={weeklyBlock?.workerName}
        details={weeklyBlock?.details ?? null}
        canOverride={canOverrideWeeklyHours}
        isPending={createShift.isPending || updateShift.isPending}
        onConfirm={(reason) => submitShift({ overrideWeeklyLimit: true, overrideReason: reason })}
      />

      <Modal open={!!cancelId} onClose={closeCancel} title="Cancel Shift">
        <form onSubmit={handleCancelShift} className="space-y-4">
          <LoadingOverlay show={deleteShift.isPending} label="Cancelling…" />
          <div>
            <label className="block text-xs font-semibold tracking-wider uppercase text-on-surface-variant font-inter mb-1.5">
              Reason
            </label>
            <textarea
              className="input-field min-h-28 resize-none"
              value={cancelReason}
              onChange={(e) => {
                setCancelReason(e.target.value);
                setCancelError('');
              }}
              placeholder="Explain why this shift is being cancelled"
              maxLength={500}
              required
            />
          </div>
          {cancelError && <p className="text-sm text-error-DEFAULT bg-error-container rounded-md px-3 py-2">{cancelError}</p>}
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={closeCancel} className="btn-secondary flex-1 justify-center">Keep Shift</button>
            <button type="submit" disabled={deleteShift.isPending} className="btn-primary flex-1 justify-center">
              {deleteShift.isPending ? 'Cancelling...' : 'Cancel Shift'}
            </button>
          </div>
        </form>
      </Modal>

      <Modal open={!!coverId} onClose={() => setCoverId(null)} title="Request Cover">
        <div className="space-y-4">
          <LoadingOverlay show={openShift.isPending} label="Opening for cover…" />
          <p className="text-sm text-on-surface-variant">
            This unassigns the current worker and opens the shift so eligible staff can claim it.
          </p>
          <div>
            <label className="block text-xs font-semibold tracking-wider uppercase text-on-surface-variant font-inter mb-1.5">
              Who can claim this shift?
            </label>
            <div className="flex flex-wrap gap-2">
              {COVER_ROLE_GROUPS.map((group) => (
                <button
                  key={group.key}
                  type="button"
                  onClick={() => setCoverRoles((prev) => toggleGroupRoles(prev, group))}
                  className={`rounded-md border px-3 py-1.5 text-xs font-semibold transition-colors ${
                    isGroupSelected(group, coverRoles)
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-outline-variant text-on-surface-variant hover:border-primary/40'
                  }`}
                >
                  {group.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold tracking-wider uppercase text-on-surface-variant font-inter mb-1.5">
              Urgency
            </label>
            <button
              type="button"
              onClick={() => setCoverUrgent((v) => !v)}
              className={`flex w-full items-center justify-between rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
                coverUrgent
                  ? 'border-error-DEFAULT bg-error-container text-error-DEFAULT'
                  : 'border-outline-variant text-on-surface-variant hover:border-error-DEFAULT/40'
              }`}
            >
              <span>{coverUrgent ? 'Urgent — needs cover ASAP' : 'Not urgent'}</span>
              <span className={`h-2.5 w-2.5 rounded-full ${coverUrgent ? 'bg-error-DEFAULT' : 'bg-neutral-300'}`} />
            </button>
          </div>
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={() => setCoverId(null)} className="btn-secondary flex-1 justify-center">Cancel</button>
            <button
              type="button"
              onClick={handleRequestCover}
              disabled={openShift.isPending || coverRoles.length === 0}
              className="btn-primary flex-1 justify-center"
            >
              {openShift.isPending ? 'Opening…' : 'Open for Cover'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
