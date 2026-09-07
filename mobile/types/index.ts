export type Role = 'HR' | 'MANAGER' | 'TEAM_LEADER' | 'WORKER';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  phone?: string | null;
  onboardedAt?: string | null;
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

export type ShiftType = 'LONG_DAY' | 'MID_DAY' | 'WAKE_NIGHT' | 'SLEEP_IN';
export type ShiftStatus = 'SCHEDULED' | 'OPEN' | 'CLAIMED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';

export interface Shift {
  id: string;
  houseId: string;
  workerId: string | null;
  startTime: string;
  endTime: string;
  date: string;
  shiftType: ShiftType;
  status: ShiftStatus;
  eligibleRoles: string[];
  claimCount?: number;
  cancelledAt: string | null;
  cancelledById: string | null;
  cancellationReason: string | null;
  house: House;
  worker?: { id: string; name: string; email: string } | null;
  timesheet?: {
    id: string;
    clockInAt: string | null;
    clockOutAt: string | null;
    totalHours: number | null;
    status: 'PENDING' | 'APPROVED' | 'REJECTED';
    reviewedAt: string | null;
  } | null;
}

export interface ShiftClaim {
  id: string;
  shiftId: string;
  workerId: string;
  worker: { id: string; name: string; email: string };
  claimedAt: string;
  status: string;
}

export interface Announcement {
  id: string;
  agencyId: string;
  authorId: string;
  title: string;
  body: string;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
  author: { id: string; name: string; role: Role };
  read?: boolean;
}

export type NotificationType =
  | 'SHIFT_ASSIGNED' | 'SHIFT_REMOVED' | 'SHIFT_REMINDER'
  | 'SHIFT_OPEN' | 'SHIFT_DROPPED' | 'SHIFT_CLAIMED_YOU' | 'SHIFT_CLAIMED_OTHER'
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
  contractedHours?: number | null;
  onboardedAt?: string | null;
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
  reason: string | null;
  status: LeaveRequestStatus;
  totalHours: number;
  reviewedById: string | null;
  reviewedAt: string | null;
  rejectionReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export type RightToWorkStatus = 'MISSING' | 'CURRENT' | 'STALE';

/** GET /right-to-work/me — UK Right-to-Work share code + proof document. */
export interface ShareCode {
  id?: string;
  userId: string;
  code: string | null;
  shareDate: string | null;
  notes: string | null;
  hasDocument: boolean;
  documentName?: string | null;
  documentUrl?: string | null;
  updatedAt?: string;
  updatedBy?: { id: string; name: string } | null;
  status: RightToWorkStatus;
  daysUntilStale?: number;
  staleAfterDays: number;
}

export type AccrualMethod = 'FLAT_RATE' | 'HOURLY' | 'LUMP_SUM';

/** GET /leave-requests/balance — PTO Net Usable Balance breakdown, in hours. */
export interface LeaveBalanceSummary {
  method: AccrualMethod;
  asOf: string;
  carriedOverHours: number;
  accruedToDate: number;
  grossAvailableRaw: number;
  grossAvailable: number;
  ceilingApplied: boolean;
  balanceCeilingHours: number | null;
  approvedTaken: number;
  pendingScheduled: number;
  netUsableBalance: number;
  allowNegativeBalance: boolean;
  cycleStartDate: string;
  totalWorkedHours: number;
  dailyHours: number;
  hasConfiguredProfile: boolean;
}
