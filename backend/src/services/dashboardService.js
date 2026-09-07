const prisma = require('../lib/prisma');
const shiftService = require('./shiftService');
const timesheetService = require('./timesheetService');
const leaveRequestService = require('./leaveRequestService');
const rightToWorkService = require('./rightToWorkService');
const agencyCache = require('../lib/agencyCache');
const { agencyDayRange } = require('../lib/agencyTime');

const MANAGER_PLUS = ['MANAGER', 'HR'];
const TEAM_LEADER_PLUS = ['TEAM_LEADER', 'MANAGER', 'HR'];

/**
 * Derive a single human attendance label for a shift from EXISTING data only —
 * the shift's own status plus its timesheet. It does not introduce a new
 * attendance state; it just names what the current data already says.
 */
function attendanceLabel(shift, now, needsReviewShiftIds) {
  if (shift.status === 'OPEN' || !shift.workerId) return 'Open';
  if (needsReviewShiftIds.has(shift.id)) return 'Needs review';
  if (shift.status === 'COMPLETED' || shift.timesheet?.clockOutAt) return 'Completed';
  if (shift.status === 'IN_PROGRESS' || (shift.timesheet?.clockInAt && !shift.timesheet?.clockOutAt)) {
    return 'Clocked in';
  }
  if (
    shift.status === 'SCHEDULED' &&
    !shift.timesheet?.clockInAt &&
    new Date(shift.startTime) <= now &&
    new Date(shift.endTime) >= now
  ) {
    return 'Late';
  }
  return 'Scheduled';
}

function shiftSummary(shift, now, needsReviewShiftIds) {
  return {
    id: shift.id,
    worker: shift.worker ? { id: shift.worker.id, name: shift.worker.name } : null,
    house: shift.house ? { id: shift.house.id, name: shift.house.name } : null,
    startTime: shift.startTime,
    endTime: shift.endTime,
    shiftType: shift.shiftType,
    status: shift.status,
    attendance: attendanceLabel(shift, now, needsReviewShiftIds),
  };
}

/**
 * Operational "Today" summary for the ops dashboard (TEAM_LEADER, MANAGER, HR).
 *
 * Everything is scoped to `agencyId`. Shift-derived figures go through
 * shiftService.listShiftsForUser, which already applies each role's visibility
 * (team leader -> their house, manager -> their houses, HR -> whole agency).
 * Manager/HR-only sections (attendance reviews, timesheet approvals, leave
 * approvals, Right to Work) are omitted for team leaders, mirroring the route
 * guards on those features.
 */
