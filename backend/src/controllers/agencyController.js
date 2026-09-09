const prisma = require('../lib/prisma');
const { ok, fail, notFound } = require('../utils/response');
const { agencyIdFor } = require('../utils/agency');
const { auditContext, createAuditLog } = require('../services/auditService');
const agencyCache = require('../lib/agencyCache');
const { normalizeEmployeeIdPrefix, previewNextEmployeeId } = require('../services/employeeIdService');

const agencySelect = {
  id: true,
  name: true,
  timezone: true,
  maxWeeklyScheduledHours: true,
  employeeIdPrefix: true,
  employeeIdNextNumber: true,
};

// The raw counter is never returned to the client (HR only ever sees the
// configured prefix and a read-only "next id" preview).
function serializeAgency(a) {
  return {
    id: a.id,
    name: a.name,
    timezone: a.timezone,
    maxWeeklyScheduledHours: a.maxWeeklyScheduledHours,
    employeeIdPrefix: a.employeeIdPrefix ?? null,
    nextEmployeeIdPreview: previewNextEmployeeId(a),
  };
}

// A calendar week is 168 hours; that is the hard upper bound for any weekly cap.
const MIN_WEEKLY_HOURS = 1;
const MAX_WEEKLY_HOURS = 168;

/** GET /agency — the caller's own agency settings (MANAGER+ may read). */
async function getAgency(req, res) {
  const agency = await prisma.agency.findUnique({ where: { id: agencyIdFor(req) }, select: agencySelect });
  if (!agency) return notFound(res);
  ok(res, serializeAgency(agency));
}

/** PATCH /agency — update configurable agency settings (HR only). */
async function updateAgency(req, res) {
  const agencyId = agencyIdFor(req);
  const before = await prisma.agency.findUnique({ where: { id: agencyId }, select: agencySelect });
  if (!before) return notFound(res);

  const data = {};
  if (req.body.maxWeeklyScheduledHours !== undefined) {
    const n = Number(req.body.maxWeeklyScheduledHours);
    if (!Number.isInteger(n) || n < MIN_WEEKLY_HOURS || n > MAX_WEEKLY_HOURS) {
      return fail(res, `maxWeeklyScheduledHours must be a whole number between ${MIN_WEEKLY_HOURS} and ${MAX_WEEKLY_HOURS}`, 400);
    }
    data.maxWeeklyScheduledHours = n;
  }
  if (req.body.employeeIdPrefix !== undefined) {
    // Normalise + validate (uppercase, 2–8 alphanumerics). Changing the prefix
    // never touches employeeIdNextNumber — numbering continues (existing IDs
    // keep their old prefix; new hires get the new one).
    try {
      data.employeeIdPrefix = normalizeEmployeeIdPrefix(req.body.employeeIdPrefix);
    } catch (err) {
      if (err.statusCode) return fail(res, err.message, err.statusCode, err.code ? { code: err.code } : {});
      throw err;
    }
  }

  if (Object.keys(data).length === 0) return ok(res, serializeAgency(before));

  const agency = await prisma.agency.update({ where: { id: agencyId }, data, select: agencySelect });
  agencyCache.invalidate(agencyId); // settings changed — drop any cached copy now

  await createAuditLog({
    ...auditContext(req),
    action: 'AGENCY_SETTINGS_UPDATED',
    entityType: 'Agency',
    entityId: agency.id,
    oldValue: serializeAgency(before),
    newValue: serializeAgency(agency),
  });

  ok(res, serializeAgency(agency));
}

module.exports = { getAgency, updateAgency };
