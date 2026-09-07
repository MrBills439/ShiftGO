const prisma = require('../lib/prisma');
const agencyCache = require('../lib/agencyCache');
const { agencyWeekRange, agencyWeekRangeForDate } = require('../lib/agencyTime');

// ─── Domain constants ──────────────────────────────────────────────────────
// Shift statuses that represent assigned scheduled work and therefore count
// towards a worker's weekly hours. OPEN (unassigned) and CANCELLED do not.
const COUNTED_STATUSES = ['SCHEDULED', 'CLAIMED', 'IN_PROGRESS', 'COMPLETED'];

// Warning band, derived purely from proximity to the agency maximum — no
// separate configurable threshold (simplest model). At/above this fraction of
// the max, the worker is NEAR_LIMIT.
const WARN_RATIO = 0.9;

const MS_PER_HOUR = 3_600_000;

/** Hours of a shift that fall inside [winStart, winEnd) — clips overnight /
 *  week-straddling shifts to the window so nothing is double-counted. */
function shiftHoursInWindow(shift, winStart, winEnd) {
  const s = Math.max(new Date(shift.startTime).getTime(), winStart.getTime());
  const e = Math.min(new Date(shift.endTime).getTime(), winEnd.getTime());
  return e > s ? (e - s) / MS_PER_HOUR : 0;
}

/** Full scheduled duration of a shift, in hours. */
function shiftDurationHours(shift) {
  return Math.max(0, (new Date(shift.endTime).getTime() - new Date(shift.startTime).getTime()) / MS_PER_HOUR);
}

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * Semantic hours state for a projected weekly total. Priority: an over-limit
 * total wins, then proximity to the limit, then over-contract, else safe.
 *
 *  OVER_LIMIT     projected > max                          (red — needs approval)
 *  NEAR_LIMIT     projected >= max * WARN_RATIO            (amber)
 *  OVER_CONTRACT  projected > contractedHours (if set)     (amber — allowed)
 *  SAFE                                                    (green)
 */
function classifyHours(projectedHours, contractedHours, maxWeeklyScheduledHours) {
  if (projectedHours > maxWeeklyScheduledHours) return 'OVER_LIMIT';
  if (projectedHours >= maxWeeklyScheduledHours * WARN_RATIO) return 'NEAR_LIMIT';
  if (contractedHours != null && projectedHours > contractedHours) return 'OVER_CONTRACT';
  return 'SAFE';
}

/**
 * Sum of a worker's counted shift hours inside the given agency week, clipped
 * to the week window. `excludeShiftId` drops one shift (used when re-validating
 * an existing shift that is being edited).
 */
async function weeklyScheduledHours(workerId, agencyId, weekStart, weekEnd, excludeShiftId = null) {
  const shifts = await prisma.shift.findMany({
    where: {
      agencyId,
      workerId,
      status: { in: COUNTED_STATUSES },
      startTime: { lt: weekEnd },
      endTime: { gt: weekStart },
      ...(excludeShiftId ? { id: { not: excludeShiftId } } : {}),
    },
    select: { id: true, startTime: true, endTime: true },
  });
  return round2(shifts.reduce((sum, s) => sum + shiftHoursInWindow(s, weekStart, weekEnd), 0));
}

/**
 * Everything the assignment guard needs for one worker + one proposed shift.
 * The proposed shift's hours are clipped to the week that contains its start.
 */
async function evaluateAssignment({ worker, agency, proposedStart, proposedEnd, excludeShiftId = null }) {
  const week = agencyWeekRange(agency.timezone, proposedStart);
  const scheduledHours = await weeklyScheduledHours(worker.id, agency.id, week.start, week.end, excludeShiftId);
  const proposedShift = { startTime: proposedStart, endTime: proposedEnd };
  const proposedHours = round2(shiftHoursInWindow(proposedShift, week.start, week.end));
  const projectedHours = round2(scheduledHours + proposedHours);
  const max = agency.maxWeeklyScheduledHours;
  return {
    week,
    scheduledHours,
    proposedHours,
    projectedHours,
    maxWeeklyScheduledHours: max,
    contractedHours: worker.contractedHours ?? null,
    hoursStatus: classifyHours(projectedHours, worker.contractedHours ?? null, max),
    exceedsMax: projectedHours > max,
  };
}

