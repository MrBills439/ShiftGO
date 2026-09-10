'use client';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  PlusIcon, MagnifyingGlassIcon, UsersThreeIcon, UserCircleMinusIcon,
  ClockIcon, ShieldCheckIcon, PencilSimpleIcon,
  BuildingsIcon, UserMinusIcon as DeactivateIcon,
} from '@phosphor-icons/react';
import { Header } from '@/components/layout/Header';
import { Modal } from '@/components/ui/Modal';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { LoadingOverlay } from '@/components/ui/LoadingOverlay';
import { DataTable } from '@/components/ui/DataTable';
import { FilterBar } from '@/components/ui/FilterBar';
import { FieldShell, Select as UiSelect, Input as UiInput } from '@/components/ui/Input';
import { API_BASE } from '@/lib/api';
import { useUsers, useAssignWorker, useDeactivateUser, useUpdateUser, type UserStatus, type UserFilters } from '@/hooks/useWorkers';
import { useHouses } from '@/hooks/useHouses';
import {
  useDepartmentOptions, useJobTitleOptions, useLocationOptions,
  WORK_PATTERN_LABELS, EMPLOYMENT_TYPE_LABELS,
} from '@/hooks/useOrgStructure';
import { useAuthStore } from '@/store/authStore';
import { useToast } from '@/hooks/useToast';
import { ROLE_LABELS, ROLE_META, initials } from '@/lib/roles';
import { clsx } from 'clsx';
import { AllocationView } from '@/components/staff/AllocationView';
import { AddEmployeeWizard } from '@/components/staff/AddEmployeeWizard';
import type { Role, User, WorkPatternType, EmploymentType } from '@/types';

const ROLE_OPTIONS: Role[] = ['WORKER', 'TEAM_LEADER', 'MANAGER', 'HR'];
// WORKER is displayed as "Employee" — it is the standard system-access tier,
// not a job. Job titles / departments carry the real "what do they do".
const ACCESS_LABELS: Record<Role, string> = { ...ROLE_LABELS, WORKER: 'Employee' };
const WORK_PATTERN_OPTIONS: WorkPatternType[] = ['ROTA', 'FIXED', 'FLEXIBLE'];
const EMPLOYMENT_TYPE_OPTIONS: EmploymentType[] = ['PERMANENT', 'BANK', 'CONTRACTOR'];

