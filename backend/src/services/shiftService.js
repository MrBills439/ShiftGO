const prisma = require('../lib/prisma');
const leaveRequestService = require('./leaveRequestService');

const shiftInclude = {
  house: true,
  worker: { select: { id: true, name: true, email: true, fcmToken: true } },
  cancelledBy: { select: { id: true, name: true, email: true } },
  claims: { select: { id: true } },
  timesheet: {
    select: {
      id: true,
      clockInAt: true,
      clockOutAt: true,
      totalHours: true,
      status: true,
      reviewedAt: true,
    },
  },
};

function statusConflict(message) {
  const err = new Error(message);
  err.statusCode = 409;
  return err;
}

function notFound(message = 'Shift not found') {
  const err = new Error(message);
  err.statusCode = 404;
  return err;
}

function forbidden(message = 'Record does not belong to your agency') {
  const err = new Error(message);
  err.statusCode = 403;
  return err;
}

async function createShift(data, createdById, agencyId) {
  const startTime = new Date(data.startTime);
  const endTime = new Date(data.endTime);
  const [worker, house] = await Promise.all([
    prisma.user.findFirst({ where: { id: data.workerId, agencyId } }),
    prisma.house.findFirst({ where: { id: data.houseId, agencyId } }),
  ]);
  if (!worker || !house) throw forbidden('Worker and house must belong to your agency');
  if (worker.status === 'DEACTIVATED') throw forbidden('Worker is deactivated and cannot be assigned new shifts');

  const overlap = await prisma.shift.findFirst({
    where: {
      agencyId,
      workerId: data.workerId,
      status: { not: 'CANCELLED' },
      startTime: { lt: endTime },
      endTime: { gt: startTime },
    },
    select: { id: true, startTime: true, endTime: true, status: true },
  });
  if (overlap) throw statusConflict('Worker already has an overlapping shift');

  // Check for approved leave during shift period
  const leaveConflicts = await leaveRequestService.checkLeaveConflict(
    data.workerId,
    startTime,
    endTime,
    agencyId
  );
  if (leaveConflicts.length > 0) {
    throw statusConflict('Worker is on approved leave during this shift');
  }

  return prisma.shift.create({
    data: {
      agencyId,
      houseId: data.houseId,
      workerId: data.workerId,
      createdById,
      startTime,
      endTime,
      date: new Date(data.date),
      shiftType: data.shiftType || 'LONG_DAY',
      urgent: Boolean(data.urgent),
    },
    include: shiftInclude,
  });
}

function dateRangeWhere(filters = {}) {
  const where = {};
  if (filters.startDate || filters.endDate) {
    where.startTime = {};
    where.endTime = {};
    if (filters.startDate) where.endTime.gt = new Date(filters.startDate);
    if (filters.endDate) where.startTime.lt = new Date(filters.endDate);
  }
  return where;
}

function filteredWhere(baseWhere, filters = {}) {
  return {
    ...baseWhere,
    ...dateRangeWhere(filters),
    ...(filters.houseId ? { houseId: filters.houseId } : {}),
    ...(filters.workerId ? { workerId: filters.workerId } : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.shiftType ? { shiftType: filters.shiftType } : {}),
  };
}

async function getShiftById(id) {
  return prisma.shift.findUnique({
    where: { id },
    include: shiftInclude,
  });
}

async function getShiftByIdForAgency(id, agencyId) {
  return prisma.shift.findFirst({
    where: { id, agencyId },
    include: shiftInclude,
  });
}

async function getShiftsForWorker(workerId, agencyId, filters = {}) {
  return prisma.shift.findMany({
    where: filteredWhere({ agencyId, workerId, status: { not: 'CANCELLED' } }, filters),
    include: shiftInclude,
    orderBy: { date: 'asc' },
  });
}

async function getShiftsForHouse(houseId, agencyId, filters = {}) {
  return prisma.shift.findMany({
    where: filteredWhere({ agencyId, houseId }, filters),
    include: shiftInclude,
    orderBy: { date: 'asc' },
  });
}

