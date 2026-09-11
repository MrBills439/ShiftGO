'use client';
import { useEffect, useMemo, useState } from 'react';
import {
  CalendarCheckIcon, PencilSimpleIcon, StopCircleIcon, PlusIcon, MapPinIcon,
  ClockCounterClockwiseIcon, WarningCircleIcon, InfoIcon, CopyIcon,
} from '@phosphor-icons/react';
import { clsx } from 'clsx';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingOverlay } from '@/components/ui/LoadingOverlay';
import { FieldShell, Select as UiSelect, Input as UiInput } from '@/components/ui/Input';
import { WeeklyHoursOverrideModal, type WeeklyHoursOverrideDetails } from '@/components/staff/WeeklyHoursOverrideModal';
import { useToast } from '@/hooks/useToast';
import { useLocationOptions, WORK_PATTERN_LABELS } from '@/hooks/useOrgStructure';
import {
  useFixedWorkPatterns, useCreateFixedWorkPattern, useSupersedeFixedWorkPattern, useEndFixedWorkPattern,
  type FixedWorkPatternDayInput,
} from '@/hooks/useFixedWorkPatterns';
import type { User, FixedWorkPattern, FixedWorkPatternStatus } from '@/types';

// Recurring Fixed Work Patterns V1 — Phase 5: the HR-profile management UI.
// This component only ever calls the existing pattern CRUD
// (create / supersede / end) — it never creates a Shift itself. The
// recurring generator (backend, already scheduled) is solely responsible for
// turning an ACTIVE pattern into real Shift rows.

const WEEKDAYS: { value: number; label: string; short: string }[] = [
  { value: 1, label: 'Monday', short: 'Mon' },
  { value: 2, label: 'Tuesday', short: 'Tue' },
  { value: 3, label: 'Wednesday', short: 'Wed' },
  { value: 4, label: 'Thursday', short: 'Thu' },
  { value: 5, label: 'Friday', short: 'Fri' },
  { value: 6, label: 'Saturday', short: 'Sat' },
  { value: 7, label: 'Sunday', short: 'Sun' },
];
const WEEKDAY_SHORT: Record<number, string> = Object.fromEntries(WEEKDAYS.map((d) => [d.value, d.short]));

const STATUS_VARIANT: Record<FixedWorkPatternStatus, 'success' | 'neutral' | 'info'> = {
  ACTIVE: 'success', ENDED: 'neutral', SUPERSEDED: 'info',
};

