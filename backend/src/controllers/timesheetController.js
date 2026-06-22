const timesheetService = require('../services/timesheetService');
const { ok, fail } = require('../utils/response');

async function myTimesheets(req, res) {
  const data = await timesheetService.getMyTimesheets(req.user.id);
  ok(res, data);
}

async function houseTimesheets(req, res) {
  const data = await timesheetService.getHouseTimesheets(req.params.houseId);
  ok(res, data);
}

async function confirmTimesheet(req, res) {
  try {
    const ts = await timesheetService.confirmTimesheet(req.params.id, req.user.id);
    ok(res, ts);
  } catch {
    fail(res, 'Timesheet not found');
  }
}

async function exportPDF(req, res) {
  try {
    await timesheetService.generatePDF(req.params.houseId, res);
  } catch (err) {
    fail(res, 'Failed to generate PDF');
  }
}

module.exports = { myTimesheets, houseTimesheets, confirmTimesheet, exportPDF };
