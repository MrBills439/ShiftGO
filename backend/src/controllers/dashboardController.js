const dashboardService = require('../services/dashboardService');
const { ok } = require('../utils/response');
const { agencyIdFor } = require('../utils/agency');

/** GET /dashboard/today — operational summary for TEAM_LEADER / MANAGER / HR. */
async function today(req, res) {
  const summary = await dashboardService.getTodaySummary(req.user, agencyIdFor(req), new Date());
  ok(res, summary);
}

module.exports = { today };
