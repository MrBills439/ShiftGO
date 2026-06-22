export type Role = 'HR' | 'MANAGER' | 'TEAM_LEADER' | 'WORKER';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: Role;
}

export interface House {
  id: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  geofenceRadius: number;
  autoConfirm: boolean;
  managerId: string | null;
  manager?: { id: string; name: string } | null;
  workers?: { worker: User }[];
  teamLeaders?: { teamLeader: User }[];
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  createdAt: string;
}

export interface Shift {
  id: string;
  houseId: string;
  workerId: string;
  createdById: string;
  startTime: string;
  endTime: string;
  date: string;
  house: House;
  worker: { id: string; name: string; email: string };
}

export interface Timesheet {
  id: string;
  workerId: string;
  houseId: string;
  shiftId: string;
  clockInAt: string | null;
  clockOutAt: string | null;
  totalHours: number | null;
  confirmedById: string | null;
  confirmedAt: string | null;
  autoConfirmed: boolean;
  worker: { id: string; name: string; email: string };
  shift: Shift;
  house: House;
}

export interface ApiResponse<T> {
  success: boolean;
  data: T;
}
