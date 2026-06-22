const { PrismaClient } = require('@prisma/client');
const { ok, created, fail, notFound } = require('../utils/response');

const prisma = new PrismaClient();

async function listMyTraining(req, res) {
  const trainings = await prisma.training.findMany({
    where: { userId: req.user.id },
    orderBy: { createdAt: 'desc' },
  });
  ok(res, trainings);
}

async function getTrainingForUser(req, res) {
  const { userId } = req.params;
  const trainings = await prisma.training.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
  });
  ok(res, trainings);
}

async function createTraining(req, res) {
  const { userId, title, description, status, completedAt, expiresAt } = req.body;
  if (!userId || !title) return fail(res, 'userId and title required');
  const training = await prisma.training.create({
    data: { userId, title, description, status, completedAt, expiresAt },
  });
  created(res, training);
}

async function updateTraining(req, res) {
  const { id } = req.params;
  const record = await prisma.training.findUnique({ where: { id } });
  if (!record) return notFound(res);
  const training = await prisma.training.update({
    where: { id },
    data: req.body,
  });
  ok(res, training);
}

module.exports = { listMyTraining, getTrainingForUser, createTraining, updateTraining };
