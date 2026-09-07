const staffAllocationService = require('../services/staffAllocationService');
const { ok } = require('../utils/response');
const { agencyIdFor } = require('../utils/agency');

/** GET /staff/allocation?week=YYYY-MM-DD&proposedShiftId=<id> */
async function allocation(req, res) {
  const data = await staffAllocationService.getAllocation(req.user, agencyIdFor(req), {
    week: req.query.week,
    proposedShiftId: req.query.proposedShiftId,
  });
  ok(res, data);
}

module.exports = { allocation };
