'use client';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { MagnifyingGlassIcon, LightningIcon } from '@phosphor-icons/react';
import { useUsers } from '@/hooks/useWorkers';
import { useHouses } from '@/hooks/useHouses';
import { useShifts } from '@/hooks/useShifts';
import { useLeaveRequests } from '@/hooks/useLeaveRequests';

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
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  const { data: workers = [] } = useUsers();
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
    const items: CommandItem[] = [
      // Pages
      { id: 'today', title: 'Today', description: 'Operations overview', category: 'page', href: '/dashboard' },
      { id: 'operations', title: 'Operations', description: 'Live command centre', category: 'page', href: '/dashboard/operations' },
      { id: 'schedule', title: 'Schedule', description: 'Shift planning', category: 'page', href: '/dashboard/rota' },
      { id: 'people', title: 'People', description: 'Staff management', category: 'page', href: '/dashboard/workers' },
      { id: 'locations', title: 'Locations', description: 'Care homes', category: 'page', href: '/dashboard/houses' },
      { id: 'approvals', title: 'Approvals', description: 'Leave & timesheets', category: 'page', href: '/dashboard/approvals' },
      { id: 'leaves', title: 'Leave', description: 'Leave management', category: 'page', href: '/dashboard/leave' },

      // Quick Actions
      { id: 'emergency', title: 'Emergency Shift', description: 'Create emergency coverage', category: 'action', onSelect: () => alert('Create emergency shift') },
      { id: 'create-staff', title: 'Create Staff', description: 'Add new staff member', category: 'action', href: '/dashboard/workers' },
      { id: 'create-location', title: 'Create Location', description: 'Add care home', category: 'action', href: '/dashboard/houses' },
    ];

    // Search results
    if (search.trim()) {
      const q = search.toLowerCase();

      // Search people
      workers.filter(w => w.name.toLowerCase().includes(q)).forEach(w => {
        items.push({
          id: `person-${w.id}`,
          title: w.name,
          description: `${w.role.replace('_', ' ')} — ${w.email}`,
          category: 'search',
          href: `/dashboard/workers#${w.id}`,
        });
      });

      // Search locations
      houses.filter(h => h.name.toLowerCase().includes(q)).forEach(h => {
        items.push({
          id: `house-${h.id}`,
          title: h.name,
          description: `${h.address}`,
          category: 'search',
          href: `/dashboard/houses#${h.id}`,
        });
      });

      // Search shifts
      shifts.filter(s => s.house?.name.toLowerCase().includes(q)).slice(0, 3).forEach(s => {
        items.push({
          id: `shift-${s.id}`,
          title: `Shift at ${s.house?.name}`,
          description: `${new Date(s.startTime).toLocaleString('en-GB')}`,
          category: 'search',
          href: `/dashboard/rota#${s.id}`,
        });
      });

      // Search leaves
      leaves.filter(l => l.worker?.name.toLowerCase().includes(q)).slice(0, 3).forEach(l => {
        items.push({
          id: `leave-${l.id}`,
          title: `Leave: ${l.worker?.name}`,
          description: `${l.reason}`,
          category: 'search',
          href: `/dashboard/leave#${l.id}`,
        });
      });
    }

    return items;
  }, [search, workers, houses, shifts, leaves]);

  const pageCommands = commands.filter(c => c.category === 'page');
  const actionCommands = commands.filter(c => c.category === 'action');
  const searchResults = commands.filter(c => c.category === 'search');

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
              placeholder="Search people, locations, shifts…"
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
