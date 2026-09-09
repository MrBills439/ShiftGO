'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  SquaresFourIcon, CalendarBlankIcon, BuildingsIcon, UsersIcon,
  ListChecksIcon, SignOutIcon, ShieldCheckIcon, UserCircleIcon, MegaphoneIcon,
  ArrowsClockwiseIcon,
} from '@phosphor-icons/react';
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
  { href: '/dashboard/shift-requests', label: 'Shift Requests', icon: ArrowsClockwiseIcon, roles: ['HR', 'MANAGER'] },
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

export function Sidebar() {
  const pathname = usePathname();
  const { user, logout } = useAuthStore();

  const visible = NAV.filter((n) => !n.roles || n.roles.includes(user?.role ?? ''));

  return (
    <aside className="w-[280px] flex-shrink-0 h-screen sticky top-0 flex flex-col bg-white border-r border-outline-variant/50">
      <div className="px-6 py-5 border-b border-outline-variant/30">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-primary flex items-center justify-center">
            <span className="text-white text-base font-bold font-sans">S</span>
          </div>
          <div>
            <p className="text-base font-bold text-on-surface leading-none">ShiftGO</p>
            <p className="text-[11px] text-on-surface-variant font-inter mt-0.5">Care Management</p>
          </div>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-0.5">
        <p className="px-3 pb-2 text-[10px] font-semibold tracking-widest uppercase text-outline font-inter">
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
              className={clsx('sidebar-item', active && 'active')}
            >
              <Icon size={18} weight="regular" />
              <span>{label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="px-3 py-3 border-t border-outline-variant/30">
        <p className="text-[11px] text-on-surface-variant font-inter px-2">
          Press <kbd className="bg-surface-low px-1.5 py-0.5 rounded text-[10px] font-medium">Cmd+K</kbd> to search
        </p>
      </div>

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
                className="flex-shrink-0 rounded-md p-1.5 text-on-surface-variant transition-colors hover:bg-error-container/40 hover:text-error-DEFAULT"
              >
                <SignOutIcon size={16} weight="regular" />
              </button>
            </div>
          );
        })()}
      </div>
    </aside>
  );
}
