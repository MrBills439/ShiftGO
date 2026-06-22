'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  SquaresFourIcon, CalendarBlankIcon, BuildingsIcon, UsersIcon,
  ListChecksIcon, SignOutIcon, ShieldCheckIcon, UserCircleIcon,
} from '@phosphor-icons/react';
import { clsx } from 'clsx';
import { useAuthStore } from '@/store/authStore';

interface NavItem {
  href: string;
  label: string;
  icon: React.ElementType;
  roles?: string[];
}

const NAV: NavItem[] = [
  { href: '/dashboard',                label: 'Overview',    icon: SquaresFourIcon },
  { href: '/dashboard/shifts',         label: 'Shifts',      icon: CalendarBlankIcon },
  { href: '/dashboard/houses',         label: 'Houses',      icon: BuildingsIcon },
  { href: '/dashboard/workers',        label: 'Workers',     icon: UsersIcon,       roles: ['HR', 'MANAGER'] },
  { href: '/dashboard/timesheets',     label: 'Timesheets',  icon: ListChecksIcon },
  { href: '/dashboard/profile',        label: 'Profile',     icon: UserCircleIcon },
  { href: '/admin',                    label: 'Admin',       icon: ShieldCheckIcon, roles: ['HR'] },
];

export function Sidebar() {
  const pathname = usePathname();
  const { user, logout } = useAuthStore();

  const visible = NAV.filter((n) => !n.roles || n.roles.includes(user?.role ?? ''));

  return (
    <aside className="w-[280px] flex-shrink-0 h-screen sticky top-0 flex flex-col bg-white border-r border-outline-variant/50">
      <div className="px-6 py-5 border-b border-outline-variant/30">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-primary-DEFAULT flex items-center justify-center">
            <span className="text-white text-base font-bold font-sans">S</span>
          </div>
          <div>
            <p className="text-base font-bold text-on-surface leading-none">ShiftGO</p>
            <p className="text-[11px] text-on-surface-variant font-inter mt-0.5">Care Management</p>
          </div>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-0.5">
        <p className="px-3 pb-2 text-[10px] font-semibold tracking-widest uppercase text-outline-DEFAULT font-inter">
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

      <div className="px-3 py-4 border-t border-outline-variant/30 space-y-1">
        <div className="flex items-center gap-3 px-3 py-2.5 rounded-md bg-surface-low">
          <div className="w-8 h-8 rounded-full bg-primary-container flex items-center justify-center flex-shrink-0">
            <span className="text-xs font-bold text-primary-DEFAULT">
              {user?.name?.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()}
            </span>
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-on-surface truncate">{user?.name}</p>
            <p className="text-[11px] text-on-surface-variant font-inter truncate">
              {user?.role?.replace('_', ' ')}
            </p>
          </div>
        </div>
        <button
          onClick={logout}
          className="sidebar-item w-full text-error-DEFAULT hover:bg-error-container/30"
        >
          <SignOutIcon size={18} weight="regular" />
          <span>Sign out</span>
        </button>
      </div>
    </aside>
  );
}
