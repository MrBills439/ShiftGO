const shiftService = require('../services/shiftService');
const { sendShiftAssigned, sendShiftRemoved } = require('../services/notificationService');
const { auditContext, createAuditLog } = require('../services/auditService');
const { ok, created, fail, notFound } = require('../utils/response');
const { agencyIdFor } = require('../utils/agency');

async function createShift(req, res) {
  const { houseId, workerId, startTime, endTime, date } = req.body;
  if (!houseId || !workerId || !startTime || !endTime || !date) {
    return fail(res, 'houseId, workerId, startTime, endTime, date required');
  }
  let shift;
  try {
    shift = await shiftService.createShift(req.body, req.user.id, agencyIdFor(req));
  } catch (err) {
    if (err.statusCode === 403) return fail(res, err.message, 403);
    if (err.statusCode === 409) return fail(res, err.message, 409);
    throw err;
  }
  await createAuditLog({
    ...auditContext(req),
    action: 'SHIFT_CREATED',
    entityType: 'Shift',
    entityId: shift.id,
    newValue: shift,
  });
  created(res, shift);

  // non-blocking push notification
  sendShiftAssigned(shift.worker, shift, shift.house).catch((e) =>
    console.error('[Notify] shift assigned', e.message),
  );
}

async function getShift(req, res) {
  const shift = await shiftService.getShiftByIdForAgency(req.params.id, agencyIdFor(req));
  if (!shift) return notFound(res);
  // workers can only see their own shifts
  if (req.user.role === 'WORKER' && shift.workerId !== req.user.id) return notFound(res);
  ok(res, shift);
}

async function listShifts(req, res) {
  const { houseId, workerId, startDate, endDate, status, shiftType } = req.query;
  const shifts = await shiftService.listShiftsForUser(req.user, agencyIdFor(req), {
    houseId,
    workerId,
    startDate,
    endDate,
    status,
    shiftType,
  });
  return ok(res, shifts);
}

async function deleteShift(req, res) {
  try {
    const oldShift = await shiftService.getShiftByIdForAgency(req.params.id, agencyIdFor(req));
    const shift = await shiftService.cancelShift(req.params.id, req.user.id, req.body.reason.trim(), agencyIdFor(req));
    await createAuditLog({
      ...auditContext(req),
      action: 'SHIFT_CANCELLED',
      entityType: 'Shift',
      entityId: shift.id,
      oldValue: oldShift,
      newValue: shift,
    });
    ok(res, shift);

    // non-blocking push notification
    sendShiftRemoved(shift.worker, shift, shift.house).catch((e) =>
      console.error('[Notify] shift removed', e.message),
    );
  } catch (err) {
    if (err.statusCode === 409) return fail(res, err.message, 409);
    if (err.statusCode === 403) return fail(res, err.message, 403);
    if (err.statusCode === 404) return notFound(res);
    throw err;
  }
}

module.exports = { createShift, getShift, listShifts, deleteShift };
