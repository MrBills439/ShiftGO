const prisma = require('../lib/prisma');
const timesheetService = require('../services/timesheetService');
const { auditContext, createAuditLog } = require('../services/auditService');
const { agencyIdFor } = require('../utils/agency');
const { canAccessHouse } = require('../services/accessScope');
const { ok, fail } = require('../utils/response');

async function myTimesheets(req, res) {
  const data = await timesheetService.getMyTimesheets(req.user.id, agencyIdFor(req));
  ok(res, data);
}

/**
 * Who may review (approve / reject / resolve) a given timesheet:
 *  - never the worker it belongs to — no one signs off their own hours;
 *  - team leaders only for timesheets at a house they are assigned to;
 *  - managers / HR anywhere in their agency.
 * Returns an error response to send, or null when the review may proceed.
 * Unknown / other-agency timesheets fall through so the service's own 404 runs.
 */
async function reviewBlock(req) {
  const ts = await prisma.timesheet.findFirst({
    where: { id: req.params.id, agencyId: agencyIdFor(req) },
    select: { workerId: true, houseId: true },
  });
  if (!ts) return null;
  if (ts.workerId === req.user.id) {
    return { status: 403, message: 'You cannot review your own timesheet. Ask another manager to do it.' };
  }
  if (req.user.role === 'TEAM_LEADER') {
    const allowed = ts.houseId && (await canAccessHouse(req.user, ts.houseId, agencyIdFor(req)));
    if (!allowed) return { status: 404, message: 'Timesheet not found' };
  }
  return null;
}

async function houseTimesheets(req, res) {
  if (!(await canAccessHouse(req.user, req.params.houseId, agencyIdFor(req)))) return fail(res, 'Service not found', 404);
  const data = await timesheetService.getHouseTimesheets(req.params.houseId, agencyIdFor(req));
  ok(res, data);
}

/** Attendance records flagged needsReview=true, agency-wide — MANAGER/HR only. */
async function needsReview(req, res) {
  const data = await timesheetService.getNeedsReview(agencyIdFor(req));
  ok(res, data);
}

async function resolveReview(req, res) {
  const blocked = await reviewBlock(req);
  if (blocked) return fail(res, blocked.message, blocked.status);
  try {
    const { clockOutTime, reason } = req.body;
    const result = await timesheetService.resolveReview(req.params.id, req.user.id, agencyIdFor(req), {
      clockOutTime, reason,
    });

    await createAuditLog({
      ...auditContext(req),
      action: 'ATTENDANCE_REVIEW_RESOLVED',
      entityType: 'Timesheet',
      entityId: result.timesheet.id,
      newValue: {
        mode: result.mode,
        previousReviewReason: result.previousReviewReason,
        resolvedClockOutAt: result.mode === 'CLOCKED_OUT' ? result.timesheet.clockOutAt : null,
        resolutionReason: result.resolutionReason ?? null,
        ignoredClockOutTime: !!result.ignoredClockOutTime,
        clockEventId: result.event?.id ?? null,
      },
    });

    ok(res, result.timesheet);
  } catch (err) {
    fail(res, err.message || 'Failed to resolve attendance review', err.statusCode || 400);
  }
}

async function confirmTimesheet(req, res) {
  const blocked = await reviewBlock(req);
  if (blocked) return fail(res, blocked.message, blocked.status);
  try {
    const oldTimesheet = await prisma.timesheet.findFirst({ where: { id: req.params.id, agencyId: agencyIdFor(req) } });
    const ts = await timesheetService.confirmTimesheet(req.params.id, req.user.id, agencyIdFor(req));
    await createAuditLog({
      ...auditContext(req),
      action: 'TIMESHEET_APPROVED',
      entityType: 'Timesheet',
      entityId: ts.id,
      oldValue: oldTimesheet,
      newValue: ts,
    });
    ok(res, ts);
  } catch (err) {
    fail(res, err.message || 'Timesheet not found', err.statusCode || 400);
  }
}

async function rejectTimesheet(req, res) {
  const blocked = await reviewBlock(req);
  if (blocked) return fail(res, blocked.message, blocked.status);
  try {
    const oldTimesheet = await prisma.timesheet.findFirst({ where: { id: req.params.id, agencyId: agencyIdFor(req) } });
    const ts = await timesheetService.rejectTimesheet(req.params.id, req.user.id, req.body.reason, agencyIdFor(req));
    await createAuditLog({
      ...auditContext(req),
      action: 'TIMESHEET_REJECTED',
      entityType: 'Timesheet',
      entityId: ts.id,
      oldValue: oldTimesheet,
      newValue: ts,
    });
    ok(res, ts);
  } catch (err) {
    fail(res, err.message || 'Failed to reject timesheet', err.statusCode || 400);
  }
}

async function exportPDF(req, res) {
  try {
    await timesheetService.generatePDF(req.params.houseId, res, agencyIdFor(req));
  } catch (err) {
    fail(res, 'Failed to generate PDF');
  }
}

module.exports = {
  myTimesheets, houseTimesheets, needsReview, resolveReview,
  confirmTimesheet, rejectTimesheet, exportPDF,
};
