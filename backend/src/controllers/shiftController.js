const { PrismaClient } = require('@prisma/client');
const shiftService = require('../services/shiftService');
const { sendShiftAssigned, sendShiftRemoved } = require('../services/notificationService');
const { ok, created, fail, notFound } = require('../utils/response');

const prisma = new PrismaClient();

async function createShift(req, res) {
  const { houseId, workerId, startTime, endTime, date } = req.body;
  if (!houseId || !workerId || !startTime || !endTime || !date) {
    return fail(res, 'houseId, workerId, startTime, endTime, date required');
  }
  const shift = await shiftService.createShift(req.body, req.user.id);
  created(res, shift);

  // non-blocking push notification
  sendShiftAssigned(shift.worker, shift, shift.house).catch((e) =>
    console.error('[Notify] shift assigned', e.message),
  );
}

async function getShift(req, res) {
  const shift = await shiftService.getShiftById(req.params.id);
  if (!shift) return notFound(res);
  // workers can only see their own shifts
  if (req.user.role === 'WORKER' && shift.workerId !== req.user.id) return notFound(res);
  ok(res, shift);
}

async function listShifts(req, res) {
  const { role, id } = req.user;

  if (role === 'WORKER') {
    return ok(res, await shiftService.getShiftsForWorker(id));
  }
  if (role === 'MANAGER') {
    return ok(res, await shiftService.getShiftsForManager(id));
  }
  if (role === 'TEAM_LEADER') {
    const { houseId } = req.query;
    if (houseId) return ok(res, await shiftService.getShiftsForHouse(houseId));
    // Auto-resolve from the team leader's assigned house
    const assignment = await prisma.houseTeamLeader.findFirst({ where: { teamLeaderId: id } });
    if (!assignment) return ok(res, []);
    return ok(res, await shiftService.getShiftsForHouse(assignment.houseId));
  }
  // HR — sees all shifts platform-wide, with optional filters
  const { houseId, workerId } = req.query;
  if (houseId) return ok(res, await shiftService.getShiftsForHouse(houseId));
  if (workerId) return ok(res, await shiftService.getShiftsForWorker(workerId));
  return ok(res, await shiftService.getAllShifts());
}

async function deleteShift(req, res) {
  try {
    const shift = await shiftService.deleteShift(req.params.id);
    ok(res, { deleted: true });

    // non-blocking push notification
    sendShiftRemoved(shift.worker, shift, shift.house).catch((e) =>
      console.error('[Notify] shift removed', e.message),
    );
  } catch {
    notFound(res);
  }
}

module.exports = { createShift, getShift, listShifts, deleteShift };
