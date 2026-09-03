const prisma = require('../lib/prisma');
const leaveBalanceService = require('./leave/leaveBalanceService');
const notificationService = require('./notificationService');
const { canRequest, leaveHoursForRange } = require('./leave/accrualEngine');

/** Human duration for payroll/worker messages — leave is stored in hours, but
 *  everyone reads it in days. */
function describeLeaveDuration(leave, worker) {
  const daily = leaveBalanceService.dailyHoursFor(worker) || 7.5;
  const days = Math.round((Number(leave.totalHours || 0) / daily) * 10) / 10;
  return `${days} ${Math.abs(days) === 1 ? 'day' : 'days'}`;
}

/** The "payroll team" — active HR users in the agency. */
async function payrollRecipients(agencyId) {
  return prisma.user.findMany({
    where: { agencyId, role: 'HR', status: 'ACTIVE' },
    select: { id: true, name: true, fcmToken: true },
  });
}

async function resolveWorker(leave) {
  return leave.worker ?? prisma.user.findUnique({ where: { id: leave.workerId } });
}

/** Non-blocking: tell the payroll team a leave request was submitted. */
async function notifyLeaveSubmitted(leave, agencyId) {
  const worker = await resolveWorker(leave);
  if (!worker) return;
  const recipients = await payrollRecipients(agencyId);
  if (!recipients.length) return;
  await notificationService.sendLeaveSubmittedToPayroll(
    recipients, leave, worker, describeLeaveDuration(leave, worker),
  );
}

/** Non-blocking: tell the worker the outcome, and — on approval — the payroll team. */
async function notifyLeaveDecision(leave, agencyId, decision, reason) {
  const worker = await resolveWorker(leave);
  if (!worker) return;
  await notificationService.sendLeaveDecisionToWorker(worker, leave, decision, reason);
  if (decision === 'APPROVED') {
    const recipients = await payrollRecipients(agencyId);
    if (recipients.length) {
      await notificationService.sendLeaveApprovedToPayroll(
        recipients, leave, worker, describeLeaveDuration(leave, worker),
      );
    }
  }
}

/** Non-blocking: a previously approved leave was cancelled — payroll must reverse it. */
async function notifyApprovedLeaveCancelled(leave, agencyId) {
  const worker = await resolveWorker(leave);
  if (!worker) return;
  const recipients = await payrollRecipients(agencyId);
  if (!recipients.length) return;
  await notificationService.sendLeaveCancelledToPayroll(
    recipients, leave, worker, describeLeaveDuration(leave, worker),
  );
}

/**
 * Check if two date ranges overlap
 * leave.startDate <= shift.endDate AND leave.endDate >= shift.startDate
 */
function dateRangesOverlap(leaveStart, leaveEnd, shiftStart, shiftEnd) {
  return leaveStart <= shiftEnd && leaveEnd >= shiftStart;
}

/**
 * Create a leave request
 * Worker can create own leave requests
 * Manager/HR can create for workers in same agency
 */
