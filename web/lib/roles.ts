import type { Role } from '@/types';

export const ROLE_LABELS: Record<Role, string> = {
  WORKER: 'Worker',
  TEAM_LEADER: 'Team Lead',
  MANAGER: 'Manager',
  HR: 'HR',
};

interface RoleMeta {
  label: string;
  avatarClass: string;
  badgeClass: string;
}

export const ROLE_META: Record<Role, RoleMeta> = {
  HR: {
    label: 'HR',
    avatarClass: 'bg-violet-100 text-violet-700',
    badgeClass: 'border-violet-200 bg-violet-50 text-violet-700',
  },
  MANAGER: {
    label: 'Manager',
    avatarClass: 'bg-sky-100 text-sky-700',
    badgeClass: 'border-sky-200 bg-sky-50 text-sky-700',
  },
  TEAM_LEADER: {
    label: 'Team Lead',
    avatarClass: 'bg-amber-100 text-amber-700',
    badgeClass: 'border-amber-200 bg-amber-50 text-amber-700',
  },
  WORKER: {
    label: 'Worker',
    avatarClass: 'bg-emerald-100 text-emerald-700',
    badgeClass: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  },
};

export function initials(name: string): string {
  return name.split(' ').map((n) => n[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
}
