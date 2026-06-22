const { PrismaClient } = require('@prisma/client');
const { ok, created, fail } = require('../utils/response');

const prisma = new PrismaClient();

async function getMyDbs(req, res) {
  const dbs = await prisma.dbsCheck.findUnique({ where: { userId: req.user.id } });
  ok(res, dbs ?? null);
}

async function getDbsForUser(req, res) {
  const dbs = await prisma.dbsCheck.findUnique({ where: { userId: req.params.userId } });
  ok(res, dbs ?? null);
}

async function upsertDbs(req, res) {
  const { userId, status, reference, issuedAt, expiresAt, notes } = req.body;
  if (!userId) return fail(res, 'userId required');
  const dbs = await prisma.dbsCheck.upsert({
    where: { userId },
    create: { userId, status, reference, issuedAt, expiresAt, notes },
    update: { status, reference, issuedAt, expiresAt, notes },
  });
  ok(res, dbs);
}

module.exports = { getMyDbs, getDbsForUser, upsertDbs };
