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
import { useUsers, useCreateUser, useAssignWorker, useDeactivateUser, useUpdateUser, type UserStatus } from '@/hooks/useWorkers';
import { useHouses } from '@/hooks/useHouses';
import { useAuthStore } from '@/store/authStore';
import { useToast } from '@/hooks/useToast';
import { ROLE_LABELS, ROLE_META, initials } from '@/lib/roles';
import { clsx } from 'clsx';
import { AllocationView } from '@/components/staff/AllocationView';
import type { Role, User } from '@/types';

const ROLE_OPTIONS: Role[] = ['WORKER', 'TEAM_LEADER', 'MANAGER', 'HR'];

export default function StaffPage() {
  const user = useAuthStore((s) => s.user);
  const router = useRouter();
  const [view, setView] = useState<'directory' | 'allocation'>('directory');
  const [statusFilter, setStatusFilter] = useState<UserStatus>('ACTIVE');
  const [roleFilter, setRoleFilter] = useState('');
  const [searchTerm, setSearchTerm] = useState('');

  // Team leaders can only ever list workers (matches the backend's restriction) —
  // force that filter for them; HR/Manager keep fetching the full roster as before.
  const isTeamLeader = user?.role === 'TEAM_LEADER';
  const { data: users = [], isLoading } = useUsers(isTeamLeader ? 'WORKER' : undefined, statusFilter);
  const { data: houses = [] } = useHouses();
  const createUser = useCreateUser();
  const assignWorker = useAssignWorker();
  const deactivateUser = useDeactivateUser();
  const updateUser = useUpdateUser();
  const toast = useToast();

  const [createOpen, setCreateOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState<{ id: string; name: string } | null>(null);
  const [deactivateOpen, setDeactivateOpen] = useState<{ id: string; name: string; email: string } | null>(null);
  const [hoursOpen, setHoursOpen] = useState<{ id: string; name: string; contractedHours: number | null } | null>(null);
  const [hoursValue, setHoursValue] = useState('');
  const [form, setForm] = useState({ name: '', email: '', phone: '', temporaryPassword: '', role: 'WORKER' as Role });
  const [assignHouseId, setAssignHouseId] = useState('');
  const [deactivationReason, setDeactivationReason] = useState('');
  const [deactivationError, setDeactivationError] = useState('');
  const [createError, setCreateError] = useState('');

  async function handleUpdateHours(e: React.FormEvent) {
    e.preventDefault();
    if (!hoursOpen) return;
    try {
      await updateUser.mutateAsync({ id: hoursOpen.id, contractedHours: hoursValue ? parseFloat(hoursValue) : null });
      setHoursOpen(null);
      toast.success('Contracted hours updated');
    } catch {
      toast.error('Failed to update contracted hours');
    }
  }

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

  // Filter users based on search and role
  const filteredUsers = useMemo(() => {
    let items = users;
    if (roleFilter) items = items.filter((u) => u.role === roleFilter);
    if (searchTerm) {
      const query = searchTerm.toLowerCase();
      items = items.filter((u) => u.name.toLowerCase().includes(query) || u.email.toLowerCase().includes(query));
    }
    return items;
  }, [users, roleFilter, searchTerm]);

  const activeFilterCount = (roleFilter ? 1 : 0) + (searchTerm ? 1 : 0);

  if (user && !canViewStaff) return null;

  function errorMessage(e: any) {
    const fields = e.response?.data?.error?.fields;
    if (fields && typeof fields === 'object') {
      return Object.values(fields).join('. ');
    }
    return e.response?.data?.message ?? e.response?.data?.error?.message ?? 'Failed to create user';
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreateError('');
    try {
      const body = {
        name: form.name.trim(),
        email: form.email.trim(),
        role: form.role,
        ...(form.phone.trim() ? { phone: form.phone.trim() } : {}),
        temporaryPassword: form.temporaryPassword,
      };
      await createUser.mutateAsync(body);
      setCreateOpen(false);
      setForm({ name: '', email: '', phone: '', temporaryPassword: '', role: 'WORKER' });
      toast.success('Staff member created successfully');
    } catch (e: any) {
      setCreateError(errorMessage(e));
    }
  }

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
      <FilterBar activeCount={activeFilterCount} onClear={() => { setRoleFilter(''); setSearchTerm(''); }}>
        <FieldShell label="Search">
          <div className="relative">
            <MagnifyingGlassIcon size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted" />
            <UiInput
              type="text"
              placeholder="Name or email…"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-8"
            />
          </div>
        </FieldShell>
        {!isTeamLeader && (
          <FieldShell label="Role">
            <UiSelect value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}>
              <option value="">All roles</option>
              {ROLE_OPTIONS.map((r) => (
                <option key={r} value={r}>{ROLE_LABELS[r]}</option>
              ))}
            </UiSelect>
          </FieldShell>
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
            id: 'role',
            header: 'Role',
            sortValue: (u) => u.role,
            accessor: (u) => (
              <span className={clsx('inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold', ROLE_META[u.role].badgeClass)}>
                {ROLE_LABELS[u.role]}
              </span>
            ),
          },
          {
            id: 'contact',
            header: 'Contact',
            accessor: (u) => <span className="text-fg-muted">{u.phone || '—'}</span>,
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
                    onClick={() => {
                      setHoursOpen({ id: u.id, name: u.name, contractedHours: u.contractedHours ?? null });
                      setHoursValue(u.contractedHours != null ? String(u.contractedHours) : '');
                    }}
                    className="p-1.5 rounded text-fg-muted hover:text-primary hover:bg-primary/10 transition-colors"
                    aria-label={`Edit hours for ${u.name}`}
                    title="Edit contracted hours"
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

      {/* Create Modal */}
      <Modal open={createOpen} onClose={() => { setCreateOpen(false); setCreateError(''); }} title="Add Staff Member">
        <form onSubmit={handleCreate} className="space-y-4">
          <LoadingOverlay show={createUser.isPending} label="Creating staff member…" />
          <p className="text-sm text-fg-muted">Create a new staff member account. They will receive login details via email.</p>

          <FieldShell label="Full Name *">
            <UiInput
              type="text"
              placeholder="Jane Smith"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
            />
          </FieldShell>

          <FieldShell label="Email *">
            <UiInput
              type="email"
              placeholder="jane@company.com"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              required
            />
          </FieldShell>

          <div className="grid grid-cols-2 gap-3">
            <FieldShell label="Phone (optional)">
              <UiInput
                type="tel"
                placeholder="+44 7700 900123"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
            </FieldShell>
            <FieldShell label="Role *">
              <UiSelect
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value as Role })}
              >
                {creatableRoles.map((r) => (
                  <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                ))}
              </UiSelect>
            </FieldShell>
          </div>

          <FieldShell label="Temporary Password *" hint="They must change this password on first login.">
            <UiInput
              type="password"
              placeholder="Must be at least 8 characters"
              value={form.temporaryPassword}
              onChange={(e) => setForm({ ...form, temporaryPassword: e.target.value })}
              required
            />
          </FieldShell>

          {createError && (
            <div className="bg-danger/10 border border-danger/20 rounded-lg p-3 text-sm text-danger">
              {createError}
            </div>
          )}

          <div className="flex gap-2 justify-end pt-4">
            <Button
              variant="secondary"
              onClick={() => { setCreateOpen(false); setCreateError(''); }}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              type="submit"
              disabled={createUser.isPending}
            >
              {createUser.isPending ? 'Creating…' : 'Create Staff Member'}
            </Button>
          </div>
        </form>
      </Modal>

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

      {/* Edit Hours Modal */}
      <Modal open={!!hoursOpen} onClose={() => setHoursOpen(null)} title={`Contracted Hours — ${hoursOpen?.name}`}>
        <form onSubmit={handleUpdateHours} className="space-y-4">
          <LoadingOverlay show={updateUser.isPending} label="Saving…" />
          <FieldShell label="Contracted hours per week" hint="Leave blank to clear">
            <UiInput
              type="number"
              min="0"
              max="168"
              step="0.5"
              placeholder="e.g. 37.5"
              value={hoursValue}
              onChange={(e) => setHoursValue(e.target.value)}
            />
          </FieldShell>
          <div className="flex gap-2 justify-end pt-4">
            <Button variant="secondary" onClick={() => setHoursOpen(null)}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" disabled={updateUser.isPending}>
              {updateUser.isPending ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
