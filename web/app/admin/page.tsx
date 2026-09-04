'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { BuildingsIcon, UsersIcon, MapPinIcon, ShieldCheckIcon } from '@phosphor-icons/react';
import { Header } from '@/components/layout/Header';
import { useAuthStore } from '@/store/authStore';
import { useHouses, useUpdateGeofence } from '@/hooks/useHouses';
import { useUsers } from '@/hooks/useWorkers';
import { useToast } from '@/hooks/useToast';

export default function AdminPage() {
  const { user, isLoading } = useAuthStore();
  const router = useRouter();
  const { data: houses = [] } = useHouses();
  const { data: allUsers = [] } = useUsers();
  const updateGeofence = useUpdateGeofence();
  const toast = useToast();
  const [globalRadius, setGlobalRadius] = useState('50');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isLoading && user && user.role !== 'HR') router.replace('/dashboard');
  }, [user, isLoading]);

  async function applyGlobalGeofence() {
    setSaving(true);
    try {
      const radius = parseInt(globalRadius, 10);
      await Promise.all(houses.map((h) => updateGeofence.mutateAsync({ id: h.id, radius })));
      toast.success(`Geofence radius set to ${radius}m on all ${houses.length} houses`);
    } catch {
      toast.error('Failed to apply geofence radius to some houses');
    } finally {
      setSaving(false);
    }
  }

  const byRole = (r: string) => allUsers.filter((u) => u.role === r).length;

  if (isLoading || !user) return null;
  if (user.role !== 'HR') return null;

  return (
    <div>
      <Header title="Admin Panel" subtitle="Global platform settings — HR access only" />

      <div className="grid lg:grid-cols-4 gap-4 mb-8">
        {[
          { label: 'Total Users', value: allUsers.length,   icon: UsersIcon,      color: 'bg-[#e6f4f0] text-primary' },
          { label: 'Houses',      value: houses.length,     icon: BuildingsIcon,  color: 'bg-[#e3f0f8] text-[#1a6b8a]' },
          { label: 'Managers',    value: byRole('MANAGER'), icon: ShieldCheckIcon, color: 'bg-[#fff8e1] text-[#784a00]' },
          { label: 'Workers',     value: byRole('WORKER'),  icon: UsersIcon,      color: 'bg-surface-high text-on-surface-variant' },
        ].map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="glass-card p-5 flex items-center gap-4">
            <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${color}`}>
              <Icon size={20} weight="regular" />
            </div>
            <div>
              <p className="text-2xl font-bold text-on-surface">{value}</p>
              <p className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant font-inter">{label}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <div className="glass-card p-6">
          <div className="flex items-center gap-3 mb-5">
            <div className="w-9 h-9 rounded-lg bg-[#e6f4f0] flex items-center justify-center">
              <MapPinIcon size={18} className="text-primary" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-on-surface">Global Geofence Radius</h2>
              <p className="text-xs text-on-surface-variant font-inter">Apply a default radius to all houses</p>
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold tracking-wider uppercase text-on-surface-variant font-inter mb-1.5">
                Radius (metres)
              </label>
              <input
                type="number"
                min="10"
                max="500"
                value={globalRadius}
                onChange={(e) => setGlobalRadius(e.target.value)}
                className="input-field max-w-[180px]"
              />
              <p className="text-xs text-on-surface-variant font-inter mt-1.5">Default is 50m. Recommended range: 25–150m.</p>
            </div>
            <button
              onClick={applyGlobalGeofence}
              disabled={saving || houses.length === 0}
              className="btn-primary"
            >
              {saving ? 'Applying…' : `Apply to all ${houses.length} houses`}
            </button>
          </div>
        </div>

        <div className="glass-card p-6">
          <div className="flex items-center gap-3 mb-5">
            <div className="w-9 h-9 rounded-lg bg-[#e6f4f0] flex items-center justify-center">
              <BuildingsIcon size={18} className="text-primary" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-on-surface">Per-House Geofence</h2>
              <p className="text-xs text-on-surface-variant font-inter">Current radius for each house</p>
            </div>
          </div>
          <div className="space-y-0">
            {houses.map((h) => (
              <div key={h.id} className="flex items-center justify-between py-2.5 border-b border-outline-variant/40 last:border-0">
                <div>
                  <p className="text-sm font-medium text-on-surface">{h.name}</p>
                  <p className="text-xs text-on-surface-variant font-inter truncate max-w-[200px]">{h.address}</p>
                </div>
                <span className="text-sm font-semibold text-primary font-inter">{h.geofenceRadius}m</span>
              </div>
            ))}
            {houses.length === 0 && <p className="text-sm text-on-surface-variant text-center py-4">No houses configured</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
