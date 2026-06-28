const router = require('express').Router();
const auditService = require('../services/auditService');
const { agencyIdFor } = require('../utils/agency');
const { ok } = require('../utils/response');
const auth = require('../middleware/auth');
const { atLeast } = require('../middleware/roleGuard');
const asyncHandler = require('../middleware/asyncHandler');

router.use(auth);

// Transform audit log to activity feed item
function toActivityItem(log) {
  const typeMap = {
    'user.created': { type: 'user_created', title: 'Staff Member Created', icon: 'user-plus' },
    'user.deactivated': { type: 'user_deactivated', title: 'Staff Member Deactivated', icon: 'user-minus' },
    'shift.created': { type: 'shift_created', title: 'Shift Created', icon: 'calendar' },
    'shift.cancelled': { type: 'shift_cancelled', title: 'Shift Cancelled', icon: 'x' },
    'leave.requested': { type: 'leave_requested', title: 'Leave Requested', icon: 'calendar' },
    'leave.approved': { type: 'leave_approved', title: 'Leave Approved', icon: 'check-circle' },
    'leave.rejected': { type: 'leave_rejected', title: 'Leave Rejected', icon: 'x-circle' },
    'timesheet.submitted': { type: 'timesheet_submitted', title: 'Timesheet Submitted', icon: 'clock' },
    'timesheet.approved': { type: 'timesheet_approved', title: 'Timesheet Approved', icon: 'check-circle' },
    'timesheet.rejected': { type: 'timesheet_rejected', title: 'Timesheet Rejected', icon: 'x-circle' },
    'attendance.clockin': { type: 'shift_start', title: 'Clocked In', icon: 'check' },
    'attendance.clockout': { type: 'shift_end', title: 'Clocked Out', icon: 'check' },
  };

  const meta = typeMap[log.action] || { type: 'unknown', title: log.action, icon: 'info' };

  return {
    id: log.id,
    type: meta.type,
    title: meta.title,
    description: log.description || `${log.actor?.name || 'System'} ${log.action}`,
    actorName: log.actor?.name || 'System',
    actorId: log.actor?.id || null,
    entityType: log.entityType || 'unknown',
    entityId: log.entityId || null,
    timestamp: log.createdAt,
    severity: log.action.includes('error') ? 'error' : log.action.includes('rejected') ? 'warning' : 'info',
  };
}

// GET /activity - Activity feed
router.get(
  '/',
  atLeast('MANAGER'),
  asyncHandler(async (req, res) => {
    const limit = Math.min(parseInt(req.query.limit || 20), 100);
    const logs = await auditService.listAuditLogs({
      agencyId: agencyIdFor(req),
      limit,
    });

    const activities = logs.map(toActivityItem);
    ok(res, activities);
  })
);

module.exports = router;
