'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeftIcon, PlusIcon, PencilIcon, MapPinIcon, UsersIcon, TrashIcon } from '@phosphor-icons/react';
import { Header } from '@/components/layout/Header';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { LoadingOverlay } from '@/components/ui/LoadingOverlay';
import { useHouse, useUpdateHouse, useUpdateHouseManager } from '@/hooks/useHouses';
import { useSupportedPeople, useCreateSupportedPerson, useDeleteSupportedPerson } from '@/hooks/useSupportedPeople';
import { useUsers } from '@/hooks/useWorkers';
import { useAuthStore } from '@/store/authStore';
import { useToast } from '@/hooks/useToast';

function formatDate(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function ServiceDetailPage() {
  const params = useParams<{ id: string }>();
  const houseId = params.id;
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const toast = useToast();

  const { data: house, isLoading: houseLoading } = useHouse(houseId);
  const { data: people = [], isLoading: peopleLoading } = useSupportedPeople(houseId);
  const { data: managers = [] } = useUsers('MANAGER');
  const createPerson = useCreateSupportedPerson(houseId);
  const deletePerson = useDeleteSupportedPerson(houseId);
  const updateManager = useUpdateHouseManager();
  const updateHouse = useUpdateHouse();

  const canManagePeople = ['HR', 'MANAGER'].includes(user?.role ?? '');
  const canEditService = ['HR', 'MANAGER'].includes(user?.role ?? '');
  const isHR = user?.role === 'HR';

  const [addOpen, setAddOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<{ id: string; name: string } | null>(null);
  const [managerOpen, setManagerOpen] = useState(false);
  const [managerSelection, setManagerSelection] = useState('');
  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState({ name: '', address: '', latitude: '', longitude: '', geofenceRadius: '', assignedHours: '' });
  const [editError, setEditError] = useState('');
  const [form, setForm] = useState({ name: '', dateOfBirth: '', emergencyContactName: '', emergencyContactPhone: '' });
  const [error, setError] = useState('');

  async function handleChangeManager(e: React.FormEvent) {
    e.preventDefault();
    try {
      await updateManager.mutateAsync({ id: houseId, managerId: managerSelection || null });
      setManagerOpen(false);
      toast.success('Manager updated');
    } catch {
      toast.error('Failed to update manager');
    }
  }

  function openEdit() {
    if (!house) return;
    setEditForm({
      name: house.name,
      address: house.address,
      latitude: String(house.latitude),
      longitude: String(house.longitude),
      geofenceRadius: String(house.geofenceRadius),
      assignedHours: house.assignedHours != null ? String(house.assignedHours) : '',
    });
    setEditError('');
    setEditOpen(true);
  }

  async function handleEditService(e: React.FormEvent) {
    e.preventDefault();
    setEditError('');
    try {
      if (!editForm.name.trim() || !editForm.address.trim()) {
        setEditError('Name and address are required');
        return;
      }
      const lat = parseFloat(editForm.latitude);
      const lon = parseFloat(editForm.longitude);
      if (isNaN(lat) || isNaN(lon)) {
        setEditError('Latitude and longitude must be valid numbers');
        return;
      }
      await updateHouse.mutateAsync({
        id: houseId,
        name: editForm.name.trim(),
        address: editForm.address.trim(),
        latitude: lat,
        longitude: lon,
        geofenceRadius: parseInt(editForm.geofenceRadius, 10) || undefined,
        assignedHours: editForm.assignedHours ? parseFloat(editForm.assignedHours) : null,
      });
      setEditOpen(false);
      toast.success('Service updated');
    } catch (e: any) {
      const fields = e.response?.data?.error?.fields;
      setEditError(fields ? Object.values(fields).join('. ') : e.response?.data?.message ?? 'Failed to update service');
    }
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    try {
      await createPerson.mutateAsync({
        name: form.name.trim(),
        ...(form.dateOfBirth ? { dateOfBirth: form.dateOfBirth } : {}),
        ...(form.emergencyContactName.trim() ? { emergencyContactName: form.emergencyContactName.trim() } : {}),
        ...(form.emergencyContactPhone.trim() ? { emergencyContactPhone: form.emergencyContactPhone.trim() } : {}),
      });
      setAddOpen(false);
      setForm({ name: '', dateOfBirth: '', emergencyContactName: '', emergencyContactPhone: '' });
      toast.success('Person added');
    } catch (e: any) {
      const fields = e.response?.data?.error?.fields;
      setError(fields ? Object.values(fields).join('. ') : e.response?.data?.message ?? 'Failed to add person');
    }
  }

  async function handleRemove() {
    if (!removeTarget) return;
    try {
      await deletePerson.mutateAsync(removeTarget.id);
      toast.success(`${removeTarget.name} removed`);
      setRemoveTarget(null);
    } catch {
      toast.error('Failed to remove person');
    }
  }

  if (houseLoading) {
    return (
      <div className="p-12 text-center">
        <div className="w-8 h-8 rounded-full border-2 border-neutral-200 border-t-primary animate-spin mx-auto mb-3" />
        <p className="text-sm text-fg-muted">Loading service…</p>
      </div>
    );
  }

  if (!house) {
    return (
      <div className="p-12 text-center">
        <p className="text-fg font-medium">Service not found</p>
        <Button variant="secondary" className="mt-4" onClick={() => router.push('/dashboard/houses')}>
          Back to Services
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <Link href="/dashboard/houses" className="inline-flex items-center gap-1.5 text-sm text-fg-muted hover:text-fg transition-colors">
        <ArrowLeftIcon size={14} /> Back to Services
      </Link>

      <Header
        title={house.name}
        subtitle={house.address}
        action={(canEditService || isHR) && (
          <div className="flex items-center gap-2">
            {canEditService && (
              <Button variant="secondary" size="sm" icon={<PencilIcon size={16} />} onClick={openEdit}>
                Edit Service
              </Button>
            )}
            {isHR && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => { setManagerSelection(house.managerId ?? ''); setManagerOpen(true); }}
              >
                {house.manager ? `Manager: ${house.manager.name}` : 'Assign Manager'}
              </Button>
            )}
          </div>
        )}
      />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card className="p-4">
          <p className="text-xs font-semibold text-fg-muted uppercase tracking-widest">Geofence</p>
          <p className="text-2xl font-bold text-fg font-inter mt-2">{house.geofenceRadius}m</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs font-semibold text-fg-muted uppercase tracking-widest">Staff Assigned</p>
          <p className="text-2xl font-bold text-fg font-inter mt-2">{house.workers?.length ?? 0}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs font-semibold text-fg-muted uppercase tracking-widest">People Supported</p>
          <p className="text-2xl font-bold text-fg font-inter mt-2">{people.length}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs font-semibold text-fg-muted uppercase tracking-widest">Assigned Hours/wk</p>
          <p className="text-2xl font-bold text-fg font-inter mt-2">{house.assignedHours != null ? `${house.assignedHours}h` : '—'}</p>
        </Card>
      </div>

      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-fg">People We Support</h2>
          {canManagePeople && (
            <Button variant="primary" size="sm" icon={<PlusIcon size={16} />} onClick={() => setAddOpen(true)}>
              Add Person
            </Button>
          )}
        </div>
        <Card className="overflow-hidden">
          {peopleLoading ? (
            <div className="p-8 text-center">
              <div className="w-8 h-8 rounded-full border-2 border-neutral-200 border-t-primary animate-spin mx-auto mb-3" />
              <p className="text-sm text-fg-muted">Loading…</p>
            </div>
          ) : people.length === 0 ? (
            <div className="p-12 text-center">
              <UsersIcon size={32} className="mx-auto text-fg-muted/30 mb-3" />
              <p className="text-fg font-medium">No one added yet</p>
              <p className="text-sm text-fg-muted mt-1">
                {canManagePeople ? 'Add the people this service supports.' : 'Nobody has been added to this service yet.'}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-neutral-200">
              {people.map((p) => (
                <div key={p.id} className="p-4 flex items-center justify-between hover:bg-neutral-50 transition-colors">
                  <div className="min-w-0">
                    <p className="font-semibold text-fg">{p.name}</p>
                    <p className="text-sm text-fg-muted mt-1">
                      DOB: {formatDate(p.dateOfBirth)}
                      {p.emergencyContactName && ` • Emergency contact: ${p.emergencyContactName}`}
                      {p.emergencyContactPhone && ` (${p.emergencyContactPhone})`}
                    </p>
                  </div>
                  {canManagePeople && (
                    <button
                      onClick={() => setRemoveTarget({ id: p.id, name: p.name })}
                      className="p-1.5 rounded text-fg-muted hover:text-danger hover:bg-danger/10 transition-colors flex-shrink-0"
                      aria-label={`Remove ${p.name}`}
                    >
                      <TrashIcon size={16} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>
      </section>

      <Modal open={addOpen} onClose={() => { setAddOpen(false); setError(''); }} title="Add Person">
        <form onSubmit={handleAdd} className="space-y-4">
          <LoadingOverlay show={createPerson.isPending} label="Adding…" />
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
            <label className="block text-sm font-medium text-fg mb-1.5">Date of Birth</label>
            <input
              type="date"
              className="w-full px-3 py-2 border border-neutral-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              value={form.dateOfBirth}
              onChange={(e) => setForm({ ...form, dateOfBirth: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-fg mb-1.5">Emergency Contact Name</label>
              <input
                type="text"
                placeholder="Next of kin"
                className="w-full px-3 py-2 border border-neutral-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                value={form.emergencyContactName}
                onChange={(e) => setForm({ ...form, emergencyContactName: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-fg mb-1.5">Emergency Contact Phone</label>
              <input
                type="tel"
                placeholder="+44 7700 900123"
                className="w-full px-3 py-2 border border-neutral-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                value={form.emergencyContactPhone}
                onChange={(e) => setForm({ ...form, emergencyContactPhone: e.target.value })}
              />
            </div>
          </div>

          {error && (
            <div className="bg-danger/10 border border-danger/20 rounded-lg p-3 text-sm text-danger">
              {error}
            </div>
          )}

          <div className="flex gap-2 justify-end pt-4">
            <Button variant="secondary" onClick={() => { setAddOpen(false); setError(''); }}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" disabled={createPerson.isPending}>
              {createPerson.isPending ? 'Adding…' : 'Add Person'}
            </Button>
          </div>
        </form>
      </Modal>

      <Modal open={!!removeTarget} onClose={() => setRemoveTarget(null)} title={`Remove ${removeTarget?.name}`}>
        <div className="space-y-4">
          <LoadingOverlay show={deletePerson.isPending} label="Removing…" />
          <p className="text-sm text-fg-muted">
            This removes {removeTarget?.name} from {house.name}. This can't be undone.
          </p>
          <div className="flex gap-2 justify-end pt-2">
            <Button variant="secondary" onClick={() => setRemoveTarget(null)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={handleRemove} disabled={deletePerson.isPending}>
              {deletePerson.isPending ? 'Removing…' : 'Remove'}
            </Button>
          </div>
        </div>
      </Modal>

      {canEditService && (
        <Modal open={editOpen} onClose={() => { setEditOpen(false); setEditError(''); }} title="Edit Service">
          <form onSubmit={handleEditService} className="space-y-4">
            <LoadingOverlay show={updateHouse.isPending} label="Saving…" />
            <div>
              <label className="block text-sm font-medium text-fg mb-1.5">Service Name *</label>
              <input
                type="text"
                className="w-full px-3 py-2 border border-neutral-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                value={editForm.name}
                onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-fg mb-1.5">Full Address *</label>
              <input
                type="text"
                className="w-full px-3 py-2 border border-neutral-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                value={editForm.address}
                onChange={(e) => setEditForm({ ...editForm, address: e.target.value })}
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-fg mb-1.5">Latitude *</label>
                <input
                  type="number"
                  step="0.0001"
                  className="w-full px-3 py-2 border border-neutral-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  value={editForm.latitude}
                  onChange={(e) => setEditForm({ ...editForm, latitude: e.target.value })}
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-fg mb-1.5">Longitude *</label>
                <input
                  type="number"
                  step="0.0001"
                  className="w-full px-3 py-2 border border-neutral-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  value={editForm.longitude}
                  onChange={(e) => setEditForm({ ...editForm, longitude: e.target.value })}
                  required
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-fg mb-1.5">Geofence Radius (m) *</label>
                <input
                  type="number"
                  min="10"
                  max="500"
                  className="w-full px-3 py-2 border border-neutral-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  value={editForm.geofenceRadius}
                  onChange={(e) => setEditForm({ ...editForm, geofenceRadius: e.target.value })}
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-fg mb-1.5">Assigned Hours (per week)</label>
                <input
                  type="number"
                  min="0"
                  step="0.5"
                  className="w-full px-3 py-2 border border-neutral-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  value={editForm.assignedHours}
                  onChange={(e) => setEditForm({ ...editForm, assignedHours: e.target.value })}
                />
              </div>
            </div>

            {editError && (
              <div className="bg-danger/10 border border-danger/20 rounded-lg p-3 text-sm text-danger">
                {editError}
              </div>
            )}

            <div className="flex gap-2 justify-end pt-2">
              <Button variant="secondary" onClick={() => { setEditOpen(false); setEditError(''); }}>
                Cancel
              </Button>
              <Button variant="primary" type="submit" disabled={updateHouse.isPending}>
                {updateHouse.isPending ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {isHR && (
        <Modal open={managerOpen} onClose={() => setManagerOpen(false)} title={`Manager — ${house.name}`}>
          <form onSubmit={handleChangeManager} className="space-y-4">
            <LoadingOverlay show={updateManager.isPending} label="Saving…" />
            <div>
              <label className="block text-sm font-medium text-fg mb-1.5">Manager</label>
              <select
                className="w-full px-3 py-2 border border-neutral-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                value={managerSelection}
                onChange={(e) => setManagerSelection(e.target.value)}
              >
                <option value="">No manager</option>
                {managers.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
            </div>
            <div className="flex gap-2 justify-end pt-2">
              <Button variant="secondary" onClick={() => setManagerOpen(false)}>
                Cancel
              </Button>
              <Button variant="primary" type="submit" disabled={updateManager.isPending}>
                {updateManager.isPending ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
