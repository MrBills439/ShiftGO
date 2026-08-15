'use client';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PlusIcon, MagnifyingGlassIcon } from '@phosphor-icons/react';
import { Header } from '@/components/layout/Header';
import { Modal } from '@/components/ui/Modal';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useUsers, useCreateUser, useAssignWorker, useDeactivateUser, type UserStatus } from '@/hooks/useWorkers';
import { useHouses } from '@/hooks/useHouses';
import { useAuthStore } from '@/store/authStore';
import { useToast } from '@/hooks/useToast';
import type { Role } from '@/types';

const ROLE_OPTIONS: Role[] = ['WORKER', 'TEAM_LEADER', 'MANAGER', 'HR'];
const ROLE_LABELS: Record<Role, string> = {
  WORKER: 'Worker',
  TEAM_LEADER: 'Team Lead',
  MANAGER: 'Manager',
  HR: 'HR',
};

export default function PeoplePage() {
  const user = useAuthStore((s) => s.user);
  const router = useRouter();
  const [statusFilter, setStatusFilter] = useState<UserStatus>('ACTIVE');
  const [roleFilter, setRoleFilter] = useState('');
  const [searchTerm, setSearchTerm] = useState('');

  const { data: users = [], isLoading } = useUsers(undefined, statusFilter);
  const { data: houses = [] } = useHouses();
  const createUser = useCreateUser();
  const assignWorker = useAssignWorker();
  const deactivateUser = useDeactivateUser();
  const toast = useToast();

  const [createOpen, setCreateOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState<{ id: string; name: string } | null>(null);
  const [deactivateOpen, setDeactivateOpen] = useState<{ id: string; name: string; email: string } | null>(null);
  const [form, setForm] = useState({ name: '', email: '', phone: '', temporaryPassword: '', role: 'WORKER' as Role });
  const [assignHouseId, setAssignHouseId] = useState('');
  const [deactivationReason, setDeactivationReason] = useState('');
  const [deactivationError, setDeactivationError] = useState('');
  const [createError, setCreateError] = useState('');

  const canManageStaff = ['HR', 'MANAGER'].includes(user?.role ?? '');
  const isHR = user?.role === 'HR';

  useEffect(() => {
    if (user && !canManageStaff) router.replace('/dashboard');
  }, [user, canManageStaff, router]);

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

  if (user && !canManageStaff) return null;

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
        title="People"
        subtitle="Manage workers, managers, HR, availability, status, and staff records"
        action={canManageStaff && (
          <Button variant="primary" icon={<PlusIcon size={16} />} onClick={() => setCreateOpen(true)}>
            Add Staff
          </Button>
        )}
      />

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card
          className={`p-4 cursor-pointer transition-all ${statusFilter === 'ACTIVE' ? 'ring-2 ring-primary' : ''}`}
          onClick={() => { setStatusFilter('ACTIVE'); setSearchTerm(''); }}
        >
          <p className="text-xs font-semibold text-fg-muted uppercase tracking-widest">Active Staff</p>
          <p className="text-3xl font-bold text-fg font-inter mt-2">{stats.active}</p>
        </Card>
        <Card
          className={`p-4 cursor-pointer transition-all ${statusFilter === 'DEACTIVATED' ? 'ring-2 ring-primary' : ''}`}
          onClick={() => { setStatusFilter('DEACTIVATED'); setSearchTerm(''); }}
        >
          <p className="text-xs font-semibold text-fg-muted uppercase tracking-widest">Deactivated</p>
          <p className="text-3xl font-bold text-danger font-inter mt-2">{stats.deactivated}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs font-semibold text-fg-muted uppercase tracking-widest">Workers</p>
          <p className="text-3xl font-bold text-fg font-inter mt-2">{stats.workers}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs font-semibold text-fg-muted uppercase tracking-widest">Managers/HR</p>
          <p className="text-3xl font-bold text-fg font-inter mt-2">{stats.managers}</p>
        </Card>
      </div>

      {/* Status & Role Filters */}
      <div className="flex flex-wrap gap-2">
        {(['ACTIVE', 'DEACTIVATED'] as UserStatus[]).map((status) => (
          <Button
            key={status}
            variant={statusFilter === status ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => setStatusFilter(status)}
          >
            {status === 'ACTIVE' ? 'Active' : 'Deactivated'}
          </Button>
        ))}
        <div className="w-px bg-neutral-200" />
        {['', ...ROLE_OPTIONS].map((r) => (
          <Button
            key={r || 'all'}
            variant={roleFilter === r ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => setRoleFilter(r)}
          >
            {r ? ROLE_LABELS[r as Role] : 'All Roles'}
          </Button>
        ))}
      </div>

      {/* Search */}
      <div className="relative">
        <MagnifyingGlassIcon size={18} className="absolute left-3 top-1/2 transform -translate-y-1/2 text-fg-muted" />
        <input
          type="text"
          placeholder="Search by name or email…"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full pl-10 pr-4 py-2.5 border border-neutral-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
        />
      </div>

      {/* People Directory */}
      <Card className="overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center">
            <div className="w-8 h-8 rounded-full border-2 border-neutral-200 border-t-primary animate-spin mx-auto mb-3" />
            <p className="text-sm text-fg-muted">Loading staff…</p>
          </div>
        ) : filteredUsers.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-fg font-medium">No staff found</p>
            <p className="text-sm text-fg-muted mt-1">
              {searchTerm ? 'Try adjusting your search' : 'Create a new staff member to get started'}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-neutral-200">
            {filteredUsers.map((u) => (
              <div key={u.id} className="p-4 hover:bg-neutral-50 transition-colors">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-2">
                      <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                        <span className="text-sm font-semibold text-primary">
                          {u.name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()}
                        </span>
                      </div>
                      <div className="min-w-0">
                        <p className="font-semibold text-fg">{u.name}</p>
                        <p className="text-sm text-fg-muted truncate">{u.email}</p>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 mt-2">
                      <Badge variant="info" label={ROLE_LABELS[u.role]} dot={false} />
                      <Badge
                        variant={u.status === 'DEACTIVATED' ? 'danger' : 'success'}
                        label={u.status === 'DEACTIVATED' ? 'Deactivated' : 'Active'}
                        dot={false}
                      />
                      {u.phone && <span className="text-xs text-fg-muted">{u.phone}</span>}
                      <span className="text-xs text-fg-muted">
                        Since {new Date(u.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' })}
                      </span>
                    </div>
                    {u.status === 'DEACTIVATED' && u.deactivationReason && (
                      <p className="mt-2 text-sm text-danger">Reason: {u.deactivationReason}</p>
                    )}
                  </div>
                  <div className="flex gap-2 flex-shrink-0">
                    {isHR && u.role === 'WORKER' && u.status !== 'DEACTIVATED' && (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => setAssignOpen({ id: u.id, name: u.name })}
                      >
                        Assign House
                      </Button>
                    )}
                    {canManageStaff && u.id !== user?.id && u.status !== 'DEACTIVATED' && (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          setDeactivateOpen({ id: u.id, name: u.name, email: u.email });
                          setDeactivationReason('');
                          setDeactivationError('');
                        }}
                      >
                        Deactivate
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Create Modal */}
      <Modal open={createOpen} onClose={() => { setCreateOpen(false); setCreateError(''); }} title="Add Staff Member">
        <form onSubmit={handleCreate} className="space-y-4">
          <p className="text-sm text-fg-muted">Create a new staff member account. They will receive login details via email.</p>

          <div>
            <label className="block text-sm font-medium text-fg mb-1.5">Full Name *</label>
            <input
              type="text"
              placeholder="Jane Smith"
              className="w-full px-3 py-2 border border-neutral-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-fg mb-1.5">Email *</label>
            <input
              type="email"
              placeholder="jane@company.com"
              className="w-full px-3 py-2 border border-neutral-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-fg mb-1.5">Phone (optional)</label>
              <input
                type="tel"
                placeholder="+44 7700 900123"
                className="w-full px-3 py-2 border border-neutral-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-fg mb-1.5">Role *</label>
              <select
                className="w-full px-3 py-2 border border-neutral-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value as Role })}
              >
                {ROLE_OPTIONS.map((r) => (
                  <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-fg mb-1.5">Temporary Password *</label>
            <input
              type="password"
              placeholder="Must be at least 8 characters"
              className="w-full px-3 py-2 border border-neutral-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              value={form.temporaryPassword}
              onChange={(e) => setForm({ ...form, temporaryPassword: e.target.value })}
              required
            />
            <p className="text-xs text-fg-muted mt-1">They must change this password on first login.</p>
          </div>

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
          <div>
            <label className="block text-sm font-medium text-fg mb-1.5">House *</label>
            <select
              className="w-full px-3 py-2 border border-neutral-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              value={assignHouseId}
              onChange={(e) => setAssignHouseId(e.target.value)}
              required
            >
              <option value="">Select house…</option>
              {houses.map((h) => (
                <option key={h.id} value={h.id}>{h.name}</option>
              ))}
            </select>
          </div>
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
          <div className="bg-warning/10 border border-warning/20 rounded-lg p-4 text-sm">
            <p className="font-medium text-warning mb-1">Account will be blocked</p>
            <p className="text-fg-muted">
              This will prevent login and API access for {deactivateOpen?.email}. All historical data remains in the system.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-fg mb-1.5">Reason for Deactivation *</label>
            <textarea
              className="w-full px-3 py-2 border border-neutral-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
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
          </div>

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
    </div>
  );
}
