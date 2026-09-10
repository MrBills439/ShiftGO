'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeftIcon, PencilSimpleIcon, UserMinusIcon, WarningCircleIcon, UsersThreeIcon,
} from '@phosphor-icons/react';
import { clsx } from 'clsx';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingOverlay } from '@/components/ui/LoadingOverlay';
import { FieldShell, Select as UiSelect, Input as UiInput, Textarea as UiTextarea } from '@/components/ui/Input';
import { API_BASE } from '@/lib/api';
import { useUser, useUsers, useUpdateUser, useDeactivateUser } from '@/hooks/useWorkers';
import { useDepartmentOptions, useJobTitleOptions, useLocationOptions, WORK_PATTERN_LABELS, EMPLOYMENT_TYPE_LABELS } from '@/hooks/useOrgStructure';
import { useAuthStore } from '@/store/authStore';
import { useToast } from '@/hooks/useToast';
import { ROLE_META, initials } from '@/lib/roles';
import { EmployeeComplianceTab } from '@/components/staff/EmployeeComplianceTab';
import { EmployeeTrainingTab } from '@/components/staff/EmployeeTrainingTab';
import type { Role, User, WorkPatternType, EmploymentType } from '@/types';

const ACCESS_LABELS: Record<Role, string> = { WORKER: 'Employee', TEAM_LEADER: 'Team Leader', MANAGER: 'Manager', HR: 'HR' };
const ROLE_VARIANT: Record<Role, 'hr' | 'manager' | 'team_leader' | 'worker'> = {
  HR: 'hr', MANAGER: 'manager', TEAM_LEADER: 'team_leader', WORKER: 'worker',
};
const WORK_PATTERN_OPTIONS: WorkPatternType[] = ['ROTA', 'FIXED', 'FLEXIBLE'];
const EMPLOYMENT_TYPE_OPTIONS: EmploymentType[] = ['PERMANENT', 'BANK', 'CONTRACTOR'];
const TABS = ['overview', 'employment', 'personal', 'compliance', 'training'] as const;
type Tab = (typeof TABS)[number];

const fmtDate = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
const toDateInput = (iso?: string | null) => (iso ? iso.slice(0, 10) : '');
const nn = (v: string) => (v.trim() === '' ? null : v.trim());

function DL({ children }: { children: React.ReactNode }) {
  return <div className="divide-y divide-border/60">{children}</div>;
}
function DRow({ label, value }: { label: string; value?: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-2 text-sm">
      <span className="shrink-0 text-fg-muted">{label}</span>
      <span className="text-right font-medium text-fg">{value ?? '—'}</span>
    </div>
  );
}