async function getShiftsForManager(managerId, agencyId, filters = {}) {
  const houses = await prisma.house.findMany({ where: { agencyId, managerId }, select: { id: true } });
  const houseIds = houses.map((h) => h.id);
  return prisma.shift.findMany({
    where: filteredWhere({ agencyId, houseId: { in: houseIds } }, filters),
    include: shiftInclude,
    orderBy: { date: 'asc' },
  });
}

async function getAllShifts(agencyId, filters = {}) {
  return prisma.shift.findMany({
    where: filteredWhere({ agencyId }, filters),
    include: shiftInclude,
    orderBy: { date: 'asc' },
  });
}

async function listShiftsForUser(user, agencyId, filters = {}) {
  const { role, id } = user;
  if (role === 'WORKER') return getShiftsForWorker(id, agencyId, { ...filters, workerId: id });
  if (role === 'MANAGER') return getShiftsForManager(id, agencyId, filters);
  if (role === 'TEAM_LEADER') {
    if (filters.houseId) return getShiftsForHouse(filters.houseId, agencyId, filters);
    const assignment = await prisma.houseTeamLeader.findFirst({ where: { teamLeaderId: id } });
    if (!assignment) return [];
    return getShiftsForHouse(assignment.houseId, agencyId, filters);
  }
  if (filters.houseId) return getShiftsForHouse(filters.houseId, agencyId, filters);
  if (filters.workerId) return getShiftsForWorker(filters.workerId, agencyId, filters);
  return getAllShifts(agencyId, filters);
}

function toRotaItem(shift) {
  return {
    shiftId: shift.id,
    worker: shift.worker ? { id: shift.worker.id, name: shift.worker.name, email: shift.worker.email } : null,
    house: shift.house ? {
      id: shift.house.id,
      name: shift.house.name,
      address: shift.house.address,
    } : null,
    startTime: shift.startTime,
    endTime: shift.endTime,
    shiftType: shift.shiftType,
    status: shift.status,
    urgent: shift.urgent,
    eligibleRoles: shift.eligibleRoles || [],
    claimCount: shift.claims?.length ?? 0,
    cancellationReason: shift.cancellationReason,
    timesheet: shift.timesheet ? {
      id: shift.timesheet.id,
      clockInAt: shift.timesheet.clockInAt,
      clockOutAt: shift.timesheet.clockOutAt,
      totalHours: shift.timesheet.totalHours,
      status: shift.timesheet.status,
      reviewedAt: shift.timesheet.reviewedAt,
    } : null,
  };
}

async function listRotaForUser(user, agencyId, filters = {}) {
  const shifts = await listShiftsForUser(user, agencyId, filters);
  return shifts.map(toRotaItem);
}

async function cancelShift(id, cancelledById, cancellationReason, agencyId) {
  const shift = await prisma.shift.findFirst({
    where: { id, agencyId },
    include: shiftInclude,
  });
  if (!shift) throw notFound();
  if (shift.status === 'CANCELLED') throw statusConflict('Shift is already cancelled');
  if (shift.status === 'COMPLETED') throw statusConflict('Completed shifts cannot be cancelled');
  if (shift.status === 'IN_PROGRESS') throw statusConflict('In-progress shifts cannot be cancelled');

  return prisma.shift.update({
    where: { id },
    data: {
      status: 'CANCELLED',
      cancelledAt: new Date(),
      cancelledById,
      cancellationReason,
    },
    include: shiftInclude,
  });
}

