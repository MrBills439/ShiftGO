'use client';
import { UsersIcon, BuildingsIcon, CalendarBlankIcon, ClockCountdownIcon } from '@phosphor-icons/react';
import { Header } from '@/components/layout/Header';
import { StatsCard } from '@/components/dashboard/StatsCard';
import { StatsSkeleton, DashboardPanelSkeleton } from '@/components/ui/Skeleton';
import { useShifts } from '@/hooks/useShifts';
import { useHouses } from '@/hooks/useHouses';
import { useUsers } from '@/hooks/useWorkers';
import { useAuthStore } from '@/store/authStore';
import { Badge } from '@/components/ui/Badge';

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}
function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export default function DashboardPage() {
  const user = useAuthStore((s) => s.user);
  const { data: shifts = [], isLoading: shiftsLoading } = useShifts();
  const { data: houses = [], isLoading: housesLoading } = useHouses();
  const { data: workers = [], isLoading: workersLoading } = useUsers('WORKER');

  const isLoading = shiftsLoading || housesLoading || workersLoading;

  const now = new Date();
  const activeShifts = shifts.filter((s) => new Date(s.startTime) <= now && new Date(s.endTime) >= now);
  const todayShifts = shifts.filter((s) => new Date(s.date).toDateString() === now.toDateString());
  const upcomingShifts = shifts.filter((s) => new Date(s.startTime) > now).slice(0, 6);

  const greeting = now.getHours() < 12 ? 'Good morning' : now.getHours() < 17 ? 'Good afternoon' : 'Good evening';

  return (
    <div>
      <Header
        title={`${greeting}, ${user?.name?.split(' ')[0]}`}
        subtitle={now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
      />

      {isLoading ? (
        <>
          <StatsSkeleton count={4} />
          <DashboardPanelSkeleton />
        </>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            <StatsCard label="Active Shifts"  value={activeShifts.length} icon={ClockCountdownIcon} color="teal" />
            <StatsCard label="Today's Shifts" value={todayShifts.length}  icon={CalendarBlankIcon}  color="blue" />
            <StatsCard label="Houses"         value={houses.length}       icon={BuildingsIcon}      color="slate" />
            <StatsCard label="Workers"        value={workers.length}      icon={UsersIcon}          color="amber" />
          </div>

          <div className="grid lg:grid-cols-2 gap-6">
            <div className="glass-card p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-base font-semibold text-on-surface">Upcoming Shifts</h2>
                <Badge variant="upcoming" label={`${upcomingShifts.length} total`} dot={false} />
              </div>
              {upcomingShifts.length === 0 ? (
                <p className="text-sm text-on-surface-variant text-center py-8">No upcoming shifts</p>
              ) : (
                <div>
                  {upcomingShifts.map((s) => (
                    <div key={s.id} className="flex items-center justify-between py-2.5 border-b border-outline-variant/40 last:border-0">
                      <div>
                        <p className="text-sm font-medium text-on-surface">{s.worker.name}</p>
                        <p className="text-xs text-on-surface-variant font-inter">{s.house.name} · {formatDate(s.date)}</p>
                      </div>
                      <span className="text-xs font-medium text-primary-DEFAULT font-inter">
                        {formatTime(s.startTime)} – {formatTime(s.endTime)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="glass-card p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-base font-semibold text-on-surface">Houses</h2>
                <Badge variant="active" label={`${houses.length} houses`} dot={false} />
              </div>
              {houses.length === 0 ? (
                <p className="text-sm text-on-surface-variant text-center py-8">No houses configured</p>
              ) : (
                <div>
                  {houses.map((h) => (
                    <div key={h.id} className="flex items-center justify-between py-2.5 border-b border-outline-variant/40 last:border-0">
                      <div>
                        <p className="text-sm font-medium text-on-surface">{h.name}</p>
                        <p className="text-xs text-on-surface-variant font-inter truncate max-w-[200px]">{h.address}</p>
                      </div>
                      <span className="text-xs font-inter text-on-surface-variant">{h.geofenceRadius}m radius</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