export default function EmployeeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const me = useAuthStore((s) => s.user);
  const toast = useToast();

  const canManage = ['HR', 'MANAGER'].includes(me?.role ?? '');
  const isHr = me?.role === 'HR';

  useEffect(() => {
    if (me && !canManage) router.replace('/dashboard/workers');
  }, [me, canManage, router]);

  const { data: employee, isLoading, isError } = useUser(id, canManage);
  const [tab, setTab] = useState<Tab>('overview');
  const [deactivateOpen, setDeactivateOpen] = useState(false);

  if (me && !canManage) return null;

  if (isLoading) {
    return (
      <div className="space-y-4">
        <BackLink />
        <Card className="p-6"><p className="text-sm text-fg-muted">Loading employee…</p></Card>
      </div>
    );
  }

  // A bad id and a cross-agency id both 404 — identical response, no existence leak.
  if (isError || !employee) {
    return (
      <div className="space-y-4">
        <BackLink />
        <EmptyState
          icon={WarningCircleIcon}
          title="Employee not found"
          description="This employee doesn’t exist, or isn’t part of your agency."
          action={<Link href="/dashboard/workers" className="btn-primary">Back to Staff</Link>}
        />
      </div>
    );
  }

  const deactivated = employee.status === 'DEACTIVATED';

  return (
    <div className="space-y-6">
      <BackLink />

      {/* ── Header card ── */}
      <Card className="p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-center gap-4">
            {employee.profilePicture ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`${API_BASE}${employee.profilePicture}`} alt="" className="h-14 w-14 rounded-full object-cover bg-surface-muted" />
            ) : (
              <div className={clsx('flex h-14 w-14 items-center justify-center rounded-full text-base font-semibold', ROLE_META[employee.role].avatarClass)}>
                {initials(employee.name)}
              </div>
            )}
            <div className="min-w-0">
              <h1 className="truncate text-xl font-semibold text-fg">{employee.name}</h1>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-fg-muted">
                {employee.employeeNumber && <span className="tabular-nums">{employee.employeeNumber}</span>}
                {employee.jobTitle?.name && <span>· {employee.jobTitle.name}</span>}
                {employee.department?.name && <span>· {employee.department.name}</span>}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Badge variant={deactivated ? 'danger' : 'success'} label={deactivated ? 'Deactivated' : 'Active'} />
                <Badge variant={ROLE_VARIANT[employee.role]} label={ACCESS_LABELS[employee.role]} dot={false} />
              </div>
            </div>
          </div>

          {canManage && (
            <div className="flex items-center gap-2">
              <Button variant="secondary" size="sm" icon={<PencilSimpleIcon size={14} />} onClick={() => setTab('employment')}>
                Edit Employee
              </Button>
              {!deactivated && (
                <Button variant="danger" size="sm" icon={<UserMinusIcon size={14} />} onClick={() => setDeactivateOpen(true)}>
                  Deactivate
                </Button>
              )}
            </div>
          )}
        </div>

        {deactivated && (
          <div className="mt-4 rounded-lg border border-danger-border bg-danger-bg/50 p-3 text-sm text-danger-text">
            Deactivated {fmtDate(employee.deactivatedAt)}
            {employee.deactivatedBy?.name ? ` by ${employee.deactivatedBy.name}` : ''}
            {employee.deactivationReason ? ` — ${employee.deactivationReason}` : ''}
          </div>
        )}
      </Card>

      {/* ── Tabs ── */}
      <div className="-mx-1 flex gap-1 overflow-x-auto px-1">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={clsx(
              'shrink-0 rounded-md px-3.5 py-1.5 text-sm font-semibold capitalize transition-colors',
              tab === t ? 'bg-brand-600 text-white' : 'text-fg-muted hover:bg-surface-subtle hover:text-fg',
            )}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'overview' && <OverviewPanel employee={employee} />}
      {tab === 'employment' && <EmploymentPanel employee={employee} />}
      {tab === 'personal' && <PersonalPanel employee={employee} />}
      {tab === 'compliance' && <EmployeeComplianceTab userId={employee.id} isHr={isHr} />}
      {tab === 'training' && <EmployeeTrainingTab userId={employee.id} canManage={canManage} />}

      <DeactivateModal
        open={deactivateOpen}
        employee={employee}
        onClose={() => setDeactivateOpen(false)}
        onDone={() => { setDeactivateOpen(false); }}
      />
    </div>
  );
}

function BackLink() {
  return (
    <Link href="/dashboard/workers" className="inline-flex items-center gap-1.5 text-sm font-medium text-fg-muted hover:text-fg">
      <ArrowLeftIcon size={15} /> Staff
    </Link>
  );
}

// ─────────────────────────── Overview ───────────────────────────
function OverviewPanel({ employee }: { employee: User }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="p-5">
        <h3 className="mb-2 text-sm font-semibold text-fg">Employment</h3>
        <DL>
          <DRow label="Employee ID" value={employee.employeeNumber} />
          <DRow label="Job title" value={employee.jobTitle?.name} />
          <DRow label="Department" value={employee.department?.name} />
          <DRow label="Employment type" value={employee.employmentType ? EMPLOYMENT_TYPE_LABELS[employee.employmentType] : '—'} />
          <DRow label="Work pattern" value={WORK_PATTERN_LABELS[employee.workPatternType ?? 'ROTA']} />
          <DRow label="Contracted hours" value={employee.contractedHours != null ? `${employee.contractedHours} / week` : '—'} />
          <DRow label="Primary location" value={employee.primaryLocation?.name} />
          <DRow label="Line manager" value={employee.lineManager?.name} />
          <DRow label="Start date" value={fmtDate(employee.employmentStartDate)} />
          <DRow label="Status" value={employee.status === 'DEACTIVATED' ? 'Deactivated' : 'Active'} />
        </DL>
      </Card>
      <Card className="p-5">
        <h3 className="mb-2 text-sm font-semibold text-fg">Contact &amp; access</h3>
        <DL>
          <DRow label="Email" value={employee.email} />
          <DRow label="Phone" value={employee.phone} />
          <DRow label="System access" value={<span className="text-fg-muted">{ACCESS_LABELS[employee.role]} · managed separately</span>} />
        </DL>
      </Card>
    </div>
  );
}

