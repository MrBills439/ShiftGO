const path = require('path');
const { PrismaClient } = require('@prisma/client');
const { ok, created, fail, notFound } = require('../utils/response');

const prisma = new PrismaClient();

const userSelect = { id: true, name: true, email: true, role: true, createdAt: true };

const meSelect = {
  id: true, name: true, email: true, role: true,
  phone: true, bio: true, profilePicture: true, address: true,
  createdAt: true, updatedAt: true,
};

async function listUsers(req, res) {
  const { role } = req.query;
  const where = role ? { role } : {};
  const users = await prisma.user.findMany({ where, select: userSelect, orderBy: { name: 'asc' } });
  ok(res, users);
}

async function getUser(req, res) {
  const user = await prisma.user.findUnique({ where: { id: req.params.id }, select: userSelect });
  if (!user) return notFound(res);
  ok(res, user);
}

async function getMe(req, res) {
  const user = await prisma.user.findUnique({ where: { id: req.user.id }, select: meSelect });
  if (!user) return notFound(res);
  ok(res, user);
}

async function updateMe(req, res) {
  const allowed = ['name', 'phone', 'bio', 'address'];
  const data = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) data[key] = req.body[key];
  }
  const user = await prisma.user.update({
    where: { id: req.user.id },
    data,
    select: meSelect,
  });
  ok(res, user);
}

async function uploadAvatar(req, res) {
  if (!req.file) return fail(res, 'No file uploaded');
  const filename = req.file.filename;
  const profilePicture = `/uploads/avatars/${filename}`;
  const user = await prisma.user.update({
    where: { id: req.user.id },
    data: { profilePicture },
    select: meSelect,
  });
  ok(res, user);
}

async function assignWorkerToHouse(req, res) {
  const { workerId, houseId } = req.body;
  if (!workerId || !houseId) return fail(res, 'workerId and houseId required');

  const record = await prisma.houseWorker.upsert({
    where: { houseId_workerId: { houseId, workerId } },
    create: { houseId, workerId },
    update: {},
  });
  created(res, record);
}

async function assignTeamLeaderToHouse(req, res) {
  const { teamLeaderId, houseId } = req.body;
  if (!teamLeaderId || !houseId) return fail(res, 'teamLeaderId and houseId required');

  const record = await prisma.houseTeamLeader.upsert({
    where: { houseId_teamLeaderId: { houseId, teamLeaderId } },
    create: { houseId, teamLeaderId },
    update: {},
  });
  created(res, record);
}

async function updateFcmToken(req, res) {
  const { fcmToken } = req.body;
  const user = await prisma.user.update({
    where: { id: req.user.id },
    data: { fcmToken },
    select: userSelect,
  });
  ok(res, user);
}

module.exports = {
  listUsers, getUser, getMe, updateMe, uploadAvatar,
  assignWorkerToHouse, assignTeamLeaderToHouse, updateFcmToken,
};
