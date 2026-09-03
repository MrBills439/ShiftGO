const prisma = require('../lib/prisma');
const { ok, created, fail, notFound } = require('../utils/response');
const { agencyIdFor } = require('../utils/agency');

async function listMyTraining(req, res) {
  const trainings = await prisma.training.findMany({
    where: { agencyId: agencyIdFor(req), userId: req.user.id },
    orderBy: { createdAt: 'desc' },
  });
  ok(res, trainings);
}

async function getTrainingForUser(req, res) {
  const { userId } = req.params;
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
  created(res, training);
}

async function updateTraining(req, res) {
  const { id } = req.params;
  const record = await prisma.training.findFirst({ where: { id, agencyId: agencyIdFor(req) } });
  if (!record) return notFound(res);
  const training = await prisma.training.update({
    where: { id },
    data: req.body,
  });
  ok(res, training);
}

module.exports = { listMyTraining, getTrainingForUser, createTraining, updateTraining };
