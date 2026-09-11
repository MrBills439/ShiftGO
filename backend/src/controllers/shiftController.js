const shiftService = require('../services/shiftService');
const {
  sendShiftAssigned, sendShiftRemoved,
  sendShiftOpen, sendShiftDropped, sendShiftClaimedYou, sendShiftClaimedOther,
} = require('../services/notificationService');
const { auditContext, createAuditLog } = require('../services/auditService');
const { ok, created, fail, notFound } = require('../utils/response');
const { agencyIdFor } = require('../utils/agency');

async function createShift(req, res) {
  const { houseId, kind, workerId, startTime, endTime, date, status } = req.body;
  if (status === 'OPEN') {
    // Open shifts are a House/ROTA-only concept in this slice.
    if (kind && kind !== 'ROTA') {
      return fail(res, 'Only rota shifts can be opened', 400, { code: 'OPEN_SHIFT_ROTA_ONLY' });
    }
    if (!houseId || !startTime || !endTime || !date) {
      return fail(res, 'houseId, startTime, endTime, date required');
    }
  } else if (!workerId || !startTime || !endTime || !date) {
    return fail(res, 'workerId, startTime, endTime, date required');
  }
  // Whether houseId or locationId is required (and that exactly one is
  // present) depends on `kind` and is enforced by
  // shiftService.assertShiftAttendanceTarget, called from createShift/
  // createOpenShift below.

  let shift;
  try {
    shift = status === 'OPEN'
      ? await shiftService.createOpenShift(req.body, req.user.id, agencyIdFor(req))
      : await shiftService.createShift(req.body, req.user.id, agencyIdFor(req), req.user);
  } catch (err) {
    if (err.statusCode === 400 && err.code) return fail(res, err.message, 400, { code: err.code, details: err.details });
    if (err.statusCode === 403) return fail(res, err.message, 403, err.code ? { code: err.code, details: err.details } : {});
    if (err.statusCode === 409) return fail(res, err.message, 409, err.code ? { code: err.code, details: err.details } : {});
    throw err;
  }
  await createAuditLog({
    ...auditContext(req),
    action: status === 'OPEN' ? 'SHIFT_OPENED' : 'SHIFT_CREATED',
    entityType: 'Shift',
    entityId: shift.id,
    newValue: shift,
  });
  created(res, shift);

  // non-blocking push notification. Open shifts are House/ROTA-only, so
  // shift.house always exists there. A FIXED (Location-backed) assigned shift
  // has no house — push notifications aren't built for office shifts yet, so
  // skip rather than call sendShiftAssigned with a null house.
  if (status === 'OPEN') {
    shiftService.findEligibleWorkers(shift, agencyIdFor(req)).then((workers) =>
      sendShiftOpen(workers, shift, shift.house)
    ).catch((e) => console.error('[Notify] shift open', e.message));
  } else if (shift.house) {
    sendShiftAssigned(shift.worker, shift, shift.house).catch((e) =>
      console.error('[Notify] shift assigned', e.message),
    );
  }
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
    if (shift.worker) {
      sendShiftRemoved(shift.worker, shift, shift.house).catch((e) =>
        console.error('[Notify] shift removed', e.message),
      );
    }
  } catch (err) {
    if (err.statusCode === 409) return fail(res, err.message, 409);
    if (err.statusCode === 403) return fail(res, err.message, 403);
    if (err.statusCode === 404) return notFound(res);
    throw err;
  }
}

async function updateShift(req, res) {
  try {
    const oldShift = await shiftService.getShiftByIdForAgency(req.params.id, agencyIdFor(req));
    if (!oldShift) return notFound(res);

    const shift = await shiftService.updateShift(req.params.id, req.body, agencyIdFor(req), req.user);
    await createAuditLog({
      ...auditContext(req),
      action: 'SHIFT_UPDATED',
      entityType: 'Shift',
      entityId: shift.id,
      oldValue: oldShift,
      newValue: shift,
    });
    ok(res, shift);

    // non-blocking push notifications for a worker change. A FIXED
    // (Location-backed) shift has no house — skip rather than notify with one.
    if (oldShift.workerId !== shift.workerId) {
      if (oldShift.worker && oldShift.house) {
        sendShiftRemoved(oldShift.worker, oldShift, oldShift.house).catch((e) =>
          console.error('[Notify] shift removed', e.message),
        );
      }
      if (shift.worker && shift.house) {
        sendShiftAssigned(shift.worker, shift, shift.house).catch((e) =>
          console.error('[Notify] shift assigned', e.message),
        );
      }
    }
  } catch (err) {
    if (err.statusCode === 400 && err.code) return fail(res, err.message, 400, { code: err.code, details: err.details });
    if (err.statusCode === 409) return fail(res, err.message, 409, err.code ? { code: err.code, details: err.details } : {});
    if (err.statusCode === 403) return fail(res, err.message, 403, err.code ? { code: err.code, details: err.details } : {});
    if (err.statusCode === 404) return notFound(res);
    throw err;
  }
}