async function createLeaveRequest(data, requestingUserId, requestingUserRole, agencyId) {
  const { workerId, startDate, endDate, reason } = data;

  // Validate dates
  const start = new Date(startDate);
  const end = new Date(endDate);

  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    throw new Error('INVALID_DATE');
  }

  if (end < start) {
    throw new Error('END_BEFORE_START');
  }

  // Determine whose leave we're creating
  const finalWorkerId = workerId || requestingUserId;

  // Workers can only create leave for themselves
  if (requestingUserRole === 'WORKER' && finalWorkerId !== requestingUserId) {
    throw new Error('UNAUTHORIZED');
  }

  // Verify worker exists and is in same agency
  const worker = await prisma.user.findUnique({ where: { id: finalWorkerId } });
  if (!worker) {
    throw new Error('WORKER_NOT_FOUND');
  }

  if (worker.agencyId !== agencyId) {
    throw new Error('CROSS_AGENCY_ACCESS');
  }

  // Price the request in hours. The PTO balance is only *enforced* once HR has
  // configured an accrual policy for this worker — with no policy there is
  // nothing to gate on. `allowNegativeBalance` on the policy lets a request
  // through even when Net Usable is short.
  const balance = await leaveBalanceService.getBalanceSummary(finalWorkerId, agencyId);
  const totalHours = leaveHoursForRange(start, end, balance.dailyHours);

  if (balance.hasConfiguredProfile) {
    const verdict = canRequest({ balance, requestedHours: totalHours });
    if (!verdict.allowed) {
      throw {
        code: 'INSUFFICIENT_BALANCE',
        message: `This request needs ${totalHours}h but only ${balance.netUsableBalance}h are available (short by ${verdict.shortfallHours}h).`,
        requestedHours: totalHours,
        netUsableBalance: balance.netUsableBalance,
        shortfallHours: verdict.shortfallHours,
      };
    }
  }

  // Create the leave request. Reason is optional — the mobile flow doesn't
  // collect one; store null rather than an empty string.
  const leaveRequest = await prisma.leaveRequest.create({
    data: {
      agencyId,
      workerId: finalWorkerId,
      startDate: start,
      endDate: end,
      reason: reason?.trim() ? reason.trim() : null,
      status: 'PENDING',
      totalHours,
    },
    include: {
      worker: true,
      agency: true,
    },
  });

  // Non-blocking: notify the payroll team (HR) that a request is awaiting approval.
  notifyLeaveSubmitted(leaveRequest, agencyId).catch((e) =>
    console.error('[Notify] leave submitted', e.message),
  );

  return leaveRequest;
}

/**
 * Get leave requests for user's agency
 * Workers see only their own requests
 * Managers/HR see all agency requests
 */
async function getLeaveRequests(requestingUserId, requestingUserRole, agencyId, filters = {}) {
  const where = { agencyId };

  // Workers only see their own leave
  if (requestingUserRole === 'WORKER') {
    where.workerId = requestingUserId;
  }

  // Apply filters
  if (filters.status) {
    where.status = filters.status;
  }

  if (filters.workerId && requestingUserRole !== 'WORKER') {
    where.workerId = filters.workerId;
  }

  const requests = await prisma.leaveRequest.findMany({
    where,
    include: {
      worker: true,
      reviewedBy: true,
      agency: true,
    },
    orderBy: { createdAt: 'desc' },
  });

  return requests;
}

/**
 * Get single leave request
 * Verify access control
 */
async function getLeaveRequest(leaveRequestId, requestingUserId, requestingUserRole, agencyId) {
  const leave = await prisma.leaveRequest.findUnique({
    where: { id: leaveRequestId },
    include: {
      worker: true,
      reviewedBy: true,
      agency: true,
    },
  });

  if (!leave) {
    throw new Error('NOT_FOUND');
  }

  // Check agency access
  if (leave.agencyId !== agencyId) {
    throw new Error('CROSS_AGENCY_ACCESS');
  }

  // Workers can only see own leave
  if (requestingUserRole === 'WORKER' && leave.workerId !== requestingUserId) {
    throw new Error('UNAUTHORIZED');
  }

  return leave;
}

/**
 * Check if approved leave conflicts with a shift
 */
async function checkLeaveConflict(workerId, shiftStart, shiftEnd, agencyId) {
  const conflicts = await prisma.leaveRequest.findMany({
    where: {
      agencyId,
      workerId,
      status: 'APPROVED',
      // Leave overlaps shift if: leave.startDate <= shift.endDate AND leave.endDate >= shift.startDate
      AND: [
        { startDate: { lte: shiftEnd } },
        { endDate: { gte: shiftStart } },
      ],
    },
  });

  return conflicts;
}

/**
 * Get scheduled/active shifts for a worker during a date range
 */
async function getShiftsDuringLeave(workerId, startDate, endDate, agencyId) {
  const shifts = await prisma.shift.findMany({
    where: {
      agencyId,
      workerId,
      status: { in: ['SCHEDULED', 'IN_PROGRESS'] },
      AND: [
        { startTime: { lte: endDate } },
        { endTime: { gte: startDate } },
      ],
    },
    include: {
      house: true,
      worker: true,
    },
  });

  return shifts;
}

/**
 * Approve a leave request
 * Only Manager/HR can approve
 * Must check for existing shifts
 */
