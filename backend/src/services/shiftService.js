const { PrismaClient } = require('@prisma/client');
const leaveRequestService = require('./leaveRequestService');

const prisma = new PrismaClient();

const shiftInclude = {
  house: true,
  worker: { select: { id: true, name: true, email: true, fcmToken: true } },
  cancelledBy: { select: { id: true, name: true, email: true } },
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
      shiftType: data.shiftType || 'DAY',
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

module.exports = {
  createShift, getShiftById,
  getShiftByIdForAgency,
  getShiftsForWorker, getShiftsForHouse, getShiftsForManager,
  getAllShifts, listShiftsForUser, listRotaForUser,
  cancelShift,
};