const fmtDate = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
const toDateInput = (iso?: string | null) => (iso ? iso.slice(0, 10) : '');
const addDay = (iso: string, days: number) => {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

function timeToMinutes(t: string) {
  const [h, m] = t.split(':').map(Number);
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}
function dayHours(startTime: string, endTime: string) {
  const mins = timeToMinutes(endTime) - timeToMinutes(startTime);
  return mins > 0 ? mins / 60 : 0;
}
function scheduleSummary(days: FixedWorkPattern['days']) {
  if (days.length === 0) return '—';
  const sorted = [...days].sort((a, b) => a.weekday - b.weekday);
  // Common case: every configured day shares the same hours — collapse to
  // "Monday–Friday · 09:00–17:00" instead of a five-line list.
  const uniformTimes = sorted.every((d) => d.startTime === sorted[0].startTime && d.endTime === sorted[0].endTime);
  const weekdayLabel = (() => {
    const values = sorted.map((d) => d.weekday);
    const isConsecutiveRun = values.every((v, i) => i === 0 || v === values[i - 1] + 1);
    if (isConsecutiveRun && values.length > 1) return `${WEEKDAY_SHORT[values[0]]}–${WEEKDAY_SHORT[values[values.length - 1]]}`;
    return values.map((v) => WEEKDAY_SHORT[v]).join(', ');
  })();
  return uniformTimes
    ? `${weekdayLabel} · ${sorted[0].startTime}–${sorted[0].endTime}`
    : `${sorted.length} day${sorted.length === 1 ? '' : 's'} configured`;
}

// ─────────────────────────── Main tab ───────────────────────────
export function EmployeeWorkPatternTab({ employee, canManage }: { employee: User; canManage: boolean }) {
  const isFixed = employee.workPatternType === 'FIXED';
  const { data: patterns = [], isLoading, isError } = useFixedWorkPatterns({ workerId: employee.id }, isFixed);

  const [formOpen, setFormOpen] = useState<{ mode: 'create' | 'supersede' } | null>(null);
  const [endOpen, setEndOpen] = useState(false);

  const activePattern = useMemo(() => patterns.find((p) => p.status === 'ACTIVE'), [patterns]);
  const history = useMemo(() => patterns.filter((p) => p.id !== activePattern?.id), [patterns, activePattern]);

  if (!isFixed) {
    return (
      <Card className="p-5">
        <div className="flex items-start gap-3">
          <InfoIcon size={20} className="mt-0.5 shrink-0 text-fg-muted" />
          <div>
            <p className="text-sm font-semibold text-fg">
              This employee&rsquo;s work pattern is{' '}
              <span className="text-brand-700">{WORK_PATTERN_LABELS[employee.workPatternType ?? 'ROTA']}</span>.
            </p>
            <p className="mt-1 max-w-prose text-sm text-fg-muted">
              Recurring fixed work patterns only apply to employees whose work pattern is set to{' '}
              <strong>Fixed</strong>. Change this employee&rsquo;s work pattern from the Employment tab first if they
              should have a recurring office schedule instead.
            </p>
          </div>
        </div>
      </Card>
    );
  }

  if (isLoading) {
    return <Card className="p-6"><p className="text-sm text-fg-muted">Loading work pattern…</p></Card>;
  }
  if (isError) {
    return (
      <Card className="p-6">
        <p className="text-sm font-semibold text-danger">Could not load this employee&rsquo;s work pattern.</p>
        <p className="mt-1 text-sm text-fg-muted">Please try again, or contact support if the issue persists.</p>
      </Card>
    );
  }

  const deactivated = employee.status === 'DEACTIVATED';

  return (
    <div className="space-y-4">
      {!activePattern ? (
        <Card>
          <EmptyState
            icon={CalendarCheckIcon}
            title="No recurring work pattern has been set for this employee."
            description={deactivated ? 'This employee is deactivated — reactivate them first to create a pattern.' : undefined}
            action={
              canManage && !deactivated ? (
                <Button variant="primary" icon={<PlusIcon size={15} />} onClick={() => setFormOpen({ mode: 'create' })}>
                  Create work pattern
                </Button>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <>
          <PatternSummaryCard pattern={activePattern} employee={employee} />
          <PatternScheduleCard pattern={activePattern} />
          {canManage && (
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="secondary" icon={<PencilSimpleIcon size={14} />} onClick={() => setFormOpen({ mode: 'supersede' })}>
                Edit work pattern
              </Button>
              <Button variant="danger" icon={<StopCircleIcon size={14} />} onClick={() => setEndOpen(true)}>
                End work pattern
              </Button>
            </div>
          )}
        </>
      )}

      {history.length > 0 && <PatternHistoryList patterns={history} />}

      {formOpen && (
        <PatternFormModal
          mode={formOpen.mode}
          employee={employee}
          activePattern={activePattern ?? null}
          onClose={() => setFormOpen(null)}
        />
      )}
      {activePattern && endOpen && (
        <EndPatternModal pattern={activePattern} onClose={() => setEndOpen(false)} />
      )}
    </div>
  );
}

// ─────────────────────────── Summary ───────────────────────────
function PatternSummaryCard({ pattern, employee }: { pattern: FixedWorkPattern; employee: User }) {
  const weeklyHours = pattern.days.reduce((sum, d) => sum + dayHours(d.startTime, d.endTime), 0);
  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center gap-2">
        <CalendarCheckIcon size={18} className="text-brand-600" />
        <h3 className="text-sm font-semibold text-fg">Work pattern</h3>
      </div>
      <div className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
        <SummaryItem label="Work pattern" value={WORK_PATTERN_LABELS[employee.workPatternType ?? 'FIXED']} />
        <SummaryItem label="Primary location" value={pattern.location.name} icon={<MapPinIcon size={13} />} />
        <SummaryItem label="Current recurring schedule" value={scheduleSummary(pattern.days)} />
        <SummaryItem label="Effective from" value={fmtDate(pattern.effectiveFrom)} />
        <SummaryItem label="Weekly scheduled hours" value={`${weeklyHours % 1 === 0 ? weeklyHours : weeklyHours.toFixed(1)} hours`} />
        <SummaryItem label="Status" value={<Badge variant={STATUS_VARIANT[pattern.status]} label={pattern.status} dot={false} />} />
      </div>
      {pattern.overrideWeeklyLimit && (
        <div className="mt-4 rounded-lg border border-warning-border bg-warning-bg/50 p-3 text-xs text-warning-text">
          <span className="font-semibold">Weekly-hours limit override approved.</span>{' '}
          {pattern.overrideReason}
          {pattern.overrideBy?.name && <span className="text-fg-muted"> — {pattern.overrideBy.name}</span>}
        </div>
      )}
    </Card>
  );
}

function SummaryItem({ label, value, icon }: { label: string; value: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-semibold text-fg-muted">{label}</p>
      <p className="mt-0.5 flex items-center gap-1.5 text-sm font-medium text-fg">{icon}{value}</p>
    </div>
  );
}

// ─────────────────────────── Full schedule ───────────────────────────
function PatternScheduleCard({ pattern }: { pattern: FixedWorkPattern }) {
  const byWeekday = new Map(pattern.days.map((d) => [d.weekday, d]));
  return (
    <Card className="p-5">
      <h3 className="mb-3 text-sm font-semibold text-fg">Weekly schedule</h3>
      <div className="divide-y divide-border/60">
        {WEEKDAYS.map((wd) => {
          const day = byWeekday.get(wd.value);
          return (
            <div key={wd.value} className="flex items-center justify-between gap-4 py-2 text-sm">
              <span className="font-medium text-fg">{wd.label}</span>
              {day ? (
                <span className="font-inter tabular-nums text-fg">{day.startTime} – {day.endTime}</span>
              ) : (
                <span className="text-fg-subtle">Off</span>
              )}
            </div>
          );
        })}
      </div>
      <div className="mt-4 grid grid-cols-1 gap-x-6 gap-y-2 border-t border-border pt-3 text-sm sm:grid-cols-2">
        <DRow label="Location" value={pattern.location.name} />
        <DRow label="Timezone" value={pattern.timezone ?? `Inherited (${pattern.location.timezone ?? 'agency default'})`} />
        <DRow label="Effective from" value={fmtDate(pattern.effectiveFrom)} />
        <DRow label="Effective to" value={pattern.effectiveTo ? fmtDate(pattern.effectiveTo) : 'Ongoing'} />
      </div>
    </Card>
  );
}
function DRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-fg-muted">{label}</span>
      <span className="text-right font-medium text-fg">{value}</span>
    </div>
  );
}

