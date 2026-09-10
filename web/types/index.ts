export type Role = 'HR' | 'MANAGER' | 'TEAM_LEADER' | 'WORKER';

// ── Whole-Workforce Phase 1: employment structure ──
export type LocationType =
  | 'CARE_SERVICE' | 'SUPPORTED_LIVING' | 'RESIDENTIAL_HOME' | 'OFFICE' | 'MAINTENANCE_BASE' | 'OTHER';
export type WorkPatternType = 'ROTA' | 'FIXED' | 'FLEXIBLE';
export type EmploymentType = 'PERMANENT' | 'BANK' | 'CONTRACTOR';

export interface Department {
  id: string;
  name: string;
  code: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface JobTitle {
  id: string;
  name: string;
  active: boolean;
  departmentId: string | null;
  department: { id: string; name: string } | null;
  createdAt: string;
  updatedAt: string;
}

export interface Location {
  id: string;
  name: string;
  type: LocationType;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  geofenceRadius: number | null;
  timezone: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface OrgOption {
  id: string;
  name: string;
  type?: LocationType;
  departmentId?: string | null; // job-title options carry this for client-side filtering
}

export interface AuthUser {
  id: string;
  agencyId: string;
  name: string;
  email: string;
  role: Role;
  agency?: { name: string };
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
  assignedHours?: number | null;
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
  profilePicture?: string | null;
  contractedHours?: number | null;
  deactivatedAt?: string | null;
  deactivatedById?: string | null;
  deactivationReason?: string | null;
  createdAt: string;
  // ── Whole-Workforce Phase 1 (all optional; a bare user has them null) ──
  employeeNumber?: string | null;
  workPatternType?: WorkPatternType;
  employmentType?: EmploymentType | null;
  departmentId?: string | null;
  jobTitleId?: string | null;
  primaryLocationId?: string | null;
  lineManagerId?: string | null;
  department?: { id: string; name: string } | null;
  jobTitle?: { id: string; name: string } | null;
  primaryLocation?: { id: string; name: string; type: LocationType } | null;
  lineManager?: { id: string; name: string } | null;
  // ── HR Onboarding V1 (read-only; no editor yet) ──
  employmentStartDate?: string | null;
  emergencyContactName?: string | null;
  emergencyContactPhone?: string | null;
  emergencyContactRelationship?: string | null;
}

export type ShiftType = 'LONG_DAY' | 'MID_DAY' | 'WAKE_NIGHT' | 'SLEEP_IN';

export type ShiftStatus = 'SCHEDULED' | 'OPEN' | 'CLAIMED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';

export interface Shift {
  id: string;
  houseId: string;
  workerId: string | null;
  createdById: string;
  startTime: string;
  endTime: string;
  date: string;
  shiftType: ShiftType;
  status: ShiftStatus;
  urgent: boolean;
  eligibleRoles: string[];
  claimCount?: number;
  cancelledAt: string | null;
  cancelledById: string | null;
  cancellationReason: string | null;
  house: House;
  worker: { id: string; name: string; email: string } | null;
  cancelledBy?: { id: string; name: string; email: string } | null;
  timesheet?: Timesheet | null;
}

export interface ShiftClaim {
  id: string;
  shiftId: string;
  workerId: string;
  worker: { id: string; name: string; email: string };
  claimedAt: string;
  status: string;
}

export interface RotaShiftSummary {
  shiftId: string;
  worker: { id: string; name: string; email: string } | null;
  house: { id: string; name: string; address: string } | null;
  startTime: string;
  endTime: string;
  shiftType: ShiftType;
  status: ShiftStatus;
  urgent: boolean;
  eligibleRoles: string[];
  claimCount?: number;
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

export type LocationStatus = 'ONSITE' | 'OFFSITE' | 'UNKNOWN';
export type ClockMethod = 'AUTO' | 'MANUAL';

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
  /** Set when the GPS attendance system could not safely auto-clock-out and
   *  needs a manager to confirm or clear it. See reviewReason. */
  needsReview: boolean;
  reviewReason: string | null;
  clockInLocationStatus: LocationStatus | null;
  clockOutLocationStatus: LocationStatus | null;
  clockOutMethod: ClockMethod | null;
  worker: { id: string; name: string; email: string };
  reviewedBy?: { id: string; name: string; email: string } | null;
  shift: Shift;
  house: House;
}

/** GET /timesheets/needs-review — agency-wide, so the shift/house are a small
 *  fixed subset rather than the full nested Shift/House shapes. */
export interface AttendanceReviewItem extends Omit<Timesheet, 'shift' | 'house'> {
  shift: { id: string; startTime: string; endTime: string; shiftType: ShiftType; status: ShiftStatus };
  house: { id: string; name: string; address: string };
}

// ─── Ops "Today" dashboard (GET /dashboard/today) ───────────────────────────
export type DashboardIssueType =
  | 'LATE'
  | 'UNCOVERED_SHIFT'
  | 'ATTENDANCE_REVIEW'
  | 'RIGHT_TO_WORK'
  | 'TIMESHEET_APPROVAL'
  | 'LEAVE_APPROVAL';

export interface DashboardIssue {
  id: string;
  type: DashboardIssueType;
  severity: 'critical' | 'warning' | 'info';
  title: string;
  detail: string;
  worker: { id: string; name: string } | null;
  house: { id: string; name: string } | null;
  at: string | null;
  href: string;
}

export interface DashboardShift {
  id: string;
  worker: { id: string; name: string } | null;
  house: { id: string; name: string } | null;
  startTime: string;
  endTime: string;
  shiftType: ShiftType;
  status: ShiftStatus;
  attendance: 'Scheduled' | 'Clocked in' | 'Late' | 'Completed' | 'Needs review' | 'Open';
}

export interface DashboardOpenShift {
  id: string;
  house: { id: string; name: string; address: string } | null;
  startTime: string;
  endTime: string;
  shiftType: ShiftType;
  status: ShiftStatus;
  urgent: boolean;
  eligibleRoles: string[];
  claimCount: number;
  href: string;
}

export interface DashboardToday {
  date: string;
  /** IANA timezone the "today" boundaries were computed in (agency timezone). */
  timezone: string;
  role: Role;
  permissions: {
    canCreateShift: boolean;
    canManageStaff: boolean;
    canReviewApprovals: boolean;
  };
  coverage: {
    /** null — not 100 — when nothing is scheduled today. */
    percent: number | null;
    scheduled: number;
    covered: number;
    uncovered: number;
  };
  workersLive: number;
  openIssues: number;
  pendingApprovals: {
    timesheets: number;
    attendanceReviews: number;
    leave: number;
    total: number;
  };
  issues: DashboardIssue[];
  todayShifts: DashboardShift[];
  tomorrow: { count: number; shifts: DashboardShift[] };
  /** OPEN / cover shifts still needing a worker over the next 2 weeks, scoped to the caller. */
  openShifts: DashboardOpenShift[];
  openShiftsToday: number;
  staff: { total: number };
}

// ─── Agency settings (GET/PATCH /agency) ───────────────────────────────────
export interface AgencySettings {
  id: string;
  name: string;
  timezone: string;
  maxWeeklyScheduledHours: number;
  employeeIdPrefix: string | null;
  nextEmployeeIdPreview: string | null; // e.g. "PIP-0017"; null until a prefix is set
}

// ─── Staff Allocation & Weekly Hours (GET /staff/allocation) ────────────────
export type AllocationCurrentStatus = 'ON_SHIFT' | 'OFF_SHIFT';
export type AllocationAvailability = 'AVAILABLE' | 'CONFLICT' | 'ON_LEAVE';
export type AllocationHoursStatus = 'SAFE' | 'OVER_CONTRACT' | 'NEAR_LIMIT' | 'OVER_LIMIT';

export interface AllocationConflict {
  shiftId: string;
  startTime: string;
  endTime: string;
  status: ShiftStatus;
}

export interface AllocationWorker {
  id: string;
  name: string;
  profilePicture: string | null;
  role: Role;
  contractedHours: number | null;
  scheduledHours: number;
  remainingContractedHours: number | null;
  projectedHours: number;
  currentStatus: AllocationCurrentStatus;
  /** Only set when a proposed shift is selected; null otherwise. */
  availabilityForSelectedShift: AllocationAvailability | null;
  onLeaveForSelectedShift: boolean | null;
  hoursStatus: AllocationHoursStatus;
  maxWeeklyScheduledHours: number;
  hasOverlap: boolean;
  overContract: boolean;
  activeShift: { id: string; startTime: string; endTime: string; status: ShiftStatus } | null;
  nextShift: { id: string; startTime: string; endTime: string; status: ShiftStatus } | null;
  conflicts: AllocationConflict[];
}

export interface StaffAllocation {
  week: string;
  weekEnd: string;
  timezone: string;
  maxWeeklyScheduledHours: number;
  warnRatio: number;
  proposedShift: {
    id: string;
    startTime: string;
    endTime: string;
    shiftType: ShiftType;
    status: ShiftStatus;
    eligibleRoles: string[];
    house: { id: string; name: string } | null;
    durationHours: number;
  } | null;
  workers: AllocationWorker[];
}

export type LeaveStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';

export interface LeaveRequest {
  id: string;
  agencyId: string;
  workerId: string;
  startDate: string;
  endDate: string;
  reason: string | null;
  status: LeaveStatus;
  totalHours: number;
  rejectionReason: string | null;
  reviewedById: string | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
  worker: User;
  reviewedBy?: { id: string; name: string; email: string } | null;
}

export type RightToWorkStatus = 'MISSING' | 'CURRENT' | 'STALE';

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

export interface RightToWorkRow {
  user: { id: string; name: string; email: string; role: Role };
  shareCode: ShareCode | null;
  status: RightToWorkStatus;
}

export interface RightToWorkList {
  staleAfterDays: number;
  counts: { total: number; current: number; stale: number; missing: number };
  rows: RightToWorkRow[];
}

export type AccrualMethod = 'FLAT_RATE' | 'HOURLY' | 'LUMP_SUM';

/** GET /leave-requests/balance — the PTO Net Usable Balance breakdown, in hours. */
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