async function updateShift(id, data, agencyId) {
  const existing = await prisma.shift.findFirst({ where: { id, agencyId } });
  if (!existing) throw notFound();
  if (existing.status === 'CANCELLED') throw statusConflict('Cancelled shifts cannot be edited');
  if (existing.status === 'COMPLETED') throw statusConflict('Completed shifts cannot be edited');
  if (existing.status === 'IN_PROGRESS') throw statusConflict('A shift already in progress cannot be edited');

  const workerId = data.workerId !== undefined ? data.workerId : existing.workerId;
  const houseId = data.houseId ?? existing.houseId;
  const startTime = data.startTime ? new Date(data.startTime) : existing.startTime;
  const endTime = data.endTime ? new Date(data.endTime) : existing.endTime;

  const [worker, house] = await Promise.all([
    workerId ? prisma.user.findFirst({ where: { id: workerId, agencyId } }) : null,
    prisma.house.findFirst({ where: { id: houseId, agencyId } }),
  ]);
  if (workerId && !worker) throw forbidden('Worker must belong to your agency');
  if (!house) throw forbidden('House must belong to your agency');
  if (worker && worker.status === 'DEACTIVATED') throw forbidden('Worker is deactivated and cannot be assigned shifts');

  if (workerId) {
    const overlap = await prisma.shift.findFirst({
      where: {
        id: { not: id },
        agencyId,
        workerId,
        status: { not: 'CANCELLED' },
        startTime: { lt: endTime },
        endTime: { gt: startTime },
      },
      select: { id: true },
    });
    if (overlap) throw statusConflict('Worker already has an overlapping shift');

    const leaveConflicts = await leaveRequestService.checkLeaveConflict(workerId, startTime, endTime, agencyId);
    if (leaveConflicts.length > 0) throw statusConflict('Worker is on approved leave during this shift');
  }

  // A worker being present/absent drives whether this is an assigned shift or
  // a cover-needed one — only recompute when workerId is actually part of
  // this edit, so leaving it untouched can't accidentally downgrade e.g. a
  // CLAIMED shift back to SCHEDULED.
  const status = data.workerId !== undefined ? (workerId ? 'SCHEDULED' : 'OPEN') : existing.status;

  return prisma.shift.update({
    where: { id },
    data: {
      workerId: workerId || null,
      houseId,
      startTime,
      endTime,
      date: data.date ? new Date(data.date) : existing.date,
      shiftType: data.shiftType ?? existing.shiftType,
      urgent: data.urgent !== undefined ? Boolean(data.urgent) : existing.urgent,
      status,
      eligibleRoles: data.eligibleRoles !== undefined ? data.eligibleRoles : (workerId ? [] : existing.eligibleRoles),
    },
    include: shiftInclude,
  });
}

function effectiveEligibleRoles(shift) {
  return shift.eligibleRoles?.length ? shift.eligibleRoles : ['WORKER'];
}

async function createOpenShift(data, createdById, agencyId) {
  const startTime = new Date(data.startTime);
  const endTime = new Date(data.endTime);
  const house = await prisma.house.findFirst({ where: { id: data.houseId, agencyId } });
  if (!house) throw forbidden('House must belong to your agency');

  return prisma.shift.create({
    data: {
      agencyId,
      houseId: data.houseId,
      createdById,
      startTime,
      endTime,
      date: new Date(data.date),
      shiftType: data.shiftType || 'LONG_DAY',
      status: 'OPEN',
      eligibleRoles: Array.isArray(data.eligibleRoles) ? data.eligibleRoles : [],
      urgent: Boolean(data.urgent),
    },
    include: shiftInclude,
  });
}

async function openShift(id, agencyId, { eligibleRoles, urgent } = {}) {
  const shift = await prisma.shift.findFirst({ where: { id, agencyId } });
  if (!shift) throw notFound();
  if (shift.status !== 'SCHEDULED') throw statusConflict(`Cannot open a shift with status ${shift.status}`);

  return prisma.shift.update({
    where: { id },
    data: {
      status: 'OPEN',
      workerId: null,
      eligibleRoles: Array.isArray(eligibleRoles) ? eligibleRoles : [],
      ...(urgent !== undefined ? { urgent: Boolean(urgent) } : {}),
    },
    include: shiftInclude,
  });
}

