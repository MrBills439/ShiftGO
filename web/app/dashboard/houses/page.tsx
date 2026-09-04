'use client';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { PlusIcon, BuildingsIcon, MapPinIcon, UsersIcon, PencilIcon, MagnifyingGlassIcon } from '@phosphor-icons/react';
import { Header } from '@/components/layout/Header';
import { Modal } from '@/components/ui/Modal';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { LoadingOverlay } from '@/components/ui/LoadingOverlay';
import { useHouses, useCreateHouse, useUpdateGeofence } from '@/hooks/useHouses';
import { useUsers } from '@/hooks/useWorkers';
import { useShifts } from '@/hooks/useShifts';
import { useAuthStore } from '@/store/authStore';
import { useToast } from '@/hooks/useToast';

export default function ServicesPage() {
  const user = useAuthStore((s) => s.user);
  const router = useRouter();
  const { data: houses = [], isLoading } = useHouses();
  const { data: managers = [] } = useUsers('MANAGER');
  const { data: shifts = [] } = useShifts();
  const createHouse = useCreateHouse();
  const updateGeofence = useUpdateGeofence();
  const toast = useToast();

  const [createOpen, setCreateOpen] = useState(false);
  const [geofenceHouse, setGeofenceHouse] = useState<{ id: string; name: string; radius: number } | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [form, setForm] = useState({ name: '', address: '', latitude: '', longitude: '', geofenceRadius: '50', managerId: '', assignedHours: '' });
  const [radius, setRadius] = useState('50');
  const [createError, setCreateError] = useState('');

  const isHR = user?.role === 'HR';
  const canCreateService = ['HR', 'MANAGER'].includes(user?.role ?? '');

  // Calculate summary stats
  const stats = useMemo(() => {
    const now = new Date();
    const todayString = now.toDateString();
    const todayShifts = shifts.filter((s) => new Date(s.date).toDateString() === todayString && s.status !== 'CANCELLED');

    return {
      total: houses.length,
      active: houses.length,
      staffAssigned: houses.reduce((sum, h) => sum + (h.workers?.length ?? 0), 0),
      todayShifts: todayShifts.length,
    };
  }, [houses, shifts]);

  // Filter locations by search
  const filteredServices = useMemo(() => {
    if (!searchTerm) return houses;
    const query = searchTerm.toLowerCase();
    return houses.filter((h) => h.name.toLowerCase().includes(query) || h.address.toLowerCase().includes(query));
  }, [houses, searchTerm]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreateError('');
    try {
      if (!form.name.trim() || !form.address.trim() || !form.latitude || !form.longitude) {
        setCreateError('All location details are required');
        return;
      }

      const lat = parseFloat(form.latitude);
      const lon = parseFloat(form.longitude);
      if (isNaN(lat) || isNaN(lon)) {
        setCreateError('Latitude and longitude must be valid numbers');
        return;
      }

      const res = await createHouse.mutateAsync({
        name: form.name.trim(),
        address: form.address.trim(),
        latitude: lat,
        longitude: lon,
        geofenceRadius: parseInt(form.geofenceRadius, 10),
        managerId: form.managerId || undefined,
        assignedHours: form.assignedHours ? parseFloat(form.assignedHours) : undefined,
      });
      setCreateOpen(false);
      setForm({ name: '', address: '', latitude: '', longitude: '', geofenceRadius: '50', managerId: '', assignedHours: '' });
      toast.success('Service created — add the people it supports next');
      router.push(`/dashboard/houses/${res.data.data.id}`);
    } catch (e: any) {
      setCreateError(e.response?.data?.message ?? 'Failed to create service');
    }
  }

  async function handleUpdateGeofence(e: React.FormEvent) {
    e.preventDefault();
    if (!geofenceHouse) return;
    try {
      const rad = parseInt(radius, 10);
      if (isNaN(rad) || rad < 10 || rad > 500) {
        toast.error('Radius must be between 10 and 500 metres');
        return;
      }
      await updateGeofence.mutateAsync({ id: geofenceHouse.id, radius: rad });
      setGeofenceHouse(null);
      toast.success('Geofence radius updated');
    } catch {
      toast.error('Failed to update geofence radius');
    }
  }

  return (
    <div className="space-y-8">
      <Header
        title="Services"
        subtitle="Manage services, sites, geofences, assigned teams, and coverage"
        action={canCreateService && (
          <Button variant="primary" icon={<PlusIcon size={16} />} onClick={() => setCreateOpen(true)}>
            Add Service
          </Button>
        )}
      />

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="p-4">
          <p className="text-xs font-semibold text-fg-muted uppercase tracking-widest">Total Services</p>
          <p className="text-3xl font-bold text-fg font-inter mt-2">{stats.total}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs font-semibold text-fg-muted uppercase tracking-widest">Active Services</p>
          <p className="text-3xl font-bold text-fg font-inter mt-2">{stats.active}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs font-semibold text-fg-muted uppercase tracking-widest">Staff Assigned</p>
          <p className="text-3xl font-bold text-fg font-inter mt-2">{stats.staffAssigned}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs font-semibold text-fg-muted uppercase tracking-widest">Today's Shifts</p>
          <p className="text-3xl font-bold text-fg font-inter mt-2">{stats.todayShifts}</p>
        </Card>
      </div>

      {/* Search */}
      <div className="relative">
        <MagnifyingGlassIcon size={18} className="absolute left-3 top-1/2 transform -translate-y-1/2 text-fg-muted" />
        <input
          type="text"
          placeholder="Search by service name or address…"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full pl-10 pr-4 py-2.5 border border-neutral-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
        />
      </div>

      {/* Services Directory */}
      {isLoading ? (
        <div className="p-8 text-center">
          <div className="w-8 h-8 rounded-full border-2 border-neutral-200 border-t-primary animate-spin mx-auto mb-3" />
          <p className="text-sm text-fg-muted">Loading locations…</p>
        </div>
      ) : filteredServices.length === 0 ? (
        <div className="text-center py-12">
          <BuildingsIcon size={48} className="mx-auto text-fg-muted/30 mb-4" />
          <p className="text-fg font-medium">No services found</p>
          <p className="text-sm text-fg-muted mt-1">
            {searchTerm ? 'Try adjusting your search' : 'Create your first service to get started'}
          </p>
        </div>
      ) : (
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filteredServices.map((h) => {
            const todayShiftsForService = shifts.filter(
              (s) => s.houseId === h.id && new Date(s.date).toDateString() === new Date().toDateString() && s.status !== 'CANCELLED'
            );

            return (
              <Link key={h.id} href={`/dashboard/houses/${h.id}`}>
              <Card className="p-5 flex flex-col gap-4 hover:shadow-md transition-shadow cursor-pointer">
                {/* Header */}
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                      <BuildingsIcon size={20} className="text-primary" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-fg">{h.name}</p>
                      {h.manager && <p className="text-xs text-fg-muted">{h.manager.name}</p>}
                    </div>
                  </div>
                  {canCreateService && (
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={<PencilIcon size={16} />}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setGeofenceHouse({ id: h.id, name: h.name, radius: h.geofenceRadius });
                        setRadius(String(h.geofenceRadius));
                      }}
                      aria-label="Edit geofence"
                    />
                  )}
                </div>

                {/* Address */}
                <div className="flex gap-2 min-w-0">
                  <MapPinIcon size={14} className="text-fg-muted flex-shrink-0 mt-0.5" weight="regular" />
                  <p className="text-xs text-fg-muted truncate">{h.address}</p>
                </div>

                {/* Divider */}
                <div className="h-px bg-neutral-200" />

                {/* Stats */}
                <div className="grid grid-cols-4 gap-2 text-center">
                  <div className="bg-neutral-50 rounded-lg py-2 px-1">
                    <p className="text-sm font-bold text-fg">{h.geofenceRadius}m</p>
                    <p className="text-[10px] text-fg-muted mt-1">Geofence</p>
                  </div>
                  <div className="bg-neutral-50 rounded-lg py-2 px-1">
                    <div className="flex items-center justify-center gap-1">
                      <UsersIcon size={14} className="text-fg-muted" />
                      <p className="text-sm font-bold text-fg">{h.workers?.length ?? 0}</p>
                    </div>
                    <p className="text-[10px] text-fg-muted mt-1">Staff</p>
                  </div>
                  <div className="bg-neutral-50 rounded-lg py-2 px-1">
                    <p className="text-sm font-bold text-fg">{todayShiftsForService.length}</p>
                    <p className="text-[10px] text-fg-muted mt-1">Today</p>
                  </div>
                  <div className="bg-neutral-50 rounded-lg py-2 px-1">
                    <p className="text-sm font-bold text-fg">{h.assignedHours != null ? `${h.assignedHours}h` : '—'}</p>
                    <p className="text-[10px] text-fg-muted mt-1">Hrs/wk</p>
                  </div>
                </div>

                {/* Footer */}
                <div className="flex items-center justify-between text-[11px]">
                  <Badge
                    variant={h.autoConfirm ? 'success' : 'info'}
                    label={h.autoConfirm ? 'Auto-confirm' : 'Manual'}
                    dot={false}
                  />
                  <span className="text-fg-muted font-mono text-[9px]">
                    {h.latitude.toFixed(4)}, {h.longitude.toFixed(4)}
                  </span>
                </div>
              </Card>
              </Link>
            );
          })}
        </div>
      )}

      {/* Create Service Modal */}
      <Modal open={createOpen} onClose={() => { setCreateOpen(false); setCreateError(''); }} title="Add Service">
        <form onSubmit={handleCreate} className="space-y-4">
          <LoadingOverlay show={createHouse.isPending} label="Creating service…" />
          <p className="text-sm text-fg-muted">Create a new service. Set the geofence radius for automatic clock-in.</p>

          <div>
            <label className="block text-sm font-medium text-fg mb-1.5">Service Name *</label>
            <input
              type="text"
              placeholder="Maple House"
              className="w-full px-3 py-2 border border-neutral-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-fg mb-1.5">Full Address *</label>
            <input
              type="text"
              placeholder="10 Maple Street, London E1 1AA"
              className="w-full px-3 py-2 border border-neutral-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-fg mb-1.5">Latitude *</label>
              <input
                type="number"
                step="0.0001"
                placeholder="51.5145"
                className="w-full px-3 py-2 border border-neutral-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                value={form.latitude}
                onChange={(e) => setForm({ ...form, latitude: e.target.value })}
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-fg mb-1.5">Longitude *</label>
              <input
                type="number"
                step="0.0001"
                placeholder="-0.0731"
                className="w-full px-3 py-2 border border-neutral-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                value={form.longitude}
                onChange={(e) => setForm({ ...form, longitude: e.target.value })}
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
                placeholder="50"
                className="w-full px-3 py-2 border border-neutral-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                value={form.geofenceRadius}
                onChange={(e) => setForm({ ...form, geofenceRadius: e.target.value })}
              />
              <p className="text-xs text-fg-muted mt-1">Workers within this radius trigger auto clock-in</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-fg mb-1.5">Service Manager</label>
              {user?.role === 'MANAGER' ? (
                <p className="w-full px-3 py-2 border border-neutral-200 rounded-lg text-sm bg-neutral-50 text-fg-muted">
                  You ({user.name}) — services you create are assigned to you
                </p>
              ) : (
                <select
                  className="w-full px-3 py-2 border border-neutral-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  value={form.managerId}
                  onChange={(e) => setForm({ ...form, managerId: e.target.value })}
                >
                  <option value="">No manager</option>
                  {managers.map((m) => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </select>
              )}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-fg mb-1.5">Assigned Hours (per week)</label>
            <input
              type="number"
              min="0"
              step="0.5"
              placeholder="e.g. 336 for round-the-clock two-person cover"
              className="w-full px-3 py-2 border border-neutral-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              value={form.assignedHours}
              onChange={(e) => setForm({ ...form, assignedHours: e.target.value })}
            />
            <p className="text-xs text-fg-muted mt-1">Total staffing hours budgeted for this service each week</p>
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
              disabled={createHouse.isPending}
            >
              {createHouse.isPending ? 'Creating…' : 'Create Service'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Edit Geofence Modal */}
      <Modal
        open={!!geofenceHouse}
        onClose={() => setGeofenceHouse(null)}
        title={`Edit Geofence — ${geofenceHouse?.name}`}
      >
        <form onSubmit={handleUpdateGeofence} className="space-y-4">
          <LoadingOverlay show={updateGeofence.isPending} label="Saving…" />
          <p className="text-sm text-fg-muted">
            Set the radius in metres. Workers within this distance trigger automatic clock-in when they arrive at the location.
          </p>
          <div>
            <label className="block text-sm font-medium text-fg mb-1.5">Radius (metres) *</label>
            <input
              type="number"
              min="10"
              max="500"
              className="w-full px-3 py-2 border border-neutral-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              value={radius}
              onChange={(e) => setRadius(e.target.value)}
            />
            <p className="text-xs text-fg-muted mt-1">Recommended: 50-100m for accuracy</p>
          </div>
          <div className="flex gap-2 justify-end pt-4">
            <Button variant="secondary" onClick={() => setGeofenceHouse(null)}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" disabled={updateGeofence.isPending}>
              {updateGeofence.isPending ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
