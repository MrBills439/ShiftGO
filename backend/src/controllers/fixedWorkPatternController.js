const service = require('../services/fixedWorkPatternService');
const { ok, created, fail } = require('../utils/response');
const { agencyIdFor } = require('../utils/agency');
const { auditContext, createAuditLog } = require('../services/auditService');

function handle(res, err) {
  if (err && err.statusCode) {
    return fail(res, err.message, err.statusCode, {
      ...(err.code ? { code: err.code } : {}),
      ...(err.details ? { details: err.details } : {}),
    });
  }
  throw err;
}

async function list(req, res) {
  const { workerId, status, locationId } = req.query;
  ok(res, await service.listPatterns(agencyIdFor(req), { workerId, status, locationId }));
}

async function getOne(req, res) {
  try {
    ok(res, await service.getPatternById(req.params.id, agencyIdFor(req)));
  } catch (err) { return handle(res, err); }
}

async function create(req, res) {
  try {
    const pattern = await service.createPattern(req.body, req.user.id, agencyIdFor(req), req.user);
    await createAuditLog({
      ...auditContext(req),
      action: 'FIXED_WORK_PATTERN_CREATED',
      entityType: 'FixedWorkPattern',
      entityId: pattern.id,
      newValue: pattern,
    });
    created(res, pattern);
  } catch (err) { return handle(res, err); }
}

async function supersede(req, res) {
  try {
    const { oldPattern, newPattern } = await service.supersedePattern(req.params.id, req.body, req.user.id, agencyIdFor(req), req.user);
    await createAuditLog({
      ...auditContext(req),
      action: 'FIXED_WORK_PATTERN_SUPERSEDED',
      entityType: 'FixedWorkPattern',
      entityId: oldPattern.id,
      oldValue: { status: 'ACTIVE', effectiveTo: null },
      newValue: {
        oldPatternId: oldPattern.id,
        oldEffectiveTo: oldPattern.effectiveTo,
        newPatternId: newPattern.id,
        newEffectiveFrom: newPattern.effectiveFrom,
      },
    });
    created(res, newPattern);
  } catch (err) { return handle(res, err); }
}

async function end(req, res) {
  try {
    const pattern = await service.endPattern(req.params.id, req.body, agencyIdFor(req));
    await createAuditLog({
      ...auditContext(req),
      action: 'FIXED_WORK_PATTERN_ENDED',
      entityType: 'FixedWorkPattern',
      entityId: pattern.id,
      newValue: { status: 'ENDED', effectiveTo: pattern.effectiveTo },
    });
    ok(res, pattern);
  } catch (err) { return handle(res, err); }
}

module.exports = { list, getOne, create, supersede, end };