async function getTodaySummary(user, agencyId, now = new Date()) {
  const agency = await agencyCache.getAgencySettings(agencyId);

  // "Today" is the agency's calendar day in its configured timezone, expressed
  // as UTC instants for the queries below. Never the server's UTC day.
  const today = agencyDayRange(agency?.timezone, now, 0);
  const tomorrow = agencyDayRange(agency?.timezone, now, 1);
  const dayStart = today.start;
  const dayEnd = today.end; // === tomorrow.start
  const twoDaysOut = tomorrow.end;

  const isManagerPlus = MANAGER_PLUS.includes(user.role);

  // Two-week horizon for the "open shifts needing cover" list — every OPEN /
  // unassigned shift HR (or a manager/lead within their scope) still has to
  // fill, not only today's. Uses the same role-scoped shiftService.
  const coverHorizonEnd = agencyDayRange(agency?.timezone, now, 14).end;

  // Role-scoped. Bounded windows so the queries never grow with history.
  const [windowShifts, openShiftsRaw] = await Promise.all([
    shiftService.listShiftsForUser(user, agencyId, {
      startDate: dayStart.toISOString(),
      endDate: twoDaysOut.toISOString(),
    }),
    shiftService.listShiftsForUser(user, agencyId, {
      status: 'OPEN',
      startDate: dayStart.toISOString(),
      endDate: coverHorizonEnd.toISOString(),
    }),
  ]);

  const inDay = (s, from, to) => new Date(s.startTime) >= from && new Date(s.startTime) < to;
  const todayAll = windowShifts.filter((s) => inDay(s, dayStart, dayEnd));
  const tomorrowAll = windowShifts.filter((s) => inDay(s, dayEnd, twoDaysOut));

  const openShifts = openShiftsRaw
    .filter((s) => s.status === 'OPEN')
    .slice()
    .sort((a, b) => new Date(a.startTime) - new Date(b.startTime))
    .slice(0, 25)
    .map((s) => ({
      id: s.id,
      house: s.house ? { id: s.house.id, name: s.house.name, address: s.house.address } : null,
      startTime: s.startTime,
      endTime: s.endTime,
      shiftType: s.shiftType,
      status: s.status,
      urgent: !!s.urgent,
      eligibleRoles: s.eligibleRoles?.length ? s.eligibleRoles : ['WORKER'],
      claimCount: s.claims?.length ?? 0,
      href: '/dashboard/rota',
    }));

  const scheduled = todayAll.filter((s) => s.status !== 'CANCELLED');
  const covered = scheduled.filter((s) => s.workerId && s.status !== 'OPEN');
  const uncovered = scheduled.filter((s) => s.status === 'OPEN' || !s.workerId);
  const workersLive = scheduled.filter((s) => s.status === 'IN_PROGRESS');
  const late = scheduled.filter(
    (s) =>
      s.status === 'SCHEDULED' &&
      s.workerId &&
      !s.timesheet?.clockInAt &&
      new Date(s.startTime) <= now &&
      new Date(s.endTime) >= now
  );

  // Manager/HR-only operational data.
  let needsReview = [];
  let pendingTimesheets = [];
  let pendingTimesheetCount = 0;
  let pendingLeave = [];
  let rtwIssues = [];

  if (isManagerPlus) {
    [needsReview, pendingLeave] = await Promise.all([
      timesheetService.getNeedsReview(agencyId),
      leaveRequestService.getLeaveRequests(user.id, user.role, agencyId, { status: 'PENDING' }),
    ]);

    const [tsList, tsCount, rtw] = await Promise.all([
      prisma.timesheet.findMany({
        where: { agencyId, status: 'PENDING', clockOutAt: { not: null }, needsReview: false },
        include: {
          worker: { select: { id: true, name: true } },
          house: { select: { id: true, name: true } },
        },
        orderBy: { clockOutAt: 'desc' },
        take: 5,
      }),
      prisma.timesheet.count({
        where: { agencyId, status: 'PENDING', clockOutAt: { not: null }, needsReview: false },
      }),
      rightToWorkService.listForAgency(agencyId),
    ]);
    pendingTimesheets = tsList;
    pendingTimesheetCount = tsCount;
    rtwIssues = rtw.rows.filter((r) => r.status !== 'CURRENT');
  }

  const needsReviewShiftIds = new Set(needsReview.map((t) => t.shift?.id).filter(Boolean));

  // ── Issues requiring attention ────────────────────────────────────────────
  const issues = [];

  for (const s of late) {
    issues.push({
      id: `late-${s.id}`,
      type: 'LATE',
      severity: 'warning',
      title: `${s.worker?.name ?? 'Worker'} has not clocked in`,
      detail: `Due at ${s.house?.name ?? 'a service'} since this shift started`,
      worker: s.worker ? { id: s.worker.id, name: s.worker.name } : null,
      house: s.house ? { id: s.house.id, name: s.house.name } : null,
      at: s.startTime,
      href: '/dashboard/rota',
    });
  }

  for (const s of uncovered) {
    issues.push({
      id: `uncovered-${s.id}`,
      type: 'UNCOVERED_SHIFT',
      severity: 'critical',
      title: `Uncovered shift: ${s.house?.name ?? 'service'}`,
      detail: 'No worker assigned for today',
      worker: null,
      house: s.house ? { id: s.house.id, name: s.house.name } : null,
      at: s.startTime,
      href: '/dashboard/rota',
    });
  }

  for (const t of needsReview) {
    issues.push({
      id: `review-${t.id}`,
      type: 'ATTENDANCE_REVIEW',
      severity: 'warning',
      title: `Attendance needs review: ${t.worker?.name ?? 'worker'}`,
      detail: t.reviewReason || 'Flagged by the attendance system',
      worker: t.worker ? { id: t.worker.id, name: t.worker.name } : null,
      house: t.house ? { id: t.house.id, name: t.house.name } : null,
      at: t.shift?.endTime ?? t.clockInAt ?? null,
      href: '/dashboard/timesheets',
    });
  }

  for (const r of rtwIssues) {
    issues.push({
      id: `rtw-${r.user.id}`,
      type: 'RIGHT_TO_WORK',
      severity: r.status === 'MISSING' ? 'critical' : 'warning',
      title: `Right to Work ${r.status === 'MISSING' ? 'missing' : 'out of date'}: ${r.user.name}`,
      detail:
        r.status === 'MISSING'
          ? 'No share code on file'
          : `Share code last checked over ${rightToWorkService.STALE_AFTER_DAYS} days ago`,
      worker: { id: r.user.id, name: r.user.name },
      house: null,
      at: r.shareCode?.shareDate ?? null,
      href: '/dashboard/right-to-work',
    });
  }

  for (const t of pendingTimesheets) {
    issues.push({
      id: `timesheet-${t.id}`,
      type: 'TIMESHEET_APPROVAL',
      severity: 'info',
      title: `Timesheet awaiting approval: ${t.worker?.name ?? 'worker'}`,
      detail: t.house?.name ? `Shift at ${t.house.name}` : 'Completed shift',
      worker: t.worker ? { id: t.worker.id, name: t.worker.name } : null,
      house: t.house ? { id: t.house.id, name: t.house.name } : null,
      at: t.clockOutAt,
      href: '/dashboard/timesheets',
    });
  }

  for (const l of pendingLeave) {
    issues.push({
      id: `leave-${l.id}`,
      type: 'LEAVE_APPROVAL',
      severity: 'info',
      title: `Leave request awaiting approval: ${l.worker?.name ?? 'worker'}`,
      detail: `${new Date(l.startDate).toLocaleDateString('en-GB')} – ${new Date(l.endDate).toLocaleDateString('en-GB')}`,
      worker: l.worker ? { id: l.worker.id, name: l.worker.name } : null,
      house: null,
      at: l.createdAt,
      href: '/dashboard/leave',
    });
  }

  const severityRank = { critical: 0, warning: 1, info: 2 };
  issues.sort((a, b) => severityRank[a.severity] - severityRank[b.severity]);

  // ── Staff count (for the "no staff yet" empty state) ──────────────────────
  const staffTotal = await prisma.user.count({
    where: { agencyId, status: 'ACTIVE', role: { in: ['WORKER', 'TEAM_LEADER'] } },
  });

  const scheduledCount = scheduled.length;
  const coveredCount = covered.length;

  return {
    date: dayStart.toISOString(),
    timezone: today.timeZone,
    role: user.role,
    permissions: {
      canCreateShift: TEAM_LEADER_PLUS.includes(user.role),
      canManageStaff: MANAGER_PLUS.includes(user.role),
      canReviewApprovals: isManagerPlus,
    },
    coverage: {
      // null (not 100) when there is nothing scheduled — the UI shows "No shifts".
      percent: scheduledCount > 0 ? Math.round((coveredCount / scheduledCount) * 100) : null,
      scheduled: scheduledCount,
      covered: coveredCount,
      uncovered: uncovered.length,
    },
    workersLive: workersLive.length,
    openIssues: issues.length,
    pendingApprovals: {
      timesheets: pendingTimesheetCount,
      attendanceReviews: needsReview.length,
      leave: pendingLeave.length,
      total: pendingTimesheetCount + needsReview.length + pendingLeave.length,
    },
    issues,
    todayShifts: scheduled
      .slice()
      .sort((a, b) => new Date(a.startTime) - new Date(b.startTime))
      .map((s) => shiftSummary(s, now, needsReviewShiftIds)),
    tomorrow: {
      count: tomorrowAll.filter((s) => s.status !== 'CANCELLED').length,
      shifts: tomorrowAll
        .filter((s) => s.status !== 'CANCELLED')
        .slice()
        .sort((a, b) => new Date(a.startTime) - new Date(b.startTime))
        .slice(0, 5)
        .map((s) => shiftSummary(s, now, needsReviewShiftIds)),
    },
    // Every OPEN / cover shift still needing a worker over the next two weeks,
    // within this role's scope. `openToday` is the subset that starts today.
    openShifts,
    openShiftsToday: openShifts.filter((s) => inDay(s, dayStart, dayEnd)).length,
    staff: { total: staffTotal },
  };
}

module.exports = { getTodaySummary };
