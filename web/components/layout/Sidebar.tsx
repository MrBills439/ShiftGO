'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  SquaresFourIcon, CalendarBlankIcon, BuildingsIcon, UsersIcon,
  ListChecksIcon, SignOutIcon, ShieldCheckIcon, UserCircleIcon, MegaphoneIcon,
  ListIcon, XIcon,
} from '@phosphor-icons/react';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import { clsx } from 'clsx';
import { useAuthStore } from '@/store/authStore';
import { ROLE_META, initials } from '@/lib/roles';
import { displayNameOf, realNameOf } from '@/lib/userName';
import type { Role } from '@/types';

interface NavItem {
  href: string;
  label: string;
  icon: React.ElementType;
  roles?: string[];
}

const NAV: NavItem[] = [
  { href: '/dashboard',                label: 'Today',         icon: SquaresFourIcon },
  { href: '/dashboard/operations',     label: 'Operations',    icon: SquaresFourIcon, roles: ['HR', 'MANAGER'] },
  { href: '/dashboard/rota',           label: 'Schedule',      icon: CalendarBlankIcon, roles: ['HR', 'MANAGER'] },
  { href: '/dashboard/shifts',         label: 'Shifts',        icon: CalendarBlankIcon },
  // Workers reach their own leave from the Profile page; managers/leads keep it in nav for approvals.
  { href: '/dashboard/leave',          label: 'Leave',         icon: CalendarBlankIcon, roles: ['HR', 'MANAGER', 'TEAM_LEADER'] },
  { href: '/dashboard/timesheets',     label: 'Timesheets',    icon: ListChecksIcon },
  { href: '/dashboard/announcements',  label: 'Announcements', icon: MegaphoneIcon },
  { href: '/dashboard/houses',         label: 'Services',      icon: BuildingsIcon, roles: ['HR', 'MANAGER', 'TEAM_LEADER'] },
  { href: '/dashboard/workers',        label: 'Staff',         icon: UsersIcon,     roles: ['HR', 'MANAGER', 'TEAM_LEADER'] },
  { href: '/dashboard/right-to-work',  label: 'Right to Work', icon: ShieldCheckIcon, roles: ['HR', 'MANAGER'] },
  { href: '/dashboard/profile',        label: 'Profile',       icon: UserCircleIcon },
  { href: '/admin',                    label: 'Admin',         icon: ShieldCheckIcon, roles: ['HR'] },
];

/** Product name in text only: there is no approved LeafRota logo asset yet. */
function Brand() {
  return (
    <div>
      <p className="text-base font-bold text-on-surface leading-none">LeafRota</p>
      <p className="text-[11px] text-on-surface-variant font-inter mt-0.5">A product of PIPCoRD</p>
    </div>
  );
}

/**
 * Desktop (lg+): fixed sidebar. Smaller screens: a top bar with a Menu button
 * that opens the same navigation as a drawer, so the page keeps its full width.
 */
export function Sidebar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const drawerRef = useFocusTrap<HTMLDivElement>(open, () => setOpen(false));

  // Close the drawer after navigating.
  useEffect(() => { setOpen(false); }, [pathname]);

  return (
    <>
      <div className="lg:hidden sticky top-0 z-40 flex items-center justify-between border-b border-outline-variant/50 bg-white px-4 py-3">
        <Brand />
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-expanded={open}
          aria-controls="mobile-nav"
          className="inline-flex h-10 items-center gap-2 rounded-md border border-border px-3 text-sm font-medium text-fg"
        >
          <ListIcon size={18} aria-hidden="true" /> Menu
        </button>
      </div>

      {open && (
        <div className="lg:hidden fixed inset-0 z-50">
          <button type="button" aria-label="Close menu" className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <div
            ref={drawerRef}
            id="mobile-nav"
            role="dialog"
            aria-modal="true"
            aria-label="Menu"
            tabIndex={-1}
            className="absolute inset-y-0 left-0 flex w-[280px] max-w-[85vw] flex-col bg-white shadow-xl"
          >
            <SidebarContent onClose={() => setOpen(false)} />
          </div>
        </div>
      )}

      <aside className="hidden lg:flex w-[280px] flex-shrink-0 h-screen sticky top-0 flex-col bg-white border-r border-outline-variant/50">
        <SidebarContent />
      </aside>
    </>
  );
}

function SidebarContent({ onClose }: { onClose?: () => void }) {
  const pathname = usePathname();
  const { user, logout } = useAuthStore();

  const visible = NAV.filter((n) => !n.roles || n.roles.includes(user?.role ?? ''));

  return (
    <>
      <div className="px-6 py-5 border-b border-outline-variant/30 flex items-start justify-between gap-2">
        <Brand />
        {onClose && (
          <button type="button" onClick={onClose} aria-label="Close menu" className="rounded-md p-1.5 text-on-surface-variant hover:bg-surface-subtle">
            <XIcon size={18} aria-hidden="true" />
          </button>
        )}
      </div>

      <nav aria-label="Main" className="flex-1 overflow-y-auto px-3 py-4 space-y-0.5">
        <p aria-hidden="true" className="px-3 pb-2 text-[10px] font-semibold tracking-widest uppercase text-outline font-inter">
          Navigation
        </p>
        {visible.map(({ href, label, icon: Icon }) => {
          const active = href === '/dashboard'
            ? pathname === '/dashboard'
            : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? 'page' : undefined}
              className={clsx('sidebar-item', active && 'active')}
            >
              <Icon size={18} weight="regular" aria-hidden="true" />
              <span>{label}</span>
            </Link>
          );
        })}
      </nav>

      {!onClose && (
        <div className="px-3 py-3 border-t border-outline-variant/30">
          <p className="text-[11px] text-on-surface-variant font-inter px-2">
            Press <kbd className="bg-surface-low px-1.5 py-0.5 rounded text-[10px] font-medium">Cmd+K</kbd> to search
          </p>
        </div>
      )}

      <div className="px-3 py-3 border-t border-outline-variant/30">
        {(() => {
          const role = (user?.role ?? 'WORKER') as Role;
          const meta = ROLE_META[role] ?? ROLE_META.WORKER;
          const displayName = displayNameOf(user);
          const avatarSeed = realNameOf(user) ?? user?.email ?? displayName;
          return (
            <div className="flex items-center gap-2.5">
              <div className={clsx('flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-[11px] font-semibold', meta.avatarClass)}>
                {initials(avatarSeed)}
              </div>
              <div className="min-w-0 flex-1 leading-tight">
                <p className="truncate text-sm font-semibold text-on-surface">{displayName}</p>
                <p className="truncate text-[11px] text-on-surface-variant font-inter">
                  <span className="font-medium text-on-surface/70">{meta.label}</span>
                  {user?.email ? ` · ${user.email}` : ''}
                </p>
              </div>
              <button
                onClick={logout}
                aria-label="Sign out"
                title="Sign out"
                className="flex-shrink-0 rounded-md p-1.5 text-on-surface-variant transition-colors hover:bg-error-container/40 hover:text-error"
              >
                <SignOutIcon size={16} weight="regular" />
              </button>
            </div>
          );
        })()}
      </div>
    </>
  );
}