async function openShift(req, res) {
  try {
    const shift = await shiftService.openShift(req.params.id, agencyIdFor(req), {
      eligibleRoles: req.body.eligibleRoles,
      urgent: req.body.urgent,
    });
    await createAuditLog({
      ...auditContext(req),
      action: 'SHIFT_OPENED',
      entityType: 'Shift',
      entityId: shift.id,
      newValue: shift,
    });
    ok(res, { ...shift, claimCount: shift.claims?.length ?? 0 });

    shiftService.findEligibleWorkers(shift, agencyIdFor(req)).then((workers) =>
      sendShiftOpen(workers, shift, shift.house)
    ).catch((e) => console.error('[Notify] shift open', e.message));
  } catch (err) {
    if (err.statusCode === 409) return fail(res, err.message, 409);
    if (err.statusCode === 404) return notFound(res);
    throw err;
  }
}

async function claimShift(req, res) {
  try {
    const { shift, claim } = await shiftService.claimShift(req.params.id, req.user, agencyIdFor(req));
    await createAuditLog({
      ...auditContext(req),
      action: 'SHIFT_CLAIMED',
      entityType: 'Shift',
      entityId: shift.id,
      newValue: shift,
    });
    created(res, { shift, claim });

    // non-blocking push notifications
    sendShiftClaimedYou(req.user, shift, shift.house).catch((e) =>
      console.error('[Notify] shift claimed (you)', e.message),
    );
    shiftService.findEligibleWorkers(shift, agencyIdFor(req), { excludeUserId: req.user.id })
      .then((workers) => sendShiftClaimedOther(workers, shift, shift.house))
      .catch((e) => console.error('[Notify] shift claimed (other)', e.message));
  } catch (err) {
    if (err.statusCode === 409) return fail(res, err.message, 409, err.code ? { code: err.code, details: err.details } : {});
    if (err.statusCode === 403) return fail(res, err.message, 403);
    if (err.statusCode === 404) return notFound(res);
    throw err;
  }
}

async function dropShift(req, res) {
  try {
    const { shift, recipients, reason } = await shiftService.dropShift(
      req.params.id, req.user, agencyIdFor(req), { reason: req.body?.reason },
    );
    await createAuditLog({
      ...auditContext(req),
      action: 'SHIFT_DROPPED',
      entityType: 'Shift',
      entityId: shift.id,
      newValue: { reason },
    });
    ok(res, shift);

    // non-blocking: tell the assigned manager + team leaders, then offer it to eligible workers
    sendShiftDropped(recipients, shift, shift.house, req.user, reason).catch((e) =>
      console.error('[Notify] shift dropped (managers)', e.message),
    );
    shiftService.findEligibleWorkers(shift, agencyIdFor(req), { excludeUserId: req.user.id })
      .then((workers) => sendShiftOpen(workers, shift, shift.house))
      .catch((e) => console.error('[Notify] shift dropped (open)', e.message));
  } catch (err) {
    if (err.statusCode === 409) return fail(res, err.message, 409);
    if (err.statusCode === 403) return fail(res, err.message, 403);
    if (err.statusCode === 404) return notFound(res);
    throw err;
  }
}

async function listOpenShifts(req, res) {
  const shifts = await shiftService.listOpenShiftsForWorker(req.user, agencyIdFor(req));
  ok(res, shifts);
}

async function listShiftClaims(req, res) {
  try {
    const claims = await shiftService.listClaims(req.params.id, agencyIdFor(req));
    ok(res, claims);
  } catch (err) {
    if (err.statusCode === 404) return notFound(res);
    throw err;
  }
}

module.exports = {
  createShift, getShift, listShifts, deleteShift, updateShift,
  openShift, claimShift, dropShift, listOpenShifts, listShiftClaims,
};