async function claimShift(id, worker, agencyId) {
  const shift = await prisma.shift.findFirst({ where: { id, agencyId } });
  if (!shift) throw notFound();
  if (shift.status !== 'OPEN') throw statusConflict('Shift is no longer open');

  if (!effectiveEligibleRoles(shift).includes(worker.role)) {
    throw forbidden('You are not eligible to claim this shift');
  }

  const overlap = await prisma.shift.findFirst({
    where: {
      agencyId,
      workerId: worker.id,
      status: { not: 'CANCELLED' },
      startTime: { lt: shift.endTime },
      endTime: { gt: shift.startTime },
    },
    select: { id: true },
  });
  if (overlap) throw statusConflict('You already have an overlapping shift');

  const leaveConflicts = await leaveRequestService.checkLeaveConflict(
    worker.id,
    shift.startTime,
    shift.endTime,
    agencyId
  );
  if (leaveConflicts.length > 0) throw statusConflict('You are on approved leave during this shift');

  const claim = await prisma.$transaction(async (tx) => {
    // Atomic guard: only succeeds if the shift is still OPEN at the moment of
    // the update, so a concurrent second claim reliably loses the race.
    const { count } = await tx.shift.updateMany({
      where: { id, agencyId, status: 'OPEN' },
      data: { status: 'CLAIMED', workerId: worker.id },
    });
    if (count === 0) throw statusConflict('Shift is no longer open');

    return tx.shiftClaim.create({
      data: { shiftId: id, workerId: worker.id },
    });
  });

  const updatedShift = await prisma.shift.findUnique({ where: { id }, include: shiftInclude });
  return { shift: updatedShift, claim };
}

/**
 * A worker releases a shift they're assigned to. It becomes an OPEN shift other
 * eligible workers can pick up. Returns the updated shift plus the manager /
 * team-leader recipients who should be told.
 */
async function dropShift(id, worker, agencyId, { reason } = {}) {
  const shift = await prisma.shift.findFirst({ where: { id, agencyId }, include: shiftInclude });
  if (!shift) throw notFound();
  if (shift.workerId !== worker.id) throw forbidden('You can only drop shifts assigned to you');
  if (shift.status !== 'SCHEDULED') {
    throw statusConflict('Only a scheduled shift can be dropped');
  }
  if (new Date(shift.startTime) <= new Date()) {
    throw statusConflict('This shift has already started — contact your manager');
  }

  const updated = await prisma.shift.update({
    where: { id },
    data: {
      status: 'OPEN',
      workerId: null,
      urgent: true,
      eligibleRoles: effectiveEligibleRoles(shift),
    },
    include: shiftInclude,
  });

  const house = await prisma.house.findUnique({
    where: { id: shift.houseId },
    select: {
      manager: { select: { id: true, name: true, fcmToken: true } },
      teamLeaders: { select: { teamLeader: { select: { id: true, name: true, fcmToken: true } } } },
    },
  });

  const recipientsById = new Map();
  if (house?.manager && house.manager.id !== worker.id) recipientsById.set(house.manager.id, house.manager);
  for (const tl of house?.teamLeaders ?? []) {
    if (tl.teamLeader && tl.teamLeader.id !== worker.id) recipientsById.set(tl.teamLeader.id, tl.teamLeader);
  }

  return { shift: updated, recipients: [...recipientsById.values()], reason: reason?.trim() || null };
}

async function listOpenShiftsForWorker(worker, agencyId) {
  const shifts = await prisma.shift.findMany({
    where: {
      agencyId,
      status: 'OPEN',
      OR: [{ eligibleRoles: { isEmpty: true } }, { eligibleRoles: { has: worker.role } }],
    },
    include: shiftInclude,
    orderBy: { startTime: 'asc' },
  });
  return shifts.map((shift) => ({ ...shift, claimCount: shift.claims.length }));
}

async function findEligibleWorkers(shift, agencyId, { excludeUserId } = {}) {
  return prisma.user.findMany({
    where: {
      agencyId,
      status: 'ACTIVE',
      role: { in: effectiveEligibleRoles(shift) },
      ...(excludeUserId ? { id: { not: excludeUserId } } : {}),
    },
    select: { id: true },
  });
}

async function listClaims(shiftId, agencyId) {
  const shift = await prisma.shift.findFirst({ where: { id: shiftId, agencyId } });
  if (!shift) throw notFound();

  return prisma.shiftClaim.findMany({
    where: { shiftId },
    include: { worker: { select: { id: true, name: true, email: true } } },
    orderBy: { claimedAt: 'asc' },
  });
}

module.exports = {
  createShift, createOpenShift, getShiftById,
  getShiftByIdForAgency,
  getShiftsForWorker, getShiftsForHouse, getShiftsForManager,
  getAllShifts, listShiftsForUser, listRotaForUser,
  cancelShift, updateShift,
  openShift, claimShift, dropShift, listOpenShiftsForWorker, listClaims,
  effectiveEligibleRoles, findEligibleWorkers,
};
