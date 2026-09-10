'use client';
import { useMemo, useState } from 'react';
import { clsx } from 'clsx';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { LoadingOverlay } from '@/components/ui/LoadingOverlay';
import { FieldShell, Select as UiSelect, Input as UiInput, Textarea as UiTextarea } from '@/components/ui/Input';
import { useCreateUser, type CreateUserInput } from '@/hooks/useWorkers';
import { useAgency } from '@/hooks/useAgency';
import { useToast } from '@/hooks/useToast';
import { WORK_PATTERN_LABELS, EMPLOYMENT_TYPE_LABELS } from '@/hooks/useOrgStructure';
import type { Role, User, WorkPatternType, EmploymentType, OrgOption } from '@/types';

const STEPS = ['Personal', 'Employment', 'Work Assignment', 'Emergency Contact', 'System Access', 'Review'] as const;

const WORK_PATTERN_OPTIONS: WorkPatternType[] = ['ROTA', 'FIXED', 'FLEXIBLE'];
const EMPLOYMENT_TYPE_OPTIONS: EmploymentType[] = ['PERMANENT', 'BANK', 'CONTRACTOR'];
// System Access labels — Job Title stays a separate concept from system permission.
const ACCESS_LABELS: Record<Role, string> = { WORKER: 'Employee', TEAM_LEADER: 'Team Leader', MANAGER: 'Manager', HR: 'HR' };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Props = {
  open: boolean;
  onClose: () => void;
  deptOptions: OrgOption[];
  jobTitleOptions: OrgOption[];
  locationOptions: OrgOption[];
  managers: Pick<User, 'id' | 'name'>[];
  creatableRoles: Role[];
};

const BLANK = {
  // Personal
  name: '', email: '', phone: '', address: '',
  // Employment
  customEmpId: false, employeeNumber: '',
  departmentId: '', jobTitleId: '', employmentType: '' as '' | EmploymentType,
  employmentStartDate: '', contractedHours: '', workPatternType: 'ROTA' as WorkPatternType,
  // Work assignment
  primaryLocationId: '', lineManagerId: '',
  // Emergency contact
  emergencyContactName: '', emergencyContactPhone: '', emergencyContactRelationship: '',
  // System access
  role: 'WORKER' as Role,
};