// ─── Worker scoping (mirrors staff-directory visibility) ────────────────────
async function scopedWorkerIds(user, agencyId) {
  // HR & MANAGER see the whole agency's assignable staff; a TEAM_LEADER only
  // sees workers in the house(s) they lead.
  if (user.role === 'HR' || user.role === 'MANAGER') return null; // null = no house filter
  const houses = await prisma.houseTeamLeader.findMany({ where: { teamLeaderId: user.id }, select: { houseId: true } });
  const houseIds = houses.map((h) => h.houseId);
  if (houseIds.length === 0) return [];
  const links = await prisma.houseWorker.findMany({ where: { houseId: { in: houseIds } }, select: { workerId: true } });
  return [...new Set(links.map((l) => l.workerId))];
}

/**
 * Staff Allocation view: for the selected agency week, and optionally a proposed
 * (open/cover) shift, return decision-support data per assignable worker.
 * Agency-scoped; manager/team-leader house scoping respected.
 */
async function getAllocation(user, agencyId, { week, proposedShiftId } = {}) {
  const agency = await agencyCache.getAgencySettings(agencyId);
  const weekRange = agencyWeekRangeForDate(agency?.timezone, week);
  const max = agency?.maxWeeklyScheduledHours ?? 60;
  const now = new Date();

  const workerIds = await scopedWorkerIds(user, agencyId);
  if (Array.isArray(workerIds) && workerIds.length === 0) {
    return { week: weekRange.start.toISOString(), weekEnd: weekRange.end.toISOString(), timezone: weekRange.timeZone, maxWeeklyScheduledHours: max, proposedShift: null, workers: [] };
  }

  const workers = await prisma.user.findMany({
    where: {
      agencyId,
      status: 'ACTIVE',
      role: { in: ['WORKER', 'TEAM_LEADER'] },
      ...(workerIds ? { id: { in: workerIds } } : {}),
    },
    select: { id: true, name: true, role: true, profilePicture: true, contractedHours: true },
    orderBy: { name: 'asc' },
  });
  if (workers.length === 0) {
    return { week: weekRange.start.toISOString(), weekEnd: weekRange.end.toISOString(), timezone: weekRange.timeZone, maxWeeklyScheduledHours: max, proposedShift: null, workers: [] };
  }

  // Every counted shift for these workers that touches the week — one query.
  const weekShifts = await prisma.shift.findMany({
    where: {
      agencyId,
      workerId: { in: workers.map((w) => w.id) },
      status: { in: COUNTED_STATUSES },
      startTime: { lt: weekRange.end },
      endTime: { gt: weekRange.start },
    },
    select: { id: true, workerId: true, startTime: true, endTime: true, status: true, houseId: true, shiftType: true },
    orderBy: { startTime: 'asc' },
  });

  // Optional proposed shift for projections + conflict detection.
  let proposed = null;
  if (proposedShiftId) {
    proposed = await prisma.shift.findFirst({
      where: { id: proposedShiftId, agencyId },
      select: { id: true, startTime: true, endTime: true, houseId: true, shiftType: true, status: true, eligibleRoles: true, house: { select: { id: true, name: true } } },
    });
  }
  const proposedStart = proposed ? new Date(proposed.startTime) : null;
  const proposedEnd = proposed ? new Date(proposed.endTime) : null;
  const proposedHoursInThisWeek = proposed ? round2(shiftHoursInWindow(proposed, weekRange.start, weekRange.end)) : 0;

  // Overlapping non-cancelled shifts + approved leave for the proposal window.
  let overlapByWorker = new Map();
  let onLeave = new Set();
  if (proposed) {
    const ids = workers.map((w) => w.id);
    const [overlaps, leaves] = await Promise.all([
      prisma.shift.findMany({
        where: {
          agencyId,
          workerId: { in: ids },
          status: { not: 'CANCELLED' },
          startTime: { lt: proposedEnd },
          endTime: { gt: proposedStart },
        },
        select: { id: true, workerId: true, startTime: true, endTime: true, status: true },
      }),
      prisma.leaveRequest.findMany({
        where: {
          agencyId,
          workerId: { in: ids },
          status: 'APPROVED',
          AND: [{ startDate: { lte: proposedEnd } }, { endDate: { gte: proposedStart } }],
        },
        select: { workerId: true },
      }),
    ]);
    overlapByWorker = overlaps.reduce((m, s) => {
      const arr = m.get(s.workerId) || [];
      arr.push({ shiftId: s.id, startTime: s.startTime, endTime: s.endTime, status: s.status });
      m.set(s.workerId, arr);
      return m;
    }, new Map());
    onLeave = new Set(leaves.map((l) => l.workerId));
  }

  const rows = workers.map((w) => {
    const mine = weekShifts.filter((s) => s.workerId === w.id);
    const scheduledHours = round2(mine.reduce((sum, s) => sum + shiftHoursInWindow(s, weekRange.start, weekRange.end), 0));
    const contractedHours = w.contractedHours ?? null;
    const remainingContractedHours = contractedHours != null ? round2(Math.max(0, contractedHours - scheduledHours)) : null;

    const onShiftNow = weekShifts.some(
      (s) => s.workerId === w.id && new Date(s.startTime) <= now && new Date(s.endTime) > now,
    );
    // Anything in the future this worker is already rostered for.
    const future = mine.filter((s) => new Date(s.startTime) > now);
    const activeShift = mine.find((s) => new Date(s.startTime) <= now && new Date(s.endTime) > now) || null;
    const nextShift = future[0] || null;

    const conflicts = overlapByWorker.get(w.id) || [];
    const projectedHours = proposed ? round2(scheduledHours + proposedHoursInThisWeek) : scheduledHours;
    const hoursStatus = classifyHours(projectedHours, contractedHours, max);

    // "Working right now" — nothing to do with the proposed shift.
    const currentStatus = onShiftNow ? 'ON_SHIFT' : 'OFF_SHIFT';

    // Availability for the SELECTED proposed shift, from real conflict data
    // (overlapping shift, then approved leave). Only meaningful when a shift is
    // selected — otherwise null.
    let availabilityForSelectedShift = null;
    if (proposed) {
      availabilityForSelectedShift =
        conflicts.length > 0 ? 'CONFLICT' : onLeave.has(w.id) ? 'ON_LEAVE' : 'AVAILABLE';
    }

    return {
      id: w.id,
      name: w.name,
      profilePicture: w.profilePicture ?? null,
      role: w.role,
      contractedHours,
      scheduledHours,
      remainingContractedHours,
      projectedHours,
      currentStatus,
      availabilityForSelectedShift,
      hoursStatus,
      maxWeeklyScheduledHours: max,
      hasOverlap: conflicts.length > 0,
      onLeaveForSelectedShift: proposed ? onLeave.has(w.id) : null,
      overContract: contractedHours != null && projectedHours > contractedHours,
      activeShift: activeShift ? { id: activeShift.id, startTime: activeShift.startTime, endTime: activeShift.endTime, status: activeShift.status } : null,
      nextShift: nextShift ? { id: nextShift.id, startTime: nextShift.startTime, endTime: nextShift.endTime, status: nextShift.status } : null,
      conflicts,
    };
  });

  return {
    week: weekRange.start.toISOString(),
    weekEnd: weekRange.end.toISOString(),
    timezone: weekRange.timeZone,
    maxWeeklyScheduledHours: max,
    warnRatio: WARN_RATIO,
    proposedShift: proposed
      ? {
          id: proposed.id,
          startTime: proposed.startTime,
          endTime: proposed.endTime,
          shiftType: proposed.shiftType,
          status: proposed.status,
          eligibleRoles: proposed.eligibleRoles?.length ? proposed.eligibleRoles : ['WORKER'],
          house: proposed.house ? { id: proposed.house.id, name: proposed.house.name } : null,
          durationHours: proposedStart ? round2(shiftDurationHours(proposed)) : 0,
        }
      : null,
    workers: rows,
  };
}

module.exports = {
  COUNTED_STATUSES,
  WARN_RATIO,
  shiftHoursInWindow,
  shiftDurationHours,
  classifyHours,
  weeklyScheduledHours,
  evaluateAssignment,
  getAllocation,
};