async function approveLeaveRequest(leaveRequestId, requestingUserId, requestingUserRole, agencyId) {
  if (!['MANAGER', 'HR'].includes(requestingUserRole)) {
    throw new Error('UNAUTHORIZED');
  }

  const leave = await getLeaveRequest(leaveRequestId, requestingUserId, requestingUserRole, agencyId);

  if (leave.status !== 'PENDING') {
    throw new Error('INVALID_STATUS');
  }

  // Check for existing shifts during leave period
  const conflictingShifts = await getShiftsDuringLeave(
    leave.workerId,
    leave.startDate,
    leave.endDate,
    agencyId
  );

  if (conflictingShifts.length > 0) {
    throw {
      code: 'LEAVE_CONFLICT',
      message: 'Worker has scheduled shifts during this leave period',
      conflicts: conflictingShifts,
    };
  }

  const approved = await prisma.leaveRequest.update({
    where: { id: leaveRequestId },
    data: {
      status: 'APPROVED',
      reviewedById: requestingUserId,
      reviewedAt: new Date(),
    },
    include: {
      worker: true,
      reviewedBy: true,
    },
  });

  // Non-blocking: confirm to the worker and send the approved leave to payroll (HR).
  notifyLeaveDecision(approved, agencyId, 'APPROVED').catch((e) =>
    console.error('[Notify] leave approved', e.message),
  );

  return approved;
}

/**
 * Reject a leave request
 * Only Manager/HR can reject
 */
async function rejectLeaveRequest(leaveRequestId, rejectionReason, requestingUserId, requestingUserRole, agencyId) {
  if (!['MANAGER', 'HR'].includes(requestingUserRole)) {
    throw new Error('UNAUTHORIZED');
  }

  const leave = await getLeaveRequest(leaveRequestId, requestingUserId, requestingUserRole, agencyId);

  if (leave.status !== 'PENDING') {
    throw new Error('INVALID_STATUS');
  }

  const rejected = await prisma.leaveRequest.update({
    where: { id: leaveRequestId },
    data: {
      status: 'REJECTED',
      rejectionReason,
      reviewedById: requestingUserId,
      reviewedAt: new Date(),
    },
    include: {
      worker: true,
      reviewedBy: true,
    },
  });

  // Non-blocking: let the worker know it was declined (and why).
  notifyLeaveDecision(rejected, agencyId, 'REJECTED', rejectionReason).catch((e) =>
    console.error('[Notify] leave rejected', e.message),
  );

  return rejected;
}

/**
 * Cancel a leave request
 * Worker can cancel own PENDING requests
 * Manager/HR can cancel PENDING/APPROVED requests
 */
async function cancelLeaveRequest(leaveRequestId, requestingUserId, requestingUserRole, agencyId) {
  const leave = await getLeaveRequest(leaveRequestId, requestingUserId, requestingUserRole, agencyId);

  // Workers can only cancel own requests
  if (requestingUserRole === 'WORKER') {
    if (leave.workerId !== requestingUserId) {
      throw new Error('UNAUTHORIZED');
    }

    if (leave.status !== 'PENDING') {
      throw new Error('INVALID_STATUS');
    }
  }

  // Manager/HR can cancel PENDING or APPROVED
  if (['MANAGER', 'HR'].includes(requestingUserRole)) {
    if (!['PENDING', 'APPROVED'].includes(leave.status)) {
      throw new Error('INVALID_STATUS');
    }
  }

  const wasApproved = leave.status === 'APPROVED';

  const cancelled = await prisma.leaveRequest.update({
    where: { id: leaveRequestId },
    data: {
      status: 'CANCELLED',
    },
    include: {
      worker: true,
      reviewedBy: true,
    },
  });

  // Non-blocking: if approved leave is being reversed, payroll (HR) needs to know.
  if (wasApproved) {
    notifyApprovedLeaveCancelled(cancelled, agencyId).catch((e) =>
      console.error('[Notify] leave cancelled', e.message),
    );
  }

  return cancelled;
}

module.exports = {
  createLeaveRequest,
  getLeaveRequests,
  getLeaveRequest,
  checkLeaveConflict,
  getShiftsDuringLeave,
  approveLeaveRequest,
  rejectLeaveRequest,
  cancelLeaveRequest,
  dateRangesOverlap,
};
