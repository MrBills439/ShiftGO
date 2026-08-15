export type Role = 'HR' | 'MANAGER' | 'TEAM_LEADER' | 'WORKER';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: Role;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface House {
  id: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  geofenceRadius: number;
  autoConfirm: boolean;
}

export type ShiftType = 'DAY' | 'WAKE_NIGHT' | 'SLEEP_IN' | 'EMERGENCY';
export type ShiftStatus = 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';

export interface Shift {
  id: string;
  houseId: string;
  workerId: string;
  startTime: string;
  endTime: string;
  date: string;
  shiftType: ShiftType;
  status: ShiftStatus;
  cancelledAt: string | null;
  cancelledById: string | null;
  cancellationReason: string | null;
  house: House;
}

export type NotificationType =
  | 'SHIFT_ASSIGNED' | 'SHIFT_REMOVED' | 'SHIFT_REMINDER'
  | 'MISSED_CLOCK_IN' | 'CLOCK_OUT_PROMPT' | 'GENERAL';

export interface AppNotification {
  id: string;
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  data?: Record<string, any> | null;
  read: boolean;
  createdAt: string;
}

export type TrainingStatus = 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'EXPIRED';

export interface Training {
  id: string;
  userId: string;
  title: string;
  description?: string | null;
  status: TrainingStatus;
  completedAt?: string | null;
  expiresAt?: string | null;
  createdAt: string;
}

export type DbsStatus = 'PENDING' | 'CLEAR' | 'FLAGGED' | 'EXPIRED';

export interface DbsCheck {
  id: string;
  userId: string;
  status: DbsStatus;
  reference?: string | null;
  issuedAt?: string | null;
  expiresAt?: string | null;
  notes?: string | null;
  createdAt: string;
}

export interface UserProfile {
  id: string;
  name: string;
  email: string;
  role: Role;
  phone?: string | null;
  bio?: string | null;
  profilePicture?: string | null;
  address?: string | null;
  createdAt: string;
  updatedAt: string;
}

export type ClockType = 'IN' | 'OUT';
export type ClockMethod = 'AUTO' | 'MANUAL';

export interface ClockEvent {
  id: string;
  workerId: string;
  houseId: string;
  shiftId: string;
  type: ClockType;
  method: ClockMethod;
  timestamp: string;
}

export interface Timesheet {
  id: string;
  workerId: string;
  houseId: string;
  shiftId: string;
  clockInAt: string | null;
  clockOutAt: string | null;
  totalHours: number | null;
  confirmedAt: string | null;
  autoConfirmed: boolean;
  shift: Shift;
  house: House;
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

export type LeaveRequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';

export interface LeaveRequest {
  id: string;
  workerId: string;
  startDate: string;
  endDate: string;
  reason: string;
  status: LeaveRequestStatus;
  reviewedById: string | null;
  reviewedAt: string | null;
  rejectionReason: string | null;
  createdAt: string;
  updatedAt: string;
}
