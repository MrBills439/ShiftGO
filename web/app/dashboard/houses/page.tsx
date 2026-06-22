'use client';
import { useState } from 'react';
import { PlusIcon, BuildingsIcon, MapPinIcon, UsersIcon, PencilIcon } from '@phosphor-icons/react';
import { Header } from '@/components/layout/Header';
import { Modal } from '@/components/ui/Modal';
import { EmptyState } from '@/components/ui/EmptyState';
import { CardsSkeleton } from '@/components/ui/Skeleton';
import { useHouses, useCreateHouse, useUpdateGeofence } from '@/hooks/useHouses';
import { useUsers } from '@/hooks/useWorkers';
import { useAuthStore } from '@/store/authStore';
import { useToast } from '@/hooks/useToast';

export default function HousesPage() {
  const user = useAuthStore((s) => s.user);
  const { data: houses = [], isLoading } = useHouses();
  const { data: managers = [] } = useUsers('MANAGER');
  const createHouse = useCreateHouse();
  const updateGeofence = useUpdateGeofence();
  const toast = useToast();

  const [createOpen, setCreateOpen] = useState(false);
  const [geofenceHouse, setGeofenceHouse] = useState<{ id: string; name: string; radius: number } | null>(null);
  const [form, setForm] = useState({ name: '', address: '', latitude: '', longitude: '', geofenceRadius: '50', managerId: '' });
  const [radius, setRadius] = useState('50');
  const [err, setErr] = useState('');

  const isHR = user?.role === 'HR';

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    try {
      await createHouse.mutateAsync({
        ...form,
        latitude: parseFloat(form.latitude),
        longitude: parseFloat(form.longitude),
        geofenceRadius: parseInt(form.geofenceRadius, 10),
        managerId: form.managerId || undefined,
      });
      setCreateOpen(false);
      setForm({ name: '', address: '', latitude: '', longitude: '', geofenceRadius: '50', managerId: '' });
      toast.success('House created successfully');
    } catch (e: any) {
      setErr(e.response?.data?.message ?? 'Failed to create house');
    }
  }

  async function handleUpdateGeofence(e: React.FormEvent) {
    e.preventDefault();
    if (!geofenceHouse) return;
    try {
      await updateGeofence.mutateAsync({ id: geofenceHouse.id, radius: parseInt(radius, 10) });
      setGeofenceHouse(null);
      toast.success('Geofence radius updated');
    } catch {
      toast.error('Failed to update geofence radius');
    }
  }

  return (
    <div>
      <Header
        title="Houses"
        subtitle="Care locations and geofence configuration"
        action={isHR && (
          <button onClick={() => setCreateOpen(true)} className="btn-primary">
            <PlusIcon size={16} /> New House
          </button>
        )}
      />

      {isLoading ? (
        <CardsSkeleton count={3} />
      ) : houses.length === 0 ? (
        <EmptyState
          icon={BuildingsIcon}
          title="No houses yet"
          description="Add your first care house to get started."
          action={isHR && <button onClick={() => setCreateOpen(true)} className="btn-primary">New House</button>}
        />
      ) : (
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
          {houses.map((h) => (
            <div key={h.id} className="glass-card p-5 flex flex-col gap-3">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-lg bg-[#e6f4f0] flex items-center justify-center flex-shrink-0">
                    <BuildingsIcon size={18} className="text-primary-DEFAULT" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-on-surface">{h.name}</p>
                    {h.manager && <p className="text-xs text-on-surface-variant font-inter">{h.manager.name}</p>}
                  </div>
                </div>
                {isHR && (
                  <button
                    onClick={() => { setGeofenceHouse({ id: h.id, name: h.name, radius: h.geofenceRadius }); setRadius(String(h.geofenceRadius)); }}
                    className="p-1.5 rounded-md text-outline-DEFAULT hover:bg-surface-low hover:text-primary-DEFAULT transition-colors"
                    aria-label="Edit geofence"
                  >
                    <PencilIcon size={15} />
                  </button>
                )}
              </div>

              <div className="flex items-start gap-2">
                <MapPinIcon size={13} className="text-on-surface-variant mt-0.5 flex-shrink-0" weight="regular" />
                <p className="text-xs text-on-surface-variant leading-relaxed">{h.address}</p>
              </div>

              <div className="h-px bg-outline-variant/40" />

              <div className="grid grid-cols-2 gap-2 text-center">
                <div className="bg-surface-low rounded-md py-2 px-3">
                  <p className="text-base font-bold text-primary-DEFAULT">{h.geofenceRadius}m</p>
                  <p className="text-[10px] uppercase tracking-wider font-semibold text-on-surface-variant font-inter mt-0.5">Geofence</p>
                </div>
                <div className="bg-surface-low rounded-md py-2 px-3">
                  <div className="flex items-center justify-center gap-1">
                    <UsersIcon size={14} className="text-on-surface-variant" />
                    <p className="text-base font-bold text-on-surface">{h.workers?.length ?? 0}</p>
                  </div>
                  <p className="text-[10px] uppercase tracking-wider font-semibold text-on-surface-variant font-inter mt-0.5">Workers</p>
                </div>
              </div>

              <div className="flex items-center justify-between text-[11px] font-inter">
                <span className={`px-2 py-0.5 rounded-full font-semibold ${h.autoConfirm ? 'bg-[#e6f4f0] text-primary-DEFAULT' : 'bg-surface-high text-on-surface-variant'}`}>
                  {h.autoConfirm ? 'Auto-confirm ON' : 'Manual confirm'}
                </span>
                <span className="text-on-surface-variant font-mono text-[10px]">
                  {h.latitude.toFixed(4)}, {h.longitude.toFixed(4)}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal open={createOpen} onClose={() => { setCreateOpen(false); setErr(''); }} title="Add House">
        <form onSubmit={handleCreate} className="space-y-4">
          {[['name', 'House Name', 'text', 'Maple House'],
            ['address', 'Full Address', 'text', '10 Maple Street, London E1 1AA'],
          ].map(([field, label, type, ph]) => (
            <div key={field}>
              <label className="block text-xs font-semibold tracking-wider uppercase text-on-surface-variant font-inter mb-1.5">{label}</label>
              <input type={type} placeholder={ph} className="input-field" value={(form as any)[field]} onChange={(e) => setForm({ ...form, [field]: e.target.value })} required />
            </div>
          ))}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold tracking-wider uppercase text-on-surface-variant font-inter mb-1.5">Latitude</label>
              <input type="number" step="any" placeholder="51.5145" className="input-field" value={form.latitude} onChange={(e) => setForm({ ...form, latitude: e.target.value })} required />
            </div>
            <div>
              <label className="block text-xs font-semibold tracking-wider uppercase text-on-surface-variant font-inter mb-1.5">Longitude</label>
              <input type="number" step="any" placeholder="-0.0731" className="input-field" value={form.longitude} onChange={(e) => setForm({ ...form, longitude: e.target.value })} required />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold tracking-wider uppercase text-on-surface-variant font-inter mb-1.5">Geofence (m)</label>
              <input type="number" min="10" className="input-field" value={form.geofenceRadius} onChange={(e) => setForm({ ...form, geofenceRadius: e.target.value })} />
            </div>
            <div>
              <label className="block text-xs font-semibold tracking-wider uppercase text-on-surface-variant font-inter mb-1.5">Manager</label>
              <select className="input-field" value={form.managerId} onChange={(e) => setForm({ ...form, managerId: e.target.value })}>
                <option value="">No manager</option>
                {managers.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>
          </div>
          {err && <p className="text-sm text-error-DEFAULT bg-error-container rounded-md px-3 py-2">{err}</p>}
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={() => { setCreateOpen(false); setErr(''); }} className="btn-secondary flex-1 justify-center">Cancel</button>
            <button type="submit" disabled={createHouse.isPending} className="btn-primary flex-1 justify-center">
              {createHouse.isPending ? 'Creating…' : 'Create House'}
            </button>
          </div>
        </form>
      </Modal>

      <Modal open={!!geofenceHouse} onClose={() => setGeofenceHouse(null)} title={`Edit Geofence — ${geofenceHouse?.name}`} width="max-w-sm">
        <form onSubmit={handleUpdateGeofence} className="space-y-4">
          <p className="text-sm text-on-surface-variant">Set the radius (in metres) workers must be within to trigger auto clock-in.</p>
          <div>
            <label className="block text-xs font-semibold tracking-wider uppercase text-on-surface-variant font-inter mb-1.5">Radius (metres)</label>
            <input type="number" min="10" max="500" value={radius} onChange={(e) => setRadius(e.target.value)} className="input-field" />
          </div>
          <div className="flex gap-3">
            <button type="button" onClick={() => setGeofenceHouse(null)} className="btn-secondary flex-1 justify-center">Cancel</button>
            <button type="submit" disabled={updateGeofence.isPending} className="btn-primary flex-1 justify-center">
              {updateGeofence.isPending ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