export default function StaffPage() {
  const user = useAuthStore((s) => s.user);
  const router = useRouter();
  const [view, setView] = useState<'directory' | 'allocation'>('directory');
  const [statusFilter, setStatusFilter] = useState<UserStatus>('ACTIVE');
  const [roleFilter, setRoleFilter] = useState('');
  const [deptFilter, setDeptFilter] = useState('');
  const [jobTitleFilter, setJobTitleFilter] = useState('');
  const [locationFilter, setLocationFilter] = useState('');
  const [employmentFilter, setEmploymentFilter] = useState('');
  const [patternFilter, setPatternFilter] = useState('');
  const [searchTerm, setSearchTerm] = useState('');

  // Team leaders can only ever list workers (matches the backend's restriction) —
  // force that filter for them; HR/Manager keep fetching the full roster as before.
  const isTeamLeader = user?.role === 'TEAM_LEADER';
  const isHrOrManager = ['HR', 'MANAGER'].includes(user?.role ?? '');
  const userFilters: UserFilters = {
    ...(isTeamLeader ? { role: 'WORKER' } : roleFilter ? { role: roleFilter } : {}),
    ...(deptFilter ? { departmentId: deptFilter } : {}),
    ...(jobTitleFilter ? { jobTitleId: jobTitleFilter } : {}),
    ...(locationFilter ? { primaryLocationId: locationFilter } : {}),
    ...(employmentFilter ? { employmentType: employmentFilter } : {}),
    ...(patternFilter ? { workPatternType: patternFilter } : {}),
  };
  const { data: users = [], isLoading } = useUsers(userFilters, statusFilter);
  const { data: houses = [] } = useHouses();
  const { data: departmentOptions = [] } = useDepartmentOptions(isHrOrManager);
  const { data: jobTitleOptions = [] } = useJobTitleOptions(isHrOrManager);
  const { data: locationOptions = [] } = useLocationOptions(isHrOrManager);
  const managerCandidates = users; // scoped to same agency by the API

  // Department → Job Title link. Job-title options carry departmentId, so the
  // pickers filter client-side (instant, no refetch). The backend still
  // enforces the pairing on submit.
  const jobTitlesForDept = (deptId: string) =>
    deptId ? jobTitleOptions.filter((j) => j.departmentId === deptId) : [];
  const jobTitleFitsDept = (jobTitleId: string, deptId: string) => {
    if (!jobTitleId) return true;
    const jt = jobTitleOptions.find((j) => j.id === jobTitleId);
    if (!jt) return true; // inactive / unknown — leave legacy assignments alone
    return jt.departmentId == null || jt.departmentId === deptId;
  };
  const assignWorker = useAssignWorker();
  const deactivateUser = useDeactivateUser();
  const updateUser = useUpdateUser();
  const toast = useToast();

  const [createOpen, setCreateOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState<{ id: string; name: string } | null>(null);
  const [deactivateOpen, setDeactivateOpen] = useState<{ id: string; name: string; email: string } | null>(null);
  const [employmentOpen, setEmploymentOpen] = useState<User | null>(null);
  const emptyEmployment = {
    employeeNumber: '', departmentId: '', jobTitleId: '', primaryLocationId: '',
    lineManagerId: '', contractedHours: '', workPatternType: 'ROTA' as WorkPatternType, employmentType: '' as '' | EmploymentType,
  };
  const [employmentForm, setEmploymentForm] = useState(emptyEmployment);
  const [assignHouseId, setAssignHouseId] = useState('');
  const [deactivationReason, setDeactivationReason] = useState('');
  const [deactivationError, setDeactivationError] = useState('');

  function openEmployment(u: User) {
    setEmploymentForm({
      employeeNumber: u.employeeNumber ?? '',
      departmentId: u.departmentId ?? '',
      jobTitleId: u.jobTitleId ?? '',
      primaryLocationId: u.primaryLocationId ?? '',
      lineManagerId: u.lineManagerId ?? '',
      contractedHours: u.contractedHours != null ? String(u.contractedHours) : '',
      workPatternType: u.workPatternType ?? 'ROTA',
      employmentType: (u.employmentType ?? '') as '' | EmploymentType,
    });
    setEmploymentOpen(u);
  }

  // "" -> null so the API clears a field; a value is sent as-is.
  const nn = (v: string) => (v === '' ? null : v);

  async function handleSaveEmployment(e: React.FormEvent) {
    e.preventDefault();
    if (!employmentOpen) return;
    try {
      await updateUser.mutateAsync({
        id: employmentOpen.id,
        // Employee ID is read-only here — never sent from this form.
        departmentId: nn(employmentForm.departmentId),
        jobTitleId: nn(employmentForm.jobTitleId),
        primaryLocationId: nn(employmentForm.primaryLocationId),
        lineManagerId: nn(employmentForm.lineManagerId),
        contractedHours: employmentForm.contractedHours === '' ? null : parseFloat(employmentForm.contractedHours),
        workPatternType: employmentForm.workPatternType,
        employmentType: (nn(employmentForm.employmentType) as EmploymentType | null),
      });
      setEmploymentOpen(null);
      toast.success('Employment details updated');
    } catch (err: any) {
      toast.error(err.response?.data?.message ?? 'Failed to update employment details');
    }
  }

  // Job-title choices for the Edit modal: the selected department's active
  // titles, plus the currently-assigned title kept visible even if it is
  // legacy / unassigned / inactive / from another department (a later
  // JobTitle re-parent) so opening + saving never silently drops it.
  const editJobTitleChoices = useMemo(() => {
    const base = employmentForm.departmentId
      ? jobTitleOptions.filter((j) => j.departmentId === employmentForm.departmentId)
      : [];
    const currentId = employmentForm.jobTitleId;
    if (!currentId || base.some((j) => j.id === currentId)) return base;
    const known = jobTitleOptions.find((j) => j.id === currentId);
    const name = known?.name ?? employmentOpen?.jobTitle?.name ?? 'Current title';
    return [{ id: currentId, name: `${name} (current)`, departmentId: known?.departmentId ?? null }, ...base];
  }, [jobTitleOptions, employmentForm.departmentId, employmentForm.jobTitleId, employmentOpen]);

  const canViewStaff = ['HR', 'MANAGER', 'TEAM_LEADER'].includes(user?.role ?? '');
  const canManageStaff = ['HR', 'MANAGER'].includes(user?.role ?? '');
  const canAssignWorker = ['HR', 'MANAGER', 'TEAM_LEADER'].includes(user?.role ?? '');
  // Managers can create staff, but not HR accounts — that stays HR-only.
  const creatableRoles = user?.role === 'MANAGER' ? ROLE_OPTIONS.filter((r) => r !== 'HR') : ROLE_OPTIONS;

  useEffect(() => {
    if (user && !canViewStaff) router.replace('/dashboard');
  }, [user, canViewStaff, router]);

  // Calculate summary stats
  const stats = useMemo(() => {
    const allActive = users.filter((u) => u.status === 'ACTIVE');
    const allDeactivated = users.filter((u) => u.status === 'DEACTIVATED');
    const workers = allActive.filter((u) => u.role === 'WORKER').length;
    const managers = allActive.filter((u) => ['MANAGER', 'HR', 'TEAM_LEADER'].includes(u.role)).length;

    return {
      active: allActive.length,
      deactivated: allDeactivated.length,
      workers,
      managers,
    };
  }, [users]);

  // Server already applies role / department / job title / location / pattern /
  // employment-type filters; the search box is client-side over the result.
  const filteredUsers = useMemo(() => {
    if (!searchTerm) return users;
    const query = searchTerm.toLowerCase();
    return users.filter(
      (u) => u.name.toLowerCase().includes(query)
        || u.email.toLowerCase().includes(query)
        || (u.employeeNumber ?? '').toLowerCase().includes(query),
    );
  }, [users, searchTerm]);

  const activeFilterCount =
    (roleFilter ? 1 : 0) + (deptFilter ? 1 : 0) + (jobTitleFilter ? 1 : 0) + (locationFilter ? 1 : 0)
    + (employmentFilter ? 1 : 0) + (patternFilter ? 1 : 0) + (searchTerm ? 1 : 0);

  function clearFilters() {
    setRoleFilter(''); setDeptFilter(''); setJobTitleFilter(''); setLocationFilter('');
    setEmploymentFilter(''); setPatternFilter(''); setSearchTerm('');
  }

  if (user && !canViewStaff) return null;

  async function handleAssign(e: React.FormEvent) {
    e.preventDefault();
    if (!assignOpen || !assignHouseId) return;
    try {
      await assignWorker.mutateAsync({ workerId: assignOpen.id, houseId: assignHouseId });
      setAssignOpen(null);
      setAssignHouseId('');
      toast.success(`${assignOpen.name} assigned to house`);
    } catch {
      toast.error('Failed to assign worker to house');
    }
  }

  function closeDeactivate() {
    setDeactivateOpen(null);
    setDeactivationReason('');
    setDeactivationError('');
  }

  function handleDeactivate(e: React.FormEvent) {
    e.preventDefault();
    if (!deactivateOpen) return;
    if (!deactivationReason.trim()) {
      setDeactivationError('Deactivation reason is required');
      return;
    }

    deactivateUser.mutate({ id: deactivateOpen.id, reason: deactivationReason.trim() }, {
      onSuccess: () => {
        toast.success(`${deactivateOpen.name} deactivated`);
        closeDeactivate();
      },
      onError: (error: any) => {
        const fields = error.response?.data?.error?.fields;
        if (fields && typeof fields === 'object') {
          setDeactivationError(Object.values(fields).join('. '));
        } else {
          setDeactivationError(error.response?.data?.message ?? error.response?.data?.error?.message ?? 'Failed to deactivate user');
        }
      },
    });
  }

  return (
    <div className="space-y-8">
      <Header
        title="Staff"
        subtitle="Manage workers, managers, HR, availability, status, and staff records"
        action={canManageStaff && (
          <Button variant="primary" icon={<PlusIcon size={16} />} onClick={() => setCreateOpen(true)}>
            Add Staff
          </Button>
        )}
      />

      {/* Directory / Allocation  ·············  Active / Deactivated */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-lg border border-border bg-surface p-1">
          {(['directory', 'allocation'] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={clsx(
                'rounded-md px-4 py-1.5 text-sm font-semibold transition-colors capitalize',
                view === v ? 'bg-brand-600 text-white' : 'text-fg-muted hover:text-fg'
              )}
            >
              {v}
            </button>
          ))}
        </div>

        {view === 'directory' && (
          <div className="inline-flex rounded-lg border border-border bg-surface p-1">
            {(['ACTIVE', 'DEACTIVATED'] as UserStatus[]).map((status) => (
              <button
                key={status}
                onClick={() => setStatusFilter(status)}
                className={clsx(
                  'rounded-md px-4 py-1.5 text-sm font-semibold transition-colors',
                  statusFilter === status ? 'bg-brand-600 text-white' : 'text-fg-muted hover:text-fg'
                )}
              >
                {status === 'ACTIVE' ? 'Active' : 'Deactivated'}
              </button>
            ))}
          </div>
        )}
      </div>

      {view === 'allocation' && <AllocationView />}

      {view === 'directory' && (
        <>
      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card
          className={clsx('p-4 cursor-pointer transition-all', statusFilter === 'ACTIVE' && 'ring-2 ring-primary')}
          onClick={() => { setStatusFilter('ACTIVE'); setSearchTerm(''); }}
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-fg-muted uppercase tracking-widest">Active Staff</p>
              <p className="text-3xl font-bold text-fg font-inter mt-2">{stats.active}</p>
            </div>
            <div className="w-10 h-10 rounded-lg bg-success/10 flex items-center justify-center">
              <UsersThreeIcon size={20} className="text-success" />
            </div>
          </div>
        </Card>
        <Card
          className={clsx('p-4 cursor-pointer transition-all', statusFilter === 'DEACTIVATED' && 'ring-2 ring-primary')}
          onClick={() => { setStatusFilter('DEACTIVATED'); setSearchTerm(''); }}
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-fg-muted uppercase tracking-widest">Deactivated</p>
              <p className="text-3xl font-bold text-danger font-inter mt-2">{stats.deactivated}</p>
            </div>
            <div className="w-10 h-10 rounded-lg bg-danger/10 flex items-center justify-center">
              <UserCircleMinusIcon size={20} className="text-danger" />
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-fg-muted uppercase tracking-widest">Workers</p>
              <p className="text-3xl font-bold text-fg font-inter mt-2">{stats.workers}</p>
            </div>
            <div className={clsx('w-10 h-10 rounded-lg flex items-center justify-center', ROLE_META.WORKER.avatarClass)}>
              <ClockIcon size={20} />
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-fg-muted uppercase tracking-widest">Managers/HR</p>
              <p className="text-3xl font-bold text-fg font-inter mt-2">{stats.managers}</p>
            </div>
            <div className={clsx('w-10 h-10 rounded-lg flex items-center justify-center', ROLE_META.MANAGER.avatarClass)}>
              <ShieldCheckIcon size={20} />
            </div>
          </div>
        </Card>
      </div>

      {/* Filters */}
      <FilterBar activeCount={activeFilterCount} onClear={clearFilters}>
        <FieldShell label="Search">
          <div className="relative">
            <MagnifyingGlassIcon size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted" />
            <UiInput
              type="text"
              placeholder="Name, email or employee no…"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-8"
            />
          </div>
        </FieldShell>
        {!isTeamLeader && (
          <FieldShell label="System access">
            <UiSelect value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}>
              <option value="">All</option>
              {ROLE_OPTIONS.map((r) => (
                <option key={r} value={r}>{ACCESS_LABELS[r]}</option>
              ))}
            </UiSelect>
          </FieldShell>
        )}
        {isHrOrManager && (
          <>
            <FieldShell label="Department">
              <UiSelect value={deptFilter} onChange={(e) => setDeptFilter(e.target.value)}>
                <option value="">All</option>
                {departmentOptions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </UiSelect>
            </FieldShell>
            <FieldShell label="Job title">
              <UiSelect value={jobTitleFilter} onChange={(e) => setJobTitleFilter(e.target.value)}>
                <option value="">All</option>
                {jobTitleOptions.map((j) => <option key={j.id} value={j.id}>{j.name}</option>)}
              </UiSelect>
            </FieldShell>
            <FieldShell label="Location">
              <UiSelect value={locationFilter} onChange={(e) => setLocationFilter(e.target.value)}>
                <option value="">All</option>
                {locationOptions.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </UiSelect>
            </FieldShell>
            <FieldShell label="Employment">
              <UiSelect value={employmentFilter} onChange={(e) => setEmploymentFilter(e.target.value)}>
                <option value="">All</option>
                {EMPLOYMENT_TYPE_OPTIONS.map((t) => <option key={t} value={t}>{EMPLOYMENT_TYPE_LABELS[t]}</option>)}
              </UiSelect>
            </FieldShell>
            <FieldShell label="Work pattern">
              <UiSelect value={patternFilter} onChange={(e) => setPatternFilter(e.target.value)}>
                <option value="">All</option>
                {WORK_PATTERN_OPTIONS.map((t) => <option key={t} value={t}>{WORK_PATTERN_LABELS[t]}</option>)}
              </UiSelect>
            </FieldShell>
          </>
        )}
      </FilterBar>

      {/* Staff Directory */}
      <DataTable<User>
        rows={filteredUsers}
        getRowId={(u) => u.id}
        loading={isLoading}
        emptyTitle={searchTerm || roleFilter ? 'No staff match your filters' : 'No staff found'}
        emptyIcon={UsersThreeIcon}
        rowClassName={(u) => (u.status === 'DEACTIVATED' ? 'opacity-60' : undefined)}
        columns={[
          {
            id: 'name',
            header: 'Staff',
            sortValue: (u) => u.name,
            className: 'min-w-[220px]',
            accessor: (u) => (
              <div className="flex items-center gap-3">
                {u.profilePicture ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={`${API_BASE}${u.profilePicture}`}
                    alt=""
                    className="w-9 h-9 rounded-full object-cover flex-shrink-0 bg-surface-muted"
                  />
                ) : (
                  <div className={clsx('w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-semibold', ROLE_META[u.role].avatarClass)}>
                    {initials(u.name)}
                  </div>
                )}
                <div className="min-w-0">
                  <p className="font-semibold text-fg truncate">{u.name}</p>
                  <p className="text-xs text-fg-muted truncate">{u.email}</p>
                </div>
              </div>
            ),
          },
          {
            id: 'employeeNumber',
            header: 'Emp. no.',
            sortValue: (u) => u.employeeNumber ?? '',
            accessor: (u) => <span className="tabular-nums text-fg-muted">{u.employeeNumber || '—'}</span>,
          },
          {
            id: 'jobTitle',
            header: 'Job Title',
            sortValue: (u) => u.jobTitle?.name ?? '',
            className: 'min-w-[140px]',
            accessor: (u) => <span className="text-fg">{u.jobTitle?.name || '—'}</span>,
          },
          {
            id: 'department',
            header: 'Department',
            sortValue: (u) => u.department?.name ?? '',
            accessor: (u) => <span className="text-fg-muted">{u.department?.name || '—'}</span>,
          },
          {
            id: 'location',
            header: 'Primary Location',
            sortValue: (u) => u.primaryLocation?.name ?? '',
            className: 'min-w-[150px]',
            accessor: (u) => <span className="text-fg-muted">{u.primaryLocation?.name || '—'}</span>,
          },
          {
            id: 'role',
            header: 'System Access',
            sortValue: (u) => u.role,
            accessor: (u) => (
              <span className={clsx('inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold', ROLE_META[u.role].badgeClass)}>
                {ACCESS_LABELS[u.role]}
              </span>
            ),
          },
          {
            id: 'employmentType',
            header: 'Employment',
            sortValue: (u) => u.employmentType ?? '',
            accessor: (u) => <span className="text-fg-muted">{u.employmentType ? EMPLOYMENT_TYPE_LABELS[u.employmentType] : '—'}</span>,
          },
          {
            id: 'workPattern',
            header: 'Pattern',
            sortValue: (u) => u.workPatternType ?? 'ROTA',
            accessor: (u) => <span className="text-fg-muted">{WORK_PATTERN_LABELS[u.workPatternType ?? 'ROTA']}</span>,
          },
          {
            id: 'hours',
            header: 'Hours/wk',
            sortValue: (u) => u.contractedHours ?? -1,
            accessor: (u) => <span className="tabular-nums text-fg-muted">{u.contractedHours != null ? u.contractedHours : '—'}</span>,
          },
          {
            id: 'since',
            header: 'Since',
            sortValue: (u) => u.createdAt,
            accessor: (u) => (
              <span className="text-fg-muted whitespace-nowrap">
                {new Date(u.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' })}
              </span>
            ),
          },
          {
            id: 'status',
            header: 'Status',
            accessor: (u) => (
              <div>
                <Badge
                  variant={u.status === 'DEACTIVATED' ? 'danger' : 'success'}
                  label={u.status === 'DEACTIVATED' ? 'Deactivated' : 'Active'}
                  dot={false}
                />
                {u.status === 'DEACTIVATED' && u.deactivationReason && (
                  <p className="mt-1 max-w-[180px] text-[11px] text-danger">{u.deactivationReason}</p>
                )}
              </div>
            ),
          },
          {
            id: 'actions',
            header: '',
            className: 'text-right',
            accessor: (u) => (
              <div className="flex items-center justify-end gap-1">
                {canManageStaff && u.status !== 'DEACTIVATED' && (
                  <button
                    onClick={() => openEmployment(u)}
                    className="p-1.5 rounded text-fg-muted hover:text-primary hover:bg-primary/10 transition-colors"
                    aria-label={`Edit employment details for ${u.name}`}
                    title="Edit employment details"
                  >
                    <PencilSimpleIcon size={15} />
                  </button>
                )}
                {canAssignWorker && u.role === 'WORKER' && u.status !== 'DEACTIVATED' && (
                  <button
                    onClick={() => setAssignOpen({ id: u.id, name: u.name })}
                    className="p-1.5 rounded text-fg-muted hover:text-primary hover:bg-primary/10 transition-colors"
                    aria-label={`Assign house to ${u.name}`}
                    title="Assign to a service"
                  >
                    <BuildingsIcon size={15} />
                  </button>
                )}
                {canManageStaff && u.id !== user?.id && u.status !== 'DEACTIVATED' && (
                  <button
                    onClick={() => {
                      setDeactivateOpen({ id: u.id, name: u.name, email: u.email });
                      setDeactivationReason('');
                      setDeactivationError('');
                    }}
                    className="p-1.5 rounded text-fg-muted hover:text-danger hover:bg-danger/10 transition-colors"
                    aria-label={`Deactivate ${u.name}`}
                    title="Deactivate"
                  >
                    <DeactivateIcon size={15} />
                  </button>
                )}
              </div>
            ),
          },
        ]}
      />
        </>
      )}

      {/* Add Employee — multi-step onboarding wizard (V1) */}
      <AddEmployeeWizard
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        deptOptions={departmentOptions}
        jobTitleOptions={jobTitleOptions}
        locationOptions={locationOptions}
        managers={managerCandidates}
        creatableRoles={creatableRoles}
      />

      {/* Assign House Modal */}
      <Modal
        open={!!assignOpen}
        onClose={() => setAssignOpen(null)}
        title={`Assign ${assignOpen?.name} to House`}
      >
        <form onSubmit={handleAssign} className="space-y-4">
          <LoadingOverlay show={assignWorker.isPending} label="Assigning…" />
          <FieldShell label="House *">
            <UiSelect
              value={assignHouseId}
              onChange={(e) => setAssignHouseId(e.target.value)}
              required
            >
              <option value="">Select house…</option>
              {houses.map((h) => (
                <option key={h.id} value={h.id}>{h.name}</option>
              ))}
            </UiSelect>
          </FieldShell>
          <div className="flex gap-2 justify-end pt-4">
            <Button variant="secondary" onClick={() => setAssignOpen(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              type="submit"
              disabled={assignWorker.isPending}
            >
              {assignWorker.isPending ? 'Assigning…' : 'Assign House'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Deactivate Modal */}
      <Modal
        open={!!deactivateOpen}
        onClose={closeDeactivate}
        title={`Deactivate ${deactivateOpen?.name}`}
      >
        <form onSubmit={handleDeactivate} className="space-y-4">
          <LoadingOverlay show={deactivateUser.isPending} label="Deactivating…" />
          <div className="bg-warning/10 border border-warning/20 rounded-lg p-4 text-sm">
            <p className="font-medium text-warning mb-1">Account will be blocked</p>
            <p className="text-fg-muted">
              This will prevent login and API access for {deactivateOpen?.email}. All historical data remains in the system.
            </p>
          </div>

          <FieldShell label="Reason for Deactivation *">
            <textarea
              className="w-full px-3 py-2 border border-border rounded-md text-sm focus:outline-none focus:ring-4 focus:ring-brand-600/20 focus:border-brand-600"
              value={deactivationReason}
              onChange={(e) => {
                setDeactivationReason(e.target.value);
                setDeactivationError('');
              }}
              placeholder="Explain why this staff member is being deactivated"
              rows={4}
              required
            />
            <p className="text-xs text-fg-muted mt-1">{deactivationReason.length}/500</p>
          </FieldShell>

          {deactivationError && (
            <div className="bg-danger/10 border border-danger/20 rounded-lg p-3 text-sm text-danger">
              {deactivationError}
            </div>
          )}

          <div className="flex gap-2 justify-end pt-4">
            <Button variant="secondary" onClick={closeDeactivate}>
              Cancel
            </Button>
            <Button
              variant="primary"
              type="submit"
              disabled={deactivateUser.isPending}
            >
              {deactivateUser.isPending ? 'Deactivating…' : 'Deactivate'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Edit Employment Modal */}
      <Modal open={!!employmentOpen} onClose={() => setEmploymentOpen(null)} title={`Employment — ${employmentOpen?.name ?? ''}`}>
        <form onSubmit={handleSaveEmployment} className="space-y-4">
          <LoadingOverlay show={updateUser.isPending} label="Saving…" />
          <div className="grid grid-cols-2 gap-3">
            <FieldShell label="Employee ID" hint="Assigned automatically when the employee is invited.">
              <UiInput type="text" value={employmentOpen?.employeeNumber ?? 'Not set'} disabled readOnly />
            </FieldShell>
            <FieldShell label="Contracted hours / week" hint="Blank to clear">
              <UiInput type="number" min="0" max="168" step="0.5" value={employmentForm.contractedHours}
                onChange={(e) => setEmploymentForm({ ...employmentForm, contractedHours: e.target.value })} />
            </FieldShell>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <FieldShell label="Department">
              <UiSelect
                value={employmentForm.departmentId}
                onChange={(e) => {
                  const departmentId = e.target.value;
                  setEmploymentForm((f) => ({
                    ...f,
                    departmentId,
                    jobTitleId: jobTitleFitsDept(f.jobTitleId, departmentId) ? f.jobTitleId : '',
                  }));
                }}
              >
                <option value="">—</option>
                {departmentOptions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </UiSelect>
            </FieldShell>
            <FieldShell
              label="Job title"
              hint={!employmentForm.departmentId && !employmentForm.jobTitleId ? 'Select a department first.' : undefined}
            >
              <UiSelect
                value={employmentForm.jobTitleId}
                disabled={!employmentForm.departmentId && !employmentForm.jobTitleId}
                onChange={(e) => setEmploymentForm({ ...employmentForm, jobTitleId: e.target.value })}
              >
                <option value="">—</option>
                {editJobTitleChoices.map((j) => <option key={j.id} value={j.id}>{j.name}</option>)}
              </UiSelect>
            </FieldShell>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <FieldShell label="Primary location">
              <UiSelect value={employmentForm.primaryLocationId} onChange={(e) => setEmploymentForm({ ...employmentForm, primaryLocationId: e.target.value })}>
                <option value="">—</option>
                {locationOptions.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </UiSelect>
            </FieldShell>
            <FieldShell label="Work pattern">
              <UiSelect value={employmentForm.workPatternType} onChange={(e) => setEmploymentForm({ ...employmentForm, workPatternType: e.target.value as WorkPatternType })}>
                {WORK_PATTERN_OPTIONS.map((t) => <option key={t} value={t}>{WORK_PATTERN_LABELS[t]}</option>)}
              </UiSelect>
            </FieldShell>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <FieldShell label="Employment type">
              <UiSelect value={employmentForm.employmentType} onChange={(e) => setEmploymentForm({ ...employmentForm, employmentType: e.target.value as EmploymentType | '' })}>
                <option value="">—</option>
                {EMPLOYMENT_TYPE_OPTIONS.map((t) => <option key={t} value={t}>{EMPLOYMENT_TYPE_LABELS[t]}</option>)}
              </UiSelect>
            </FieldShell>
            <FieldShell label="Line manager">
              <UiSelect value={employmentForm.lineManagerId} onChange={(e) => setEmploymentForm({ ...employmentForm, lineManagerId: e.target.value })}>
                <option value="">—</option>
                {managerCandidates.filter((m) => m.id !== employmentOpen?.id).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </UiSelect>
            </FieldShell>
          </div>
          <div className="flex gap-2 justify-end pt-4">
            <Button variant="secondary" onClick={() => setEmploymentOpen(null)}>Cancel</Button>
            <Button variant="primary" type="submit" disabled={updateUser.isPending}>
              {updateUser.isPending ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
