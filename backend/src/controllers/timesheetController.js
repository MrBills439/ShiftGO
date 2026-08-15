const { PrismaClient } = require('@prisma/client');
const timesheetService = require('../services/timesheetService');
const { auditContext, createAuditLog } = require('../services/auditService');
const { agencyIdFor } = require('../utils/agency');
const { ok, fail } = require('../utils/response');

const prisma = new PrismaClient();

async function myTimesheets(req, res) {
  const data = await timesheetService.getMyTimesheets(req.user.id, agencyIdFor(req));
  ok(res, data);
}

async function houseTimesheets(req, res) {
  const data = await timesheetService.getHouseTimesheets(req.params.houseId, agencyIdFor(req));
  ok(res, data);
}

async function confirmTimesheet(req, res) {
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

module.exports = { myTimesheets, houseTimesheets, confirmTimesheet, rejectTimesheet, exportPDF };
