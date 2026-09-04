import type { Role } from '@/types';

export interface CoverRoleGroup {
  key: string;
  label: string;
  roles: Role[];
}

// Worker and Team Leader are both frontline staff who actually cover shifts —
// grouped as one "Staff" choice rather than exposed as separate toggles.
export const COVER_ROLE_GROUPS: CoverRoleGroup[] = [
  { key: 'STAFF', label: 'Staff', roles: ['WORKER', 'TEAM_LEADER'] },
  { key: 'MANAGER', label: 'Manager', roles: ['MANAGER'] },
  { key: 'HR', label: 'HR', roles: ['HR'] },
];

export function isGroupSelected(group: CoverRoleGroup, eligibleRoles: Role[]): boolean {
  return group.roles.every((r) => eligibleRoles.includes(r));
}

export function toggleGroupRoles(eligibleRoles: Role[], group: CoverRoleGroup): Role[] {
  if (isGroupSelected(group, eligibleRoles)) {
    return eligibleRoles.filter((r) => !group.roles.includes(r));
  }
  return Array.from(new Set([...eligibleRoles, ...group.roles]));
}