// ─────────────────────────── Employment (editable) ───────────────────────────
function EmploymentPanel({ employee }: { employee: User }) {
  const toast = useToast();
  const update = useUpdateUser();
  const { data: deptOptions = [] } = useDepartmentOptions(true);
  const { data: jobTitleOptions = [] } = useJobTitleOptions(true);
  const { data: locationOptions = [] } = useLocationOptions(true);
  const { data: roster = [] } = useUsers(undefined, 'ACTIVE');

  const [f, setF] = useState({
    departmentId: employee.departmentId ?? '',
    jobTitleId: employee.jobTitleId ?? '',
    employmentType: (employee.employmentType ?? '') as '' | EmploymentType,
    employmentStartDate: toDateInput(employee.employmentStartDate),
    contractedHours: employee.contractedHours != null ? String(employee.contractedHours) : '',
    workPatternType: employee.workPatternType ?? 'ROTA',
    primaryLocationId: employee.primaryLocationId ?? '',
    lineManagerId: employee.lineManagerId ?? '',
  });

  const jobTitlesForDept = (deptId: string) => (deptId ? jobTitleOptions.filter((j) => j.departmentId === deptId) : []);
  const jobTitleFitsDept = (jtId: string, deptId: string) => {
    if (!jtId) return true;
    const jt = jobTitleOptions.find((j) => j.id === jtId);
    if (!jt) return true;
    return jt.departmentId == null || jt.departmentId === deptId;
  };
  // Keep the current title visible even if it's legacy / from another department.
  const jobTitleChoices = useMemo(() => {
    const base = f.departmentId ? jobTitleOptions.filter((j) => j.departmentId === f.departmentId) : [];
    if (!f.jobTitleId || base.some((j) => j.id === f.jobTitleId)) return base;
    const known = jobTitleOptions.find((j) => j.id === f.jobTitleId);
    return [{ id: f.jobTitleId, name: `${known?.name ?? employee.jobTitle?.name ?? 'Current title'} (current)`, departmentId: known?.departmentId ?? null }, ...base];
  }, [jobTitleOptions, f.departmentId, f.jobTitleId, employee.jobTitle]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    try {
      await update.mutateAsync({
        id: employee.id,
        departmentId: nn(f.departmentId),
        jobTitleId: nn(f.jobTitleId),
        employmentType: (f.employmentType || null) as EmploymentType | null,
        employmentStartDate: f.employmentStartDate || null,
        contractedHours: f.contractedHours === '' ? null : parseFloat(f.contractedHours),
        workPatternType: f.workPatternType,
        primaryLocationId: nn(f.primaryLocationId),
        lineManagerId: nn(f.lineManagerId),
      });
      toast.success('Employment details updated');
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? 'Could not update employment details');
    }
  }

  return (
    <Card className="p-5">
      <form onSubmit={save} className="space-y-4">
        <LoadingOverlay show={update.isPending} label="Saving…" />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FieldShell label="Employee ID" hint="Assigned automatically — not editable here.">
            <UiInput type="text" value={employee.employeeNumber ?? 'Not set'} disabled readOnly />
          </FieldShell>
          <FieldShell label="Employment type">
            <UiSelect value={f.employmentType} onChange={(e) => setF({ ...f, employmentType: e.target.value as '' | EmploymentType })}>
              <option value="">—</option>
              {EMPLOYMENT_TYPE_OPTIONS.map((t) => <option key={t} value={t}>{EMPLOYMENT_TYPE_LABELS[t]}</option>)}
            </UiSelect>
          </FieldShell>
          <FieldShell label="Department">
            <UiSelect
              value={f.departmentId}
              onChange={(e) => {
                const departmentId = e.target.value;
                setF({ ...f, departmentId, jobTitleId: jobTitleFitsDept(f.jobTitleId, departmentId) ? f.jobTitleId : '' });
              }}
            >
              <option value="">—</option>
              {deptOptions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </UiSelect>
          </FieldShell>
          <FieldShell label="Job title" hint={!f.departmentId && !f.jobTitleId ? 'Select a department first.' : undefined}>
            <UiSelect
              value={f.jobTitleId}
              disabled={!f.departmentId && !f.jobTitleId}
              onChange={(e) => setF({ ...f, jobTitleId: e.target.value })}
            >
              <option value="">—</option>
              {jobTitleChoices.map((j) => <option key={j.id} value={j.id}>{j.name}</option>)}
            </UiSelect>
          </FieldShell>
          <FieldShell label="Employment start date">
            <UiInput type="date" value={f.employmentStartDate} onChange={(e) => setF({ ...f, employmentStartDate: e.target.value })} />
          </FieldShell>
          <FieldShell label="Contracted hours / week">
            <UiInput type="number" min="0" max="168" step="0.5" value={f.contractedHours} onChange={(e) => setF({ ...f, contractedHours: e.target.value })} />
          </FieldShell>
          <FieldShell label="Work pattern">
            <UiSelect value={f.workPatternType} onChange={(e) => setF({ ...f, workPatternType: e.target.value as WorkPatternType })}>
              {WORK_PATTERN_OPTIONS.map((t) => <option key={t} value={t}>{WORK_PATTERN_LABELS[t]}</option>)}
            </UiSelect>
          </FieldShell>
          <FieldShell label="Primary location">
            <UiSelect value={f.primaryLocationId} onChange={(e) => setF({ ...f, primaryLocationId: e.target.value })}>
              <option value="">—</option>
              {locationOptions.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </UiSelect>
          </FieldShell>
          <FieldShell label="Line manager">
            <UiSelect value={f.lineManagerId} onChange={(e) => setF({ ...f, lineManagerId: e.target.value })}>
              <option value="">—</option>
              {roster.filter((m) => m.id !== employee.id).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </UiSelect>
          </FieldShell>
        </div>
        <div className="flex justify-end border-t border-border pt-4">
          <Button type="submit" variant="primary" disabled={update.isPending}>Save employment details</Button>
        </div>
      </form>
    </Card>
  );
}

// ─────────────────────────── Personal (editable) ───────────────────────────
function PersonalPanel({ employee }: { employee: User }) {
  const toast = useToast();
  const update = useUpdateUser();
  const [f, setF] = useState({
    phone: employee.phone ?? '',
    address: employee.address ?? '',
    emergencyContactName: employee.emergencyContactName ?? '',
    emergencyContactPhone: employee.emergencyContactPhone ?? '',
    emergencyContactRelationship: employee.emergencyContactRelationship ?? '',
  });

  async function save(e: React.FormEvent) {
    e.preventDefault();
    try {
      await update.mutateAsync({
        id: employee.id,
        phone: f.phone.trim() || null,
        address: f.address.trim() || null,
        emergencyContactName: f.emergencyContactName.trim() || null,
        emergencyContactPhone: f.emergencyContactPhone.trim() || null,
        emergencyContactRelationship: f.emergencyContactRelationship.trim() || null,
      });
      toast.success('Personal details updated');
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? 'Could not update personal details');
    }
  }

  return (
    <Card className="p-5">
      <form onSubmit={save} className="space-y-4">
        <LoadingOverlay show={update.isPending} label="Saving…" />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FieldShell label="Full name" hint="Set from the employee’s sign-in profile.">
            <UiInput type="text" value={employee.name} disabled readOnly />
          </FieldShell>
          <FieldShell label="Email" hint="Not editable.">
            <UiInput type="email" value={employee.email} disabled readOnly />
          </FieldShell>
          <FieldShell label="Phone">
            <UiInput type="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
          </FieldShell>
          <FieldShell label="Home address">
            <UiTextarea rows={2} value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} />
          </FieldShell>
        </div>

        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-fg-muted">Emergency contact</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <FieldShell label="Name">
              <UiInput type="text" value={f.emergencyContactName} onChange={(e) => setF({ ...f, emergencyContactName: e.target.value })} />
            </FieldShell>
            <FieldShell label="Phone">
              <UiInput type="tel" value={f.emergencyContactPhone} onChange={(e) => setF({ ...f, emergencyContactPhone: e.target.value })} />
            </FieldShell>
            <FieldShell label="Relationship">
              <UiInput type="text" value={f.emergencyContactRelationship} onChange={(e) => setF({ ...f, emergencyContactRelationship: e.target.value })} />
            </FieldShell>
          </div>
        </div>

        <div className="flex justify-end border-t border-border pt-4">
          <Button type="submit" variant="primary" disabled={update.isPending}>Save personal details</Button>
        </div>
      </form>
    </Card>
  );
}

