const service = require('../services/orgStructureService');
const { ok, created, fail } = require('../utils/response');
const { agencyIdFor } = require('../utils/agency');
const { auditContext, createAuditLog } = require('../services/auditService');

function handle(res, err) {
  if (err && err.statusCode) return fail(res, err.message, err.statusCode, err.code ? { code: err.code } : {});
  throw err;
}

const AUDIT_ENTITY = { department: 'Department', jobTitle: 'JobTitle', location: 'Location' };

/** Build the 8 handlers for one org entity (department | jobTitle | location). */
function makeController(entity) {
  const entityType = AUDIT_ENTITY[entity];

  return {
    async list(req, res) {
      const includeInactive = req.query.includeInactive === 'true' || req.query.status === 'all';
      ok(res, await service.list(entity, agencyIdFor(req), { includeInactive }));
    },

    async options(req, res) {
      // `departmentId` is only meaningful for jobTitle; the service ignores it
      // for the other entities.
      ok(res, await service.options(entity, agencyIdFor(req), { departmentId: req.query.departmentId }));
    },

    async getOne(req, res) {
      try {
        ok(res, await service.getOne(entity, agencyIdFor(req), req.params.id));
      } catch (err) { return handle(res, err); }
    },

    async create(req, res) {
      try {
        const row = await service.create(entity, agencyIdFor(req), req.body);
        await createAuditLog({
          ...auditContext(req), action: `${entityType.toUpperCase()}_CREATED`,
          entityType, entityId: row.id, newValue: row,
        });
        created(res, row);
      } catch (err) { return handle(res, err); }
    },

    async update(req, res) {
      try {
        const row = await service.update(entity, agencyIdFor(req), req.params.id, req.body);
        await createAuditLog({
          ...auditContext(req), action: `${entityType.toUpperCase()}_UPDATED`,
          entityType, entityId: row.id, newValue: row,
        });
        ok(res, row);
      } catch (err) { return handle(res, err); }
    },

    async deactivate(req, res) {
      try {
        const row = await service.setActive(entity, agencyIdFor(req), req.params.id, false);
        await createAuditLog({
          ...auditContext(req), action: `${entityType.toUpperCase()}_DEACTIVATED`,
          entityType, entityId: row.id, newValue: { active: false },
        });
        ok(res, row);
      } catch (err) { return handle(res, err); }
    },

    async reactivate(req, res) {
      try {
        const row = await service.setActive(entity, agencyIdFor(req), req.params.id, true);
        await createAuditLog({
          ...auditContext(req), action: `${entityType.toUpperCase()}_REACTIVATED`,
          entityType, entityId: row.id, newValue: { active: true },
        });
        ok(res, row);
      } catch (err) { return handle(res, err); }
    },

    async remove(req, res) {
      try {
        const result = await service.remove(entity, agencyIdFor(req), req.params.id);
        await createAuditLog({
          ...auditContext(req), action: `${entityType.toUpperCase()}_DELETED`,
          entityType, entityId: req.params.id, oldValue: null,
        });
        ok(res, result);
      } catch (err) { return handle(res, err); }
    },
  };
}

module.exports = {
  department: makeController('department'),
  jobTitle: makeController('jobTitle'),
  location: makeController('location'),
};
