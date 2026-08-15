const leaveService = require('../services/leaveRequestService');
const auditService = require('../services/auditService');
const { ok, created, fail, conflict } = require('../utils/response');

async function createLeaveRequest(req, res) {
  try {
    const { workerId, startDate, endDate, reason } = req.body;
    const requestingUserId = req.user.id;
    const requestingUserRole = req.user.role;
    const agencyId = req.user.agencyId;

    const leave = await leaveService.createLeaveRequest(
      { workerId, startDate, endDate, reason },
      requestingUserId,
      requestingUserRole,
      agencyId
    );

    await auditService.createAuditLog({
      agencyId,
      actorId: requestingUserId,
      actorRole: requestingUserRole,
      action: 'LEAVE_REQUEST_CREATED',
      entityType: 'LeaveRequest',
      entityId: leave.id,
      newValue: leave,
    });

    created(res, leave);
  } catch (err) {
    handleLeaveError(err, res);
  }
}

async function getLeaveRequests(req, res) {
  try {
    const requestingUserId = req.user.id;
    const requestingUserRole = req.user.role;
    const agencyId = req.user.agencyId;

    const filters = {};
    if (req.query.status) filters.status = req.query.status;
    if (req.query.workerId) filters.workerId = req.query.workerId;

    const leaves = await leaveService.getLeaveRequests(
      requestingUserId,
      requestingUserRole,
      agencyId,
      filters
    );

    ok(res, leaves);
  } catch (err) {
    handleLeaveError(err, res);
  }
}

async function getLeaveRequest(req, res) {
  try {
    const { id } = req.params;
    const requestingUserId = req.user.id;
    const requestingUserRole = req.user.role;
    const agencyId = req.user.agencyId;

    const leave = await leaveService.getLeaveRequest(
      id,
      requestingUserId,
      requestingUserRole,
      agencyId
    );

    ok(res, leave);
  } catch (err) {
    handleLeaveError(err, res);
  }
}

async function approveLeaveRequest(req, res) {
  try {
    const { id } = req.params;
    const requestingUserId = req.user.id;
    const requestingUserRole = req.user.role;
    const agencyId = req.user.agencyId;

    const approved = await leaveService.approveLeaveRequest(
      id,
      requestingUserId,
      requestingUserRole,
      agencyId
    );

    await auditService.createAuditLog({
      agencyId,
      actorId: requestingUserId,
      actorRole: requestingUserRole,
      action: 'LEAVE_REQUEST_APPROVED',
      entityType: 'LeaveRequest',
      entityId: id,
      newValue: approved,
    });

    ok(res, approved);
  } catch (err) {
    handleLeaveError(err, res);
  }
}

async function rejectLeaveRequest(req, res) {
  try {
    const { id } = req.params;
    const { rejectionReason } = req.body;
    const requestingUserId = req.user.id;
    const requestingUserRole = req.user.role;
    const agencyId = req.user.agencyId;

    if (!rejectionReason || typeof rejectionReason !== 'string' || rejectionReason.trim().length === 0) {
      return fail(res, 'Rejection reason is required');
    }

    const rejected = await leaveService.rejectLeaveRequest(
      id,
      rejectionReason,
      requestingUserId,
      requestingUserRole,
      agencyId
    );

    await auditService.createAuditLog({
      agencyId,
      actorId: requestingUserId,
      actorRole: requestingUserRole,
      action: 'LEAVE_REQUEST_REJECTED',
      entityType: 'LeaveRequest',
      entityId: id,
      oldValue: { status: 'PENDING' },
      newValue: rejected,
    });

    ok(res, rejected);
  } catch (err) {
    handleLeaveError(err, res);
  }
}

async function cancelLeaveRequest(req, res) {
  try {
    const { id } = req.params;
    const requestingUserId = req.user.id;
    const requestingUserRole = req.user.role;
    const agencyId = req.user.agencyId;

    const cancelled = await leaveService.cancelLeaveRequest(
      id,
      requestingUserId,
      requestingUserRole,
      agencyId
    );

    await auditService.createAuditLog({
      agencyId,
      actorId: requestingUserId,
      actorRole: requestingUserRole,
      action: 'LEAVE_REQUEST_CANCELLED',
      entityType: 'LeaveRequest',
      entityId: id,
      newValue: cancelled,
    });

    ok(res, cancelled);
  } catch (err) {
    handleLeaveError(err, res);
  }
}

function handleLeaveError(err, res) {
  if (typeof err === 'object' && err.code) {
    // Structured error from service
    if (err.code === 'LEAVE_CONFLICT') {
      return conflict(res, err.message, { conflicts: err.conflicts });
    }
  }

  const errorCode = typeof err === 'string' ? err : err?.message;

  if (errorCode) {
    switch (errorCode) {
      case 'INVALID_DATE':
        return fail(res, 'Start and end dates must be valid');
      case 'END_BEFORE_START':
        return fail(res, 'End date must be same or after start date');
      case 'UNAUTHORIZED':
        return fail(res, 'You do not have permission for this action', 403);
      case 'WORKER_NOT_FOUND':
        return fail(res, 'Worker not found', 404);
      case 'CROSS_AGENCY_ACCESS':
        return fail(res, 'Cross-agency access is not allowed', 403);
      case 'NOT_FOUND':
        return fail(res, 'Leave request not found', 404);
      case 'INVALID_STATUS':
        return fail(res, 'This leave request cannot be modified in its current status');
      default:
        if (typeof err === 'string') return fail(res, err);
    }
  }

  console.error('[LeaveRequest]', err);
  fail(res, 'An error occurred processing the leave request');
}

module.exports = {
  createLeaveRequest,
  getLeaveRequests,
  getLeaveRequest,
  approveLeaveRequest,
  rejectLeaveRequest,
  cancelLeaveRequest,
};