// ─────────────────────────── Deactivate ───────────────────────────
function DeactivateModal({
  open, employee, onClose, onDone,
}: { open: boolean; employee: User; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const deactivate = useDeactivateUser();
  const [reason, setReason] = useState('');
  const [err, setErr] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (reason.trim().length < 3) { setErr('A reason of at least 3 characters is required.'); return; }
    try {
      await deactivate.mutateAsync({ id: employee.id, reason: reason.trim() });
      toast.success(`${employee.name} deactivated`);
      setReason('');
      onDone();
    } catch (e: any) {
      setErr(e?.response?.data?.message ?? 'Could not deactivate this employee');
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={`Deactivate ${employee.name}`}>
      <form onSubmit={submit} className="space-y-4">
        <LoadingOverlay show={deactivate.isPending} label="Deactivating…" />
        <div className="rounded-lg border border-warning-border bg-warning-bg/50 p-3 text-sm text-warning-text">
          Login and API access are blocked. All historical data is kept.
        </div>
        <FieldShell label="Reason *">
          <UiTextarea rows={3} value={reason} onChange={(e) => { setReason(e.target.value); setErr(''); }} required />
        </FieldShell>
        {err && <p className="text-sm text-danger">{err}</p>}
        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="danger" disabled={deactivate.isPending}>Deactivate</Button>
        </div>
      </form>
    </Modal>
  );
}