// ─────────────────────────── History ───────────────────────────
function PatternHistoryList({ patterns }: { patterns: FixedWorkPattern[] }) {
  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center gap-2">
        <ClockCounterClockwiseIcon size={17} className="text-fg-muted" />
        <h3 className="text-sm font-semibold text-fg">History</h3>
      </div>
      <div className="space-y-2">
        {patterns.map((p) => (
          <div key={p.id} className="rounded-lg border border-border bg-surface-subtle/50 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold text-fg">
                {fmtDate(p.effectiveFrom)} – {p.effectiveTo ? fmtDate(p.effectiveTo) : 'ongoing'}
              </p>
              <Badge variant={STATUS_VARIANT[p.status]} label={p.status} dot={false} />
            </div>
            <p className="mt-1 text-xs text-fg-muted">{p.location.name} · {scheduleSummary(p.days)}</p>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ─────────────────────────── Create / Edit (supersede) form ───────────────────────────
type DayFormState = { enabled: boolean; startTime: string; endTime: string };
const DEFAULT_DAY: DayFormState = { enabled: false, startTime: '09:00', endTime: '17:00' };

function buildDefaultForm(pattern: FixedWorkPattern | null): Record<number, DayFormState> {
  const form: Record<number, DayFormState> = {};
  for (const wd of WEEKDAYS) form[wd.value] = { ...DEFAULT_DAY, enabled: !pattern && wd.value <= 5 };
  if (pattern) {
    for (const d of pattern.days) form[d.weekday] = { enabled: true, startTime: d.startTime, endTime: d.endTime };
  }
  return form;
}

function PatternFormModal({
  mode, employee, activePattern, onClose,
}: {
  mode: 'create' | 'supersede';
  employee: User;
  activePattern: FixedWorkPattern | null;
  onClose: () => void;
}) {
  const toast = useToast();
  const { data: locationOptions = [] } = useLocationOptions();
  const create = useCreateFixedWorkPattern();
  const supersede = useSupersedeFixedWorkPattern();
  const isPending = create.isPending || supersede.isPending;

  const [locationId, setLocationId] = useState(activePattern?.locationId ?? '');
  const [effectiveFrom, setEffectiveFrom] = useState(() => {
    if (mode !== 'supersede' || !activePattern) return '';
    // Sensible default: today, if that's actually after the current version
    // started (the only backend requirement) — falls back to the day after
    // it started for the rare case of editing a pattern that hasn't taken
    // effect yet.
    const today = toDateInput(new Date().toISOString());
    const minAllowed = addDay(activePattern.effectiveFrom, 1);
    return today > toDateInput(activePattern.effectiveFrom) ? today : minAllowed;
  });
  const [effectiveTo, setEffectiveTo] = useState(toDateInput(activePattern?.effectiveTo));
  const [days, setDays] = useState<Record<number, DayFormState>>(() => buildDefaultForm(mode === 'supersede' ? activePattern : null));
  const [formError, setFormError] = useState('');
  const [weeklyBlock, setWeeklyBlock] = useState<{ details: WeeklyHoursOverrideDetails } | null>(null);

  const enabledDays = WEEKDAYS.filter((wd) => days[wd.value]?.enabled);
  const dayErrors = new Map<number, string>();
  for (const wd of enabledDays) {
    const d = days[wd.value];
    if (!d.startTime || !d.endTime) dayErrors.set(wd.value, 'Start and end time are required');
    else if (timeToMinutes(d.endTime) <= timeToMinutes(d.startTime)) dayErrors.set(wd.value, 'End time must be after start time');
  }
  const weeklyHours = enabledDays.reduce((sum, wd) => {
    const d = days[wd.value];
    return dayErrors.has(wd.value) ? sum : sum + dayHours(d.startTime, d.endTime);
  }, 0);

  const canSubmit = !!locationId && !!effectiveFrom && enabledDays.length > 0 && dayErrors.size === 0;

  function toggleDay(weekday: number) {
    setDays((prev) => ({ ...prev, [weekday]: { ...prev[weekday], enabled: !prev[weekday].enabled } }));
  }
  function updateDay(weekday: number, patch: Partial<DayFormState>) {
    setDays((prev) => ({ ...prev, [weekday]: { ...prev[weekday], ...patch } }));
  }
  function applyMondayToWeekdays() {
    const monday = days[1];
    if (!monday.startTime || !monday.endTime) return;
    setDays((prev) => {
      const next = { ...prev };
      for (const wd of [2, 3, 4, 5]) next[wd] = { enabled: true, startTime: monday.startTime, endTime: monday.endTime };
      return next;
    });
  }

  function buildDaysPayload(): FixedWorkPatternDayInput[] {
    return enabledDays.map((wd) => ({ weekday: wd.value, startTime: days[wd.value].startTime, endTime: days[wd.value].endTime }));
  }

  async function submit(overrideOpts?: { overrideWeeklyLimit: true; overrideReason: string }) {
    setFormError('');
    const base = {
      locationId,
      effectiveFrom,
      effectiveTo: effectiveTo || null,
      days: buildDaysPayload(),
      ...overrideOpts,
    };
    try {
      if (mode === 'create') {
        await create.mutateAsync({ workerId: employee.id, ...base });
      } else if (activePattern) {
        await supersede.mutateAsync({ id: activePattern.id, ...base });
      }
      toast.success(mode === 'create' ? 'Work pattern created' : 'Work pattern updated — a new version is now active');
      setWeeklyBlock(null);
      onClose();
    } catch (err: any) {
      const code = err?.response?.data?.code;
      const details = err?.response?.data?.details;
      if (code === 'APPROVAL_REQUIRED' || code === 'OVERRIDE_NOT_PERMITTED') {
        setWeeklyBlock({ details: { projectedHours: details?.weeklyHours, maxWeeklyScheduledHours: details?.maxWeeklyScheduledHours } });
      } else {
        setFormError(err?.response?.data?.message ?? 'Could not save this work pattern');
      }
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={mode === 'create' ? `Create work pattern — ${employee.name}` : `Edit work pattern — ${employee.name}`}
      width="max-w-2xl"
    >
      <form onSubmit={(e) => { e.preventDefault(); if (canSubmit) submit(); }} className="space-y-5">
        <LoadingOverlay show={isPending} label="Saving…" />

        {mode === 'supersede' && (
          <div className="rounded-lg border border-info-border bg-info-bg/50 p-3 text-xs text-info-text">
            Saving creates a <strong>new version</strong> of this pattern, effective from the date below. The current
            version stays exactly as it was and is marked Superseded — nothing already generated changes.
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FieldShell label="Employee">
            <UiInput type="text" value={employee.name} disabled readOnly />
          </FieldShell>
          <FieldShell label="Location *">
            <UiSelect value={locationId} onChange={(e) => setLocationId(e.target.value)} required>
              <option value="">Select a location…</option>
              {locationOptions.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </UiSelect>
          </FieldShell>
          <FieldShell
            label="Effective from *"
            hint={mode === 'supersede' && activePattern ? `Must be after ${fmtDate(activePattern.effectiveFrom)}` : undefined}
          >
            <UiInput
              type="date"
              value={effectiveFrom}
              min={mode === 'supersede' && activePattern ? addDay(activePattern.effectiveFrom, 1) : undefined}
              onChange={(e) => setEffectiveFrom(e.target.value)}
              required
            />
          </FieldShell>
          <FieldShell label="Effective to" hint="Optional — leave blank for an ongoing pattern.">
            <UiInput type="date" value={effectiveTo} min={effectiveFrom || undefined} onChange={(e) => setEffectiveTo(e.target.value)} />
          </FieldShell>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-semibold text-fg-muted">Weekly schedule *</p>
            <Button type="button" variant="ghost" size="sm" icon={<CopyIcon size={13} />} onClick={applyMondayToWeekdays}>
              Copy Monday to weekdays
            </Button>
          </div>
          <div className="space-y-1.5">
            {WEEKDAYS.map((wd) => {
              const d = days[wd.value];
              const error = dayErrors.get(wd.value);
              return (
                <div key={wd.value} className={clsx('rounded-md border p-2', error ? 'border-danger-border bg-danger-bg/30' : 'border-border')}>
                  <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
                    <label className="flex w-28 shrink-0 items-center gap-2 text-sm font-medium text-fg">
                      <input type="checkbox" checked={d.enabled} onChange={() => toggleDay(wd.value)} />
                      {wd.label}
                    </label>
                    {d.enabled ? (
                      <div className="flex flex-1 flex-wrap items-center gap-2">
                        <UiInput
                          type="time"
                          value={d.startTime}
                          onChange={(e) => updateDay(wd.value, { startTime: e.target.value })}
                          className="w-auto min-w-[7rem]"
                        />
                        <span className="text-xs text-fg-muted">to</span>
                        <UiInput
                          type="time"
                          value={d.endTime}
                          onChange={(e) => updateDay(wd.value, { endTime: e.target.value })}
                          className="w-auto min-w-[7rem]"
                        />
                      </div>
                    ) : (
                      <span className="text-sm text-fg-subtle">Off</span>
                    )}
                  </div>
                  {error && <p className="mt-1 pl-[7.5rem] text-xs text-danger-text">{error}</p>}
                </div>
              );
            })}
          </div>
          {enabledDays.length === 0 && <p className="mt-2 text-xs text-danger-text">At least one working day is required.</p>}
        </div>

        <div className="flex items-center justify-between rounded-lg border border-border bg-surface-subtle p-3">
          <span className="text-sm font-semibold text-fg">Weekly hours</span>
          <span className="font-inter text-lg font-semibold tabular-nums text-fg">
            {weeklyHours % 1 === 0 ? weeklyHours : weeklyHours.toFixed(1)}h
          </span>
        </div>

        {formError && (
          <p className="flex items-center gap-1.5 text-sm text-danger"><WarningCircleIcon size={14} />{formError}</p>
        )}

        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={!canSubmit || isPending}>
            {isPending ? 'Saving…' : mode === 'create' ? 'Create work pattern' : 'Save new version'}
          </Button>
        </div>
      </form>

      <WeeklyHoursOverrideModal
        open={!!weeklyBlock}
        onClose={() => setWeeklyBlock(null)}
        workerName={employee.name}
        details={weeklyBlock?.details ?? null}
        canOverride
        isPending={isPending}
        onConfirm={(reason) => submit({ overrideWeeklyLimit: true, overrideReason: reason })}
      />
    </Modal>
  );
}

// ─────────────────────────── End pattern ───────────────────────────
function EndPatternModal({ pattern, onClose }: { pattern: FixedWorkPattern; onClose: () => void }) {
  const toast = useToast();
  const end = useEndFixedWorkPattern();
  const [effectiveTo, setEffectiveTo] = useState('');
  const [err, setErr] = useState('');

  useEffect(() => { setEffectiveTo(''); setErr(''); }, [pattern.id]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!effectiveTo) { setErr('An effective end date is required.'); return; }
    setErr('');
    try {
      await end.mutateAsync({ id: pattern.id, effectiveTo });
      toast.success('Work pattern ended');
      onClose();
    } catch (e: any) {
      setErr(e?.response?.data?.message ?? 'Could not end this work pattern');
    }
  }

  return (
    <Modal open onClose={onClose} title="End work pattern">
      <form onSubmit={submit} className="space-y-4">
        <LoadingOverlay show={end.isPending} label="Ending…" />
        <div className="rounded-lg border border-warning-border bg-warning-bg/50 p-3 text-sm text-warning-text">
          This will stop future automatic shift generation after the selected date. Existing generated shifts will not
          automatically be deleted.
        </div>
        <FieldShell label="Effective end date *">
          <UiInput
            type="date"
            value={effectiveTo}
            min={toDateInput(pattern.effectiveFrom)}
            onChange={(e) => { setEffectiveTo(e.target.value); setErr(''); }}
            required
          />
        </FieldShell>
        {err && <p className="text-sm text-danger">{err}</p>}
        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="danger" disabled={end.isPending}>
            {end.isPending ? 'Ending…' : 'End work pattern'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
