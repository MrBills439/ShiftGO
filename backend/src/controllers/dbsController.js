const prisma = require('../lib/prisma');
const { ok, created, fail, notFound } = require('../utils/response');
const { canViewPersonRecords } = require('../services/accessScope');
const { agencyIdFor } = require('../utils/agency');

async function getMyDbs(req, res) {
  const dbs = await prisma.dbsCheck.findFirst({ where: { agencyId: agencyIdFor(req), userId: req.user.id } });
  ok(res, dbs ?? null);
}

async function getDbsForUser(req, res) {
  if (!(await canViewPersonRecords(req.user, req.params.userId, agencyIdFor(req)))) return notFound(res);
  const dbs = await prisma.dbsCheck.findFirst({ where: { agencyId: agencyIdFor(req), userId: req.params.userId } });
  ok(res, dbs ?? null);
}

async function upsertDbs(req, res) {
  const { userId, status, reference, issuedAt, expiresAt, notes } = req.body;
  if (!userId) return fail(res, 'userId required');
  const user = await prisma.user.findFirst({ where: { id: userId, agencyId: agencyIdFor(req) } });
  if (!user) return fail(res, 'User must belong to your agency', 403);
  const dbs = await prisma.dbsCheck.upsert({
    where: { userId },
    create: { agencyId: agencyIdFor(req), userId, status, reference, issuedAt, expiresAt, notes },
    update: { status, reference, issuedAt, expiresAt, notes },
  });
  ok(res, dbs);
}

module.exports = { getMyDbs, getDbsForUser, upsertDbs };
