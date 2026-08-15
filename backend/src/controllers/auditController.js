const auditService = require('../services/auditService');
const { agencyIdFor } = require('../utils/agency');
const { ok } = require('../utils/response');

async function listAuditLogs(req, res) {
  const logs = await auditService.listAuditLogs({ ...req.query, agencyId: agencyIdFor(req) });
  ok(res, logs);
}

module.exports = { listAuditLogs };
