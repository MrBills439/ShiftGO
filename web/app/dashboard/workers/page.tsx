'use client';
import { useState } from 'react';
import { PlusIcon, UsersIcon } from '@phosphor-icons/react';
import { Header } from '@/components/layout/Header';
import { Modal } from '@/components/ui/Modal';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { TableSkeleton } from '@/components/ui/Skeleton';
import { useUsers, useCreateUser, useAssignWorker } from '@/hooks/useWorkers';
import { useHouses } from '@/hooks/useHouses';
import { useAuthStore } from '@/store/authStore';
import { useToast } from '@/hooks/useToast';
import type { Role } from '@/types';

const ROLE_OPTIONS: Role[] = ['WORKER', 'TEAM_LEADER', 'MANAGER', 'HR'];

export default function WorkersPage() {
  const user = useAuthStore((s) => s.user);
  const { data: users = [], isLoading } = useUsers();
  const { data: houses = [] } = useHouses();
  const createUser = useCreateUser();
  const assignWorker = useAssignWorker();
  const toast = useToast();

  const [createOpen, setCreateOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState<{ id: string; name: string } | null>(null);
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'WORKER' as Role });
  const [assignHouseId, setAssignHouseId] = useState('');
  const [err, setErr] = useState('');
  const [filterRole, setFilterRole] = useState('');

  const isHR = user?.role === 'HR';
  const filtered = filterRole ? users.filter((u) => u.role === filterRole) : users;

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    try {
      await createUser.mutateAsync({ ...form });
      setCreateOpen(false);
      setForm({ name: '', email: '', password: '', role: 'WORKER' });
      toast.success('User created successfully');
    } catch (e: any) {
      setErr(e.response?.data?.message ?? 'Failed to create user');
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

  return (
    <div>
      <Header
        title="Workers"
        subtitle="Manage staff accounts and house assignments"
        action={isHR && (
          <button onClick={() => setCreateOpen(true)} className="btn-primary">
            <PlusIcon size={16} /> New User
          </button>
        )}
      />

      <div className="flex gap-2 mb-5 flex-wrap">
        {['', ...ROLE_OPTIONS].map((r) => (
          <button
            key={r}
            onClick={() => setFilterRole(r)}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold font-inter transition-colors ${filterRole === r ? 'bg-primary-DEFAULT text-white' : 'bg-surface-high text-on-surface-variant hover:bg-surface-highest'}`}
          >
            {r ? r.replace('_', ' ') : 'All Roles'}
          </button>
        ))}
      </div>

      {isLoading ? (
        <TableSkeleton cols={5} rows={6} />
      ) : filtered.length === 0 ? (
        <EmptyState icon={UsersIcon} title="No users found" />
      ) : (
        <div className="glass-card overflow-hidden">
          <table className="w-full">
            <thead>
              <tr>
                {['Name', 'Email', 'Role', 'Since', ''].map((h) => (
                  <th key={h} className="table-th">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((u) => (
                <tr key={u.id} className="hover:bg-surface-lowest/60 transition-colors">
                  <td className="table-td">
                    <div className="flex items-center gap-2.5">
                      <div className="w-7 h-7 rounded-full bg-primary-container flex items-center justify-center flex-shrink-0">
                        <span className="text-[10px] font-bold text-primary-DEFAULT">
                          {u.name.split(' ').map((n) => n[0]).join('').slice(0, 2)}
                        </span>
                      </div>
                      <span className="font-medium">{u.name}</span>
                    </div>
                  </td>
                  <td className="table-td text-on-surface-variant font-inter text-xs">{u.email}</td>
                  <td className="table-td">
                    <Badge variant={u.role.toLowerCase() as any} label={u.role.replace('_', ' ')} />
                  </td>
                  <td className="table-td text-on-surface-variant font-inter text-xs">
                    {new Date(u.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </td>
                  <td className="table-td">
                    {isHR && u.role === 'WORKER' && (
                      <button
                        onClick={() => setAssignOpen({ id: u.id, name: u.name })}
                        className="text-xs text-primary-DEFAULT hover:underline font-inter"
                      >
                        Assign house
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={createOpen} onClose={() => { setCreateOpen(false); setErr(''); }} title="Create User">
        <form onSubmit={handleCreate} className="space-y-4">
          {[['name', 'Full Name', 'text', 'Jane Smith'], ['email', 'Email', 'email', 'jane@company.com'], ['password', 'Password', 'password', '']].map(([f, l, t, p]) => (
            <div key={f}>
              <label className="block text-xs font-semibold tracking-wider uppercase text-on-surface-variant font-inter mb-1.5">{l}</label>
              <input type={t} placeholder={p} className="input-field" value={(form as any)[f]} onChange={(e) => setForm({ ...form, [f]: e.target.value })} required />
            </div>
          ))}
          <div>
            <label className="block text-xs font-semibold tracking-wider uppercase text-on-surface-variant font-inter mb-1.5">Role</label>
            <select className="input-field" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
              {ROLE_OPTIONS.map((r) => <option key={r} value={r}>{r.replace('_', ' ')}</option>)}
            </select>
          </div>
          {err && <p className="text-sm text-error-DEFAULT bg-error-container rounded-md px-3 py-2">{err}</p>}
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={() => { setCreateOpen(false); setErr(''); }} className="btn-secondary flex-1 justify-center">Cancel</button>
            <button type="submit" disabled={createUser.isPending} className="btn-primary flex-1 justify-center">
              {createUser.isPending ? 'Creating…' : 'Create User'}
            </button>
          </div>
        </form>
      </Modal>

      <Modal open={!!assignOpen} onClose={() => setAssignOpen(null)} title={`Assign ${assignOpen?.name} to House`} width="max-w-sm">
        <form onSubmit={handleAssign} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold tracking-wider uppercase text-on-surface-variant font-inter mb-1.5">House</label>
            <select className="input-field" value={assignHouseId} onChange={(e) => setAssignHouseId(e.target.value)} required>
              <option value="">Select house…</option>
              {houses.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
            </select>
          </div>
          <div className="flex gap-3">
            <button type="button" onClick={() => setAssignOpen(null)} className="btn-secondary flex-1 justify-center">Cancel</button>
            <button type="submit" disabled={assignWorker.isPending} className="btn-primary flex-1 justify-center">
              {assignWorker.isPending ? 'Assigning…' : 'Assign'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
