const prisma = require('../lib/prisma');
const { ok, created, fail, notFound } = require('../utils/response');
const { agencyIdFor } = require('../utils/agency');
const { canViewPersonRecords } = require('../services/accessScope');
const { auditContext, createAuditLog } = require('../services/auditService');

async function listMyTraining(req, res) {
  const trainings = await prisma.training.findMany({
    where: { agencyId: agencyIdFor(req), userId: req.user.id },
    orderBy: { createdAt: 'desc' },
  });
  ok(res, trainings);
}

async function getTrainingForUser(req, res) {
  const { userId } = req.params;
  if (!(await canViewPersonRecords(req.user, userId, agencyIdFor(req)))) return notFound(res);
  const trainings = await prisma.training.findMany({
    where: { agencyId: agencyIdFor(req), userId },
    orderBy: { createdAt: 'desc' },
  });
  ok(res, trainings);
}

async function createTraining(req, res) {
  const { userId, title, description, status, completedAt, expiresAt } = req.body;
  if (!userId || !title) return fail(res, 'userId and title required');
  const user = await prisma.user.findFirst({ where: { id: userId, agencyId: agencyIdFor(req) } });
  if (!user) return fail(res, 'User must belong to your agency', 403);
  const training = await prisma.training.create({
    data: { agencyId: agencyIdFor(req), userId, title, description, status, completedAt, expiresAt },
  });
  await createAuditLog({
    ...auditContext(req), action: 'TRAINING_CREATED', entityType: 'Training', entityId: training.id, newValue: training,
  });
  created(res, training);
}

async function updateTraining(req, res) {
  const { id } = req.params;
  const record = await prisma.training.findFirst({ where: { id, agencyId: agencyIdFor(req) } });
  if (!record) return notFound(res);
  // Whitelist: userId / agencyId / id are never editable, so a record can't be
  // re-pointed at another person or moved into another agency.
  const data = {};
  for (const key of ['title', 'description', 'status', 'completedAt', 'expiresAt']) {
    if (req.body[key] !== undefined) data[key] = req.body[key];
  }
  const training = await prisma.training.update({
    where: { id },
    data,
  });
  await createAuditLog({
    ...auditContext(req), action: 'TRAINING_UPDATED', entityType: 'Training', entityId: training.id,
    oldValue: record, newValue: training,
  });
  ok(res, training);
}

module.exports = { listMyTraining, getTrainingForUser, createTraining, updateTraining };
