const service = require('../services/shiftChangeService');
const { ok, created, fail } = require('../utils/response');
const { agencyIdFor } = require('../utils/agency');

// Map a service error (statusCode + optional .code) onto the shared response
// conventions. Anything without a statusCode bubbles to the global handler.
function handle(res, err) {
  if (err && err.statusCode) {
    return fail(res, err.message, err.statusCode, err.code ? { code: err.code } : {});
  }
  throw err;
}

async function eligibleWorkers(req, res) {
  try {
    ok(res, await service.getEligibleWorkers(req.user, agencyIdFor(req), String(req.query.shiftId)));
  } catch (err) { return handle(res, err); }
}

async function swapShifts(req, res) {
  try {
    ok(res, await service.getSwapCandidateShifts(req.user, agencyIdFor(req), String(req.query.shiftId), String(req.query.targetWorkerId)));
  } catch (err) { return handle(res, err); }
}

async function createCover(req, res) {
  try {
    created(res, await service.createCoverRequest(req.user, agencyIdFor(req), {
      shiftId: req.body.shiftId, targetWorkerId: req.body.targetWorkerId, reason: req.body.reason,
    }));
  } catch (err) { return handle(res, err); }
}

async function createSwap(req, res) {
  try {
    created(res, await service.createSwapRequest(req.user, agencyIdFor(req), {
      shiftId: req.body.shiftId, targetWorkerId: req.body.targetWorkerId, targetShiftId: req.body.targetShiftId, reason: req.body.reason,
    }));
  } catch (err) { return handle(res, err); }
}

async function mine(req, res) {
  ok(res, await service.listForMe(req.user, agencyIdFor(req), { page: req.query.page, pageSize: req.query.pageSize }));
}

async function pendingApproval(req, res) {
  ok(res, await service.listPendingApproval(req.user, agencyIdFor(req), {
    page: req.query.page, pageSize: req.query.pageSize, status: req.query.status,
  }));
}

async function getOne(req, res) {
  try {
    const { serialized } = await service.getOneForUser(req.user, agencyIdFor(req), req.params.id);
    ok(res, serialized);
  } catch (err) { return handle(res, err); }
}

async function respond(req, res) {
  try {
    ok(res, await service.respond(req.user, agencyIdFor(req), req.params.id, req.body.decision));
  } catch (err) { return handle(res, err); }
}

async function cancel(req, res) {
  try {
    ok(res, await service.cancel(req.user, agencyIdFor(req), req.params.id));
  } catch (err) { return handle(res, err); }
}

async function approve(req, res) {
  try {
    ok(res, await service.approve(req.user, agencyIdFor(req), req.params.id, {
      overrideWeeklyHours: req.body.overrideWeeklyHours === true || req.body.overrideWeeklyHours === 'true',
      overrideReason: req.body.overrideReason,
    }));
  } catch (err) { return handle(res, err); }
}

async function reject(req, res) {
  try {
    ok(res, await service.reject(req.user, agencyIdFor(req), req.params.id, { reason: req.body.reason }));
  } catch (err) { return handle(res, err); }
}

module.exports = {
  eligibleWorkers, swapShifts, createCover, createSwap,
  mine, pendingApproval, getOne, respond, cancel, approve, reject,
};
