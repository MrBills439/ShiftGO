const prisma = require('../lib/prisma');
const { ok, created, fail, notFound } = require('../utils/response');
const { canViewPersonRecords } = require('../services/accessScope');
const { agencyIdFor } = require('../utils/agency');
const { auditContext, createAuditLog, logAccess } = require('../services/auditService');

// What goes into the audit trail for a DBS record: facts only. The certificate
// reference and free-text notes (which can describe criminal-record content)
// are never copied into the log.
const dbsSummary = (d) => d && ({
  status: d.status, issuedAt: d.issuedAt, expiresAt: d.expiresAt,
  hasReference: Boolean(d.reference), hasNotes: Boolean(d.notes),
});

async function getMyDbs(req, res) {
  const dbs = await prisma.dbsCheck.findFirst({ where: { agencyId: agencyIdFor(req), userId: req.user.id } });
  ok(res, dbs ?? null);
}

async function getDbsForUser(req, res) {
  if (!(await canViewPersonRecords(req.user, req.params.userId, agencyIdFor(req)))) return notFound(res);
  const dbs = await prisma.dbsCheck.findFirst({ where: { agencyId: agencyIdFor(req), userId: req.params.userId } });
  if (req.params.userId !== req.user.id) {
    await logAccess(req, { action: 'DBS_RECORD_VIEWED', entityType: 'DbsCheck', entityId: dbs?.id ?? req.params.userId, subjectUserId: req.params.userId });
  }
  ok(res, dbs ?? null);
}

async function upsertDbs(req, res) {
  const { userId, status, reference, issuedAt, expiresAt, notes } = req.body;
  if (!userId) return fail(res, 'userId required');
  const user = await prisma.user.findFirst({ where: { id: userId, agencyId: agencyIdFor(req) } });
  if (!user) return fail(res, 'User must belong to your agency', 403);
  const before = await prisma.dbsCheck.findUnique({ where: { userId } });
  const dbs = await prisma.dbsCheck.upsert({
    where: { userId },
    create: { agencyId: agencyIdFor(req), userId, status, reference, issuedAt, expiresAt, notes },
    update: { status, reference, issuedAt, expiresAt, notes },
  });
  await createAuditLog({
    ...auditContext(req),
    action: before ? 'DBS_RECORD_UPDATED' : 'DBS_RECORD_CREATED',
    entityType: 'DbsCheck',
    entityId: dbs.id,
    oldValue: before ? { subjectUserId: userId, ...dbsSummary(before) } : null,
    newValue: { subjectUserId: userId, ...dbsSummary(dbs) },
  });
  ok(res, dbs);
}

module.exports = { getMyDbs, getDbsForUser, upsertDbs };
