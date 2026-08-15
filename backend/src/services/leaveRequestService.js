const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

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

  // Create the leave request
  const leaveRequest = await prisma.leaveRequest.create({
    data: {
      agencyId,
      workerId: finalWorkerId,
      startDate: start,
      endDate: end,
      reason,
      status: 'PENDING',
    },
    include: {
      worker: true,
      agency: true,
    },
  });

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
