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
  agencyId?: string;
  name: string;
  email: string;
  role: Role;
  status?: 'ACTIVE' | 'DEACTIVATED';
  phone?: string | null;
  deactivatedAt?: string | null;
  deactivatedById?: string | null;
  deactivationReason?: string | null;
  createdAt: string;
}

export type ShiftType = 'DAY' | 'WAKE_NIGHT' | 'SLEEP_IN' | 'EMERGENCY';

export interface Shift {
  id: string;
  houseId: string;
  workerId: string;
  createdById: string;
  startTime: string;
  endTime: string;
  date: string;
  shiftType: ShiftType;
  status: 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
  cancelledAt: string | null;
  cancelledById: string | null;
  cancellationReason: string | null;
  house: House;
  worker: { id: string; name: string; email: string };
  cancelledBy?: { id: string; name: string; email: string } | null;
  timesheet?: Timesheet | null;
}

export interface RotaShiftSummary {
  shiftId: string;
  worker: { id: string; name: string; email: string } | null;
  house: { id: string; name: string; address: string } | null;
  startTime: string;
  endTime: string;
  shiftType: ShiftType;
  status: 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
  cancellationReason: string | null;
  timesheet?: {
    id: string;
    clockInAt: string | null;
    clockOutAt: string | null;
    totalHours: number | null;
    status: 'PENDING' | 'APPROVED' | 'REJECTED';
    reviewedAt: string | null;
  } | null;
}

export interface Timesheet {
  id: string;
  workerId: string;
  houseId: string;
  shiftId: string;
  clockInAt: string | null;
  clockOutAt: string | null;
  totalHours: number | null;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  rejectionReason: string | null;
  confirmedById: string | null;
  confirmedAt: string | null;
  reviewedById: string | null;
  reviewedAt: string | null;
  autoConfirmed: boolean;
  worker: { id: string; name: string; email: string };
  reviewedBy?: { id: string; name: string; email: string } | null;
  shift: Shift;
  house: House;
}

export type LeaveStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';

export interface LeaveRequest {
  id: string;
  agencyId: string;
  workerId: string;
  startDate: string;
  endDate: string;
  reason: string;
  status: LeaveStatus;
  rejectionReason: string | null;
  reviewedById: string | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
  worker: User;
  reviewedBy?: { id: string; name: string; email: string } | null;
}

export interface RotaDay {
  date: string;
  shifts: Shift[];
}

export interface RotaWeek {
  startDate: string;
  endDate: string;
  days: RotaDay[];
}

export interface ApiResponse<T> {
  success: boolean;
  data: T;
}
