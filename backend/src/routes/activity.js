const router = require('express').Router();
const auditService = require('../services/auditService');
const { agencyIdFor } = require('../utils/agency');
const { ok } = require('../utils/response');
const auth = require('../middleware/auth');
const { atLeast } = require('../middleware/roleGuard');
const asyncHandler = require('../middleware/asyncHandler');

router.use(auth);

// Operational events shown on the manager dashboard feed. This is a WHITELIST:
// anything not listed — sensitive-record access logs (DBS / right-to-work
// views), role changes, settings — never appears here; HR sees those through
// /audit-logs. Keys must match the `action` values the code actually writes.
//   type  -> drives the icon/colour in web/components/operations/ActivityFeed
//   title -> shown as the item heading
//   verb  -> "<actor> <verb>"
const FEED = {
  USER_INVITED: { type: 'user_created', title: 'Staff member invited', verb: 'invited a new staff member' },
  USER_ONBOARDED: { type: 'user_created', title: 'Staff member joined', verb: 'completed onboarding' },
  USER_DEACTIVATED: { type: 'user_deactivated', title: 'Staff member deactivated', verb: 'deactivated a staff member' },
  USER_REACTIVATED: { type: 'user_created', title: 'Staff member reactivated', verb: 'reactivated a staff member' },
  SHIFT_CREATED: { type: 'shift_created', title: 'Shift created', verb: 'created a shift' },
  SHIFT_UPDATED: { type: 'shift_updated', title: 'Shift updated', verb: 'updated a shift' },
  SHIFT_OPENED: { type: 'shift_created', title: 'Open shift posted', verb: 'posted an open shift' },
  SHIFT_CLAIMED: { type: 'shift_created', title: 'Open shift claimed', verb: 'claimed an open shift' },
  SHIFT_DROPPED: { type: 'shift_cancelled', title: 'Shift dropped', verb: 'dropped a shift' },
  SHIFT_CANCELLED: { type: 'shift_cancelled', title: 'Shift cancelled', verb: 'cancelled a shift' },
  SHIFT_CHANGE_APPROVED: { type: 'leave_approved', title: 'Shift change approved', verb: 'approved a shift change' },
  SHIFT_CHANGE_REJECTED: { type: 'leave_rejected', title: 'Shift change rejected', verb: 'rejected a shift change' },
  LEAVE_REQUEST_CREATED: { type: 'leave_requested', title: 'Leave requested', verb: 'requested leave' },
  LEAVE_REQUEST_APPROVED: { type: 'leave_approved', title: 'Leave approved', verb: 'approved a leave request' },
  LEAVE_REQUEST_REJECTED: { type: 'leave_rejected', title: 'Leave rejected', verb: 'rejected a leave request' },
  LEAVE_REQUEST_CANCELLED: { type: 'leave_rejected', title: 'Leave cancelled', verb: 'cancelled a leave request' },
  TIMESHEET_APPROVED: { type: 'leave_approved', title: 'Timesheet approved', verb: 'approved a timesheet' },
  TIMESHEET_REJECTED: { type: 'leave_rejected', title: 'Timesheet rejected', verb: 'rejected a timesheet' },
  ATTENDANCE_FLAGGED_FOR_REVIEW: { type: 'attendance_flagged', title: 'Attendance needs review', verb: 'attendance was flagged for review' },
  ATTENDANCE_REVIEW_RESOLVED: { type: 'leave_approved', title: 'Attendance review resolved', verb: 'resolved an attendance review' },
  AUTO_CLOCK_OUT_AFTER_SHIFT_EXIT: { type: 'shift_end', title: 'Automatic clock-out', verb: 'was clocked out automatically after leaving' },
  MANUAL_ONSITE_CLOCK_OUT: { type: 'shift_end', title: 'Clocked out', verb: 'clocked out' },
  MANUAL_OFFSITE_CLOCK_OUT: { type: 'shift_end', title: 'Clocked out off-site', verb: 'clocked out away from the service' },
  ANNOUNCEMENT_CREATED: { type: 'announcement', title: 'Announcement posted', verb: 'posted an announcement' },
};
const FEED_ACTIONS = Object.keys(FEED);

function toActivityItem(log) {
  const meta = FEED[log.action];
  const actorName = log.actor?.name || 'System';
  return {
    id: log.id,
    type: meta.type,
    action: meta.title, // the web feed renders `action` as the heading
    title: meta.title,
    description: `${actorName} ${meta.verb}`,
    actor: log.actor ? { id: log.actor.id, name: log.actor.name } : null,
    actorName,
    actorId: log.actorId || null,
    entityType: log.entityType || 'unknown',
    entityId: log.entityId || null,
    timestamp: log.createdAt,
    severity: log.action.includes('REJECTED') || log.action.includes('FLAGGED') ? 'warning' : 'info',
  };
}

// GET /activity - Activity feed
router.get(
  '/',
  atLeast('MANAGER'),
  asyncHandler(async (req, res) => {
    const limit = Math.min(Math.max(parseInt(req.query.limit || 20, 10) || 20, 1), 100);
    const logs = await auditService.listAuditLogs({
      agencyId: agencyIdFor(req),
      actions: FEED_ACTIONS,
      limit,
    });
    const withActors = await auditService.withActors(logs);
    ok(res, withActors.map(toActivityItem));
  })
);

module.exports = router;
module.exports.FEED_ACTIONS = FEED_ACTIONS;