export function AddEmployeeWizard({ open, onClose, deptOptions, jobTitleOptions, locationOptions, managers, creatableRoles }: Props) {
  const createUser = useCreateUser();
  const { data: agency } = useAgency();
  const toast = useToast();

  const [step, setStep] = useState(0);
  const [f, setF] = useState(BLANK);
  const [error, setError] = useState('');

  const set = (patch: Partial<typeof BLANK>) => setF((prev) => ({ ...prev, ...patch }));
  const canAutoGenerateId = !!agency?.employeeIdPrefix;

  const jobTitlesForDept = (deptId: string) => (deptId ? jobTitleOptions.filter((j) => j.departmentId === deptId) : []);
  const jobTitleFitsDept = (jtId: string, deptId: string) => {
    if (!jtId) return true;
    const jt = jobTitleOptions.find((j) => j.id === jtId);
    if (!jt) return true;
    return jt.departmentId == null || jt.departmentId === deptId;
  };

  function reset() { setF(BLANK); setStep(0); setError(''); }
  function close() { reset(); onClose(); }

  // ── Per-step "can continue" ──
  const personalOk = f.name.trim().length >= 2 && EMAIL_RE.test(f.email.trim());
  const employmentOk =
    !!f.departmentId && !!f.jobTitleId && !!f.employmentType &&
    (f.customEmpId ? f.employeeNumber.trim().length > 0 : canAutoGenerateId);
  const stepValid = [personalOk, employmentOk, true, true, true, true][step];
  const canInvite = personalOk && employmentOk;

  // ── Review-summary lookups ──
  const nameOf = (list: { id: string; name: string }[], id: string) => list.find((x) => x.id === id)?.name ?? '—';
  const empIdPreview = f.customEmpId
    ? (f.employeeNumber.trim() || 'Custom ID — required')
    : (agency?.nextEmployeeIdPreview ?? 'Auto-generated on invite');

  async function submit() {
    setError('');
    const body: CreateUserInput = {
      name: f.name.trim(),
      email: f.email.trim(),
      role: f.role,
      departmentId: f.departmentId,
      jobTitleId: f.jobTitleId,
      employmentType: f.employmentType || undefined,
      workPatternType: f.workPatternType,
    };
    if (f.phone.trim()) body.phone = f.phone.trim();
    if (f.address.trim()) body.address = f.address.trim();
    if (f.customEmpId && f.employeeNumber.trim()) body.employeeNumber = f.employeeNumber.trim();
    if (f.employmentStartDate) body.employmentStartDate = f.employmentStartDate;
    if (f.contractedHours) body.contractedHours = parseFloat(f.contractedHours);
    if (f.primaryLocationId) body.primaryLocationId = f.primaryLocationId;
    if (f.lineManagerId) body.lineManagerId = f.lineManagerId;
    if (f.emergencyContactName.trim()) body.emergencyContactName = f.emergencyContactName.trim();
    if (f.emergencyContactPhone.trim()) body.emergencyContactPhone = f.emergencyContactPhone.trim();
    if (f.emergencyContactRelationship.trim()) body.emergencyContactRelationship = f.emergencyContactRelationship.trim();

    try {
      const res = await createUser.mutateAsync(body);
      const empNo = (res as { data?: { data?: { employeeNumber?: string } } })?.data?.data?.employeeNumber;
      toast.success(empNo ? `Invitation sent — Employee ID ${empNo}` : 'Invitation sent');
      close();
    } catch (e: unknown) {
      const err = e as { response?: { data?: { message?: string; error?: { fields?: Record<string, string> } } } };
      const fields = err.response?.data?.error?.fields;
      setError(fields ? Object.values(fields).join('. ') : (err.response?.data?.message ?? 'Failed to send invitation'));
    }
  }

  const SummaryRow = ({ label, value }: { label: string; value?: string | null }) => (
    <div className="flex justify-between gap-4 py-1 text-sm">
      <span className="text-fg-muted">{label}</span>
      <span className="text-right font-medium text-fg">{value || '—'}</span>
    </div>
  );
  const SummaryGroup = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div className="rounded-lg border border-border bg-surface p-3">
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-widest text-fg-muted">{title}</p>
      {children}
    </div>
  );

  return (
    <Modal open={open} onClose={close} title="Add Employee" width="max-w-xl">
      <LoadingOverlay show={createUser.isPending} label="Sending invitation…" />

      {/* Stepper */}
      <div className="-mx-1 mb-5 flex items-center gap-1.5 overflow-x-auto px-1 pb-1">
        {STEPS.map((label, i) => (
          <button
            key={label}
            type="button"
            onClick={() => { if (i < step) setStep(i); }}
            className={clsx(
              'flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold transition-colors',
              i === step ? 'bg-brand-600 text-white'
                : i < step ? 'bg-brand-600/10 text-brand-600 hover:bg-brand-600/20'
                : 'bg-surface text-fg-subtle',
            )}
          >
            <span className={clsx(
              'flex h-4 w-4 items-center justify-center rounded-full text-[10px]',
              i === step ? 'bg-white/25' : i < step ? 'bg-brand-600/20' : 'bg-fg-subtle/15',
            )}>{i + 1}</span>
            {label}
          </button>
        ))}
      </div>

      <form onSubmit={(e) => { e.preventDefault(); if (step < STEPS.length - 1) { if (stepValid) setStep(step + 1); } else { void submit(); } }} className="space-y-4">
        {/* ── 1. Personal ── */}
        {step === 0 && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FieldShell label="Full legal name *">
              <UiInput type="text" placeholder="Jane Smith" value={f.name} onChange={(e) => set({ name: e.target.value })} required />
            </FieldShell>
            <FieldShell label="Email address *">
              <UiInput type="email" placeholder="jane@company.com" value={f.email} onChange={(e) => set({ email: e.target.value })} required />
            </FieldShell>
            <FieldShell label="Mobile phone">
              <UiInput type="tel" placeholder="+44 7700 900123" value={f.phone} onChange={(e) => set({ phone: e.target.value })} />
            </FieldShell>
            <FieldShell label="Home address">
              <UiTextarea rows={2} placeholder="12 Oak Street, London" value={f.address} onChange={(e) => set({ address: e.target.value })} />
            </FieldShell>
          </div>
        )}

        {/* ── 2. Employment ── */}
        {step === 1 && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FieldShell
              label="Employee ID"
              hint={
                f.customEmpId ? 'Custom ID — must be unique in your agency.'
                  : canAutoGenerateId ? `Auto-generated on invite (${agency?.nextEmployeeIdPreview}).`
                  : 'Set an Employee ID prefix in Admin → General first.'
              }
            >
              {f.customEmpId
                ? <UiInput type="text" placeholder="E-1042" value={f.employeeNumber} onChange={(e) => set({ employeeNumber: e.target.value })} />
                : <UiInput type="text" disabled readOnly value={canAutoGenerateId ? (agency?.nextEmployeeIdPreview ?? 'Auto-generated') : 'Not available'} />}
              <label className="mt-1.5 flex items-center gap-1.5 text-xs text-fg-muted">
                <input type="checkbox" checked={f.customEmpId} onChange={(e) => set({ customEmpId: e.target.checked, employeeNumber: e.target.checked ? f.employeeNumber : '' })} />
                Use a custom ID
              </label>
            </FieldShell>
            <FieldShell label="Employment type *">
              <UiSelect value={f.employmentType} onChange={(e) => set({ employmentType: e.target.value as '' | EmploymentType })} required>
                <option value="">—</option>
                {EMPLOYMENT_TYPE_OPTIONS.map((t) => <option key={t} value={t}>{EMPLOYMENT_TYPE_LABELS[t]}</option>)}
              </UiSelect>
            </FieldShell>
            <FieldShell label="Department *">
              <UiSelect
                value={f.departmentId}
                onChange={(e) => {
                  const departmentId = e.target.value;
                  set({ departmentId, jobTitleId: jobTitleFitsDept(f.jobTitleId, departmentId) ? f.jobTitleId : '' });
                }}
                required
              >
                <option value="">—</option>
                {deptOptions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </UiSelect>
            </FieldShell>
            <FieldShell label="Job title *" hint={!f.departmentId ? 'Select a department first.' : undefined}>
              <UiSelect value={f.jobTitleId} disabled={!f.departmentId} onChange={(e) => set({ jobTitleId: e.target.value })} required>
                <option value="">—</option>
                {jobTitlesForDept(f.departmentId).map((j) => <option key={j.id} value={j.id}>{j.name}</option>)}
              </UiSelect>
            </FieldShell>
            <FieldShell label="Employment start date">
              <UiInput type="date" value={f.employmentStartDate} onChange={(e) => set({ employmentStartDate: e.target.value })} />
            </FieldShell>
            <FieldShell label="Contracted hours / week">
              <UiInput type="number" min="0" max="168" step="0.5" placeholder="37.5" value={f.contractedHours} onChange={(e) => set({ contractedHours: e.target.value })} />
            </FieldShell>
            <FieldShell label="Work pattern">
              <UiSelect value={f.workPatternType} onChange={(e) => set({ workPatternType: e.target.value as WorkPatternType })}>
                {WORK_PATTERN_OPTIONS.map((t) => <option key={t} value={t}>{WORK_PATTERN_LABELS[t]}</option>)}
              </UiSelect>
            </FieldShell>
          </div>
        )}

        {/* ── 3. Work Assignment ── */}
        {step === 2 && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FieldShell label="Primary location">
              <UiSelect value={f.primaryLocationId} onChange={(e) => set({ primaryLocationId: e.target.value })}>
                <option value="">—</option>
                {locationOptions.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </UiSelect>
            </FieldShell>
            <FieldShell label="Line manager">
              <UiSelect value={f.lineManagerId} onChange={(e) => set({ lineManagerId: e.target.value })}>
                <option value="">—</option>
                {managers.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </UiSelect>
            </FieldShell>
            <p className="text-xs text-fg-muted sm:col-span-2">
              House assignment is handled separately from the staff directory once the employee has accepted.
            </p>
          </div>
        )}

        {/* ── 4. Emergency Contact ── */}
        {step === 3 && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FieldShell label="Contact name">
              <UiInput type="text" placeholder="Sam Smith" value={f.emergencyContactName} onChange={(e) => set({ emergencyContactName: e.target.value })} />
            </FieldShell>
            <FieldShell label="Contact phone">
              <UiInput type="tel" placeholder="+44 7700 900456" value={f.emergencyContactPhone} onChange={(e) => set({ emergencyContactPhone: e.target.value })} />
            </FieldShell>
            <FieldShell label="Relationship">
              <UiInput type="text" placeholder="Partner, parent, sibling…" value={f.emergencyContactRelationship} onChange={(e) => set({ emergencyContactRelationship: e.target.value })} />
            </FieldShell>
            <p className="text-xs text-fg-muted sm:col-span-2">All emergency-contact fields are optional in V1.</p>
          </div>
        )}

        {/* ── 5. System Access ── */}
        {step === 4 && (
          <FieldShell label="System permission *" hint="System access tier only. Job title and department describe the role — they never grant permissions.">
            <UiSelect value={f.role} onChange={(e) => set({ role: e.target.value as Role })}>
              {creatableRoles.map((r) => <option key={r} value={r}>{ACCESS_LABELS[r]}</option>)}
            </UiSelect>
          </FieldShell>
        )}

        {/* ── 6. Review & Invite ── */}
        {step === 5 && (
          <div className="space-y-3">
            <SummaryGroup title="Personal">
              <SummaryRow label="Name" value={f.name.trim()} />
              <SummaryRow label="Email" value={f.email.trim()} />
              <SummaryRow label="Phone" value={f.phone.trim()} />
              <SummaryRow label="Address" value={f.address.trim()} />
            </SummaryGroup>
            <SummaryGroup title="Employment">
              <SummaryRow label="Employee ID" value={empIdPreview} />
              <SummaryRow label="Department" value={nameOf(deptOptions, f.departmentId)} />
              <SummaryRow label="Job title" value={nameOf(jobTitleOptions, f.jobTitleId)} />
              <SummaryRow label="Employment type" value={f.employmentType ? EMPLOYMENT_TYPE_LABELS[f.employmentType] : '—'} />
              <SummaryRow label="Start date" value={f.employmentStartDate} />
              <SummaryRow label="Contracted hours" value={f.contractedHours} />
              <SummaryRow label="Work pattern" value={WORK_PATTERN_LABELS[f.workPatternType]} />
            </SummaryGroup>
            <SummaryGroup title="Work assignment">
              <SummaryRow label="Primary location" value={nameOf(locationOptions, f.primaryLocationId)} />
              <SummaryRow label="Line manager" value={nameOf(managers, f.lineManagerId)} />
            </SummaryGroup>
            <SummaryGroup title="Emergency contact">
              <SummaryRow label="Name" value={f.emergencyContactName.trim()} />
              <SummaryRow label="Phone" value={f.emergencyContactPhone.trim()} />
              <SummaryRow label="Relationship" value={f.emergencyContactRelationship.trim()} />
            </SummaryGroup>
            <SummaryGroup title="System access">
              <SummaryRow label="Permission" value={ACCESS_LABELS[f.role]} />
            </SummaryGroup>
            {!canInvite && (
              <p className="text-xs text-danger">Complete name, email, department, job title, employment type and system permission before sending.</p>
            )}
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-danger/20 bg-danger/10 p-3 text-sm text-danger">{error}</div>
        )}

        <div className="flex items-center justify-between gap-2 border-t border-border pt-4">
          <Button type="button" variant="secondary" onClick={step === 0 ? close : () => setStep(step - 1)}>
            {step === 0 ? 'Cancel' : 'Back'}
          </Button>
          {step < STEPS.length - 1 ? (
            <Button type="submit" variant="primary" disabled={!stepValid}>Continue</Button>
          ) : (
            <Button type="submit" variant="primary" disabled={!canInvite || createUser.isPending}>
              {createUser.isPending ? 'Sending…' : 'Send Invitation'}
            </Button>
          )}
        </div>
      </form>
    </Modal>
  );
}
