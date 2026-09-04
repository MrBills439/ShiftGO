'use client';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { MagnifyingGlassIcon, LightningIcon } from '@phosphor-icons/react';
import { useUsers } from '@/hooks/useWorkers';
import { useHouses } from '@/hooks/useHouses';
import { useShifts } from '@/hooks/useShifts';
import { useLeaveRequests } from '@/hooks/useLeaveRequests';
import { useAuthStore } from '@/store/authStore';

interface CommandItem {
  id: string;
  title: string;
  description: string;
  category: 'page' | 'action' | 'search';
  icon?: React.ReactNode;
  href?: string;
  onSelect?: () => void;
}

export function CommandPalette() {
  const router = useRouter();
  const role = useAuthStore((s) => s.user?.role);
  const isWorker = role === 'WORKER';

  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  // GET /users is 403 for workers — don't fire it for them.
  const { data: workers = [] } = useUsers(undefined, 'ACTIVE', !isWorker);
  const { data: houses = [] } = useHouses();
  const { data: shifts = [] } = useShifts();
  const { data: leaves = [] } = useLeaveRequests();

  // Listen for Cmd+K / Ctrl+K
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen(!open);
      }
      if (e.key === 'Escape') {
        setOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open]);

  const commands: CommandItem[] = useMemo(() => {
    const items: CommandItem[] = isWorker
      ? [
          { id: 'today', title: 'Today', description: 'Your shifts, hours and notices', category: 'page', href: '/dashboard' },
          { id: 'shifts', title: 'Shifts', description: 'Your upcoming and past shifts', category: 'page', href: '/dashboard/shifts' },
          { id: 'leave', title: 'Leave', description: 'Your time off and balance', category: 'page', href: '/dashboard/leave' },
          { id: 'timesheets', title: 'Timesheets', description: 'Your logged hours', category: 'page', href: '/dashboard/timesheets' },
          { id: 'announcements', title: 'Announcements', description: 'Agency-wide updates', category: 'page', href: '/dashboard/announcements' },
          { id: 'profile', title: 'Profile', description: 'Your details, training and DBS', category: 'page', href: '/dashboard/profile' },
          { id: 'request-leave', title: 'Request time off', description: 'Open a new leave request', category: 'action', href: '/dashboard/leave' },
        ]
      : [
          { id: 'today', title: 'Today', description: 'Operations overview', category: 'page', href: '/dashboard' },
          { id: 'operations', title: 'Operations', description: 'Live command centre', category: 'page', href: '/dashboard/operations' },
          { id: 'schedule', title: 'Schedule', description: 'Shift planning', category: 'page', href: '/dashboard/rota' },
          { id: 'people', title: 'Staff', description: 'Staff management', category: 'page', href: '/dashboard/workers' },
          { id: 'locations', title: 'Services', description: 'Care homes', category: 'page', href: '/dashboard/houses' },
          { id: 'leaves', title: 'Leave', description: 'Leave management (approve/reject)', category: 'page', href: '/dashboard/leave' },
          { id: 'timesheets', title: 'Timesheets', description: 'Confirm & export attendance', category: 'page', href: '/dashboard/timesheets' },

          { id: 'emergency', title: 'Emergency Shift', description: 'Create emergency coverage', category: 'action', href: '/dashboard/rota' },
          { id: 'create-staff', title: 'Create Staff', description: 'Add new staff member', category: 'action', href: '/dashboard/workers' },
          { id: 'create-location', title: 'Create Service', description: 'Add a service', category: 'action', href: '/dashboard/houses' },
        ];

    // Search results
    if (search.trim()) {
      const q = search.toLowerCase();

      if (!isWorker) {
        workers.filter((w) => w.name.toLowerCase().includes(q)).forEach((w) => {
          items.push({
            id: `person-${w.id}`,
            title: w.name,
            description: `${w.role.replace('_', ' ')} — ${w.email}`,
            category: 'search',
            href: `/dashboard/workers#${w.id}`,
          });
        });

        houses.filter((h) => h.name.toLowerCase().includes(q)).forEach((h) => {
          items.push({
            id: `house-${h.id}`,
            title: h.name,
            description: `${h.address}`,
            category: 'search',
            href: `/dashboard/houses#${h.id}`,
          });
        });
      }

      // Shifts — for workers this is already scoped to their own by the API.
      shifts
        .filter((s) => s.house?.name.toLowerCase().includes(q))
        .slice(0, 4)
        .forEach((s) => {
          items.push({
            id: `shift-${s.id}`,
            title: `Shift at ${s.house?.name}`,
            description: new Date(s.startTime).toLocaleString('en-GB'),
            category: 'search',
            href: isWorker ? '/dashboard/shifts' : `/dashboard/rota#${s.id}`,
          });
        });

      // Leave — also API-scoped to the worker's own.
      leaves
        .filter((l) => {
          const hay = isWorker
            ? `${l.status} ${new Date(l.startDate).toLocaleDateString('en-GB')}`
            : l.worker?.name ?? '';
          return hay.toLowerCase().includes(q);
        })
        .slice(0, 4)
        .forEach((l) => {
          items.push({
            id: `leave-${l.id}`,
            title: isWorker
              ? `Leave: ${l.status[0]}${l.status.slice(1).toLowerCase()}`
              : `Leave: ${l.worker?.name}`,
            description: `${new Date(l.startDate).toLocaleDateString('en-GB')} – ${new Date(l.endDate).toLocaleDateString('en-GB')}`,
            category: 'search',
            href: '/dashboard/leave',
          });
        });
    }

    return items;
  }, [search, isWorker, workers, houses, shifts, leaves]);

  const pageCommands = commands.filter((c) => c.category === 'page');
  const actionCommands = commands.filter((c) => c.category === 'action');
  const searchResults = commands.filter((c) => c.category === 'search');

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 z-40"
        onClick={() => setOpen(false)}
      />

      {/* Modal */}
      <div className="fixed top-1/4 left-1/2 transform -translate-x-1/2 w-full max-w-xl z-50">
        <div className="bg-white rounded-lg shadow-lg border border-neutral-200">
          {/* Search Input */}
          <div className="flex items-center gap-3 px-4 py-3 border-b border-neutral-200">
            <MagnifyingGlassIcon size={20} className="text-fg-muted" weight="regular" />
            <input
              autoFocus
              type="text"
              placeholder={isWorker ? 'Search your shifts and leave…' : 'Search staff, services, shifts…'}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="flex-1 outline-none text-sm"
            />
            <kbd className="text-xs text-fg-muted bg-neutral-100 px-2 py-1 rounded">ESC</kbd>
          </div>

          {/* Results */}
          <div className="max-h-96 overflow-y-auto">
            {searchResults.length > 0 ? (
              <>
                <div className="px-2 py-2">
                  <p className="text-xs font-semibold text-fg-muted px-2 py-1.5 uppercase">Search Results</p>
                  {searchResults.map(item => (
                    <Link
                      key={item.id}
                      href={item.href || '#'}
                      className="block px-3 py-2 rounded text-sm hover:bg-neutral-100 text-fg"
                      onClick={() => setOpen(false)}
                    >
                      <p className="font-medium">{item.title}</p>
                      <p className="text-xs text-fg-muted">{item.description}</p>
                    </Link>
                  ))}
                </div>
              </>
            ) : (
              <>
                {/* Pages */}
                <div className="px-2 py-2">
                  <p className="text-xs font-semibold text-fg-muted px-2 py-1.5 uppercase">Pages</p>
                  {pageCommands.map(item => (
                    <Link
                      key={item.id}
                      href={item.href || '#'}
                      className="block px-3 py-2 rounded text-sm hover:bg-neutral-100 text-fg"
                      onClick={() => setOpen(false)}
                    >
                      <p className="font-medium">{item.title}</p>
                      <p className="text-xs text-fg-muted">{item.description}</p>
                    </Link>
                  ))}
                </div>

                {/* Actions */}
                {actionCommands.length > 0 && (
                  <div className="px-2 py-2 border-t border-neutral-200">
                    <p className="text-xs font-semibold text-fg-muted px-2 py-1.5 uppercase">Quick Actions</p>
                    {actionCommands.map(item => (
                      <button
                        key={item.id}
                        className="w-full text-left px-3 py-2 rounded text-sm hover:bg-neutral-100"
                        onClick={() => {
                          item.onSelect?.();
                          if (item.href) router.push(item.href);
                          setOpen(false);
                        }}
                      >
                        <div className="flex items-center gap-2">
                          <LightningIcon size={14} className="text-warning" weight="regular" />
                          <span className="font-medium text-fg">{item.title}</span>
                        </div>
                        <p className="text-xs text-fg-muted">{item.description}</p>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Footer */}
          <div className="px-4 py-2 border-t border-neutral-200 bg-neutral-50 text-xs text-fg-muted flex justify-between">
            <span>Press Cmd+K to open</span>
            <span>↑↓ Navigate • Enter Select • ESC Close</span>
          </div>
        </div>
      </div>
    </>
  );
}
