const path = require('path');
const { PrismaClient } = require('@prisma/client');
const { ok, created, fail, notFound } = require('../utils/response');
const { auditContext, createAuditLog } = require('../services/auditService');
const authService = require('../services/authService');
const { agencyIdFor } = require('../utils/agency');

const prisma = new PrismaClient();

const userSelect = {
  id: true,
  agencyId: true,
  name: true,
  email: true,
  role: true,
  status: true,
  phone: true,
  deactivatedAt: true,
  deactivatedById: true,
  deactivationReason: true,
  createdAt: true,
};

const meSelect = {
  id: true, agencyId: true, name: true, email: true, role: true, status: true,
  phone: true, bio: true, profilePicture: true, address: true,
  createdAt: true, updatedAt: true,
};

async function listUsers(req, res) {
  const { role, status = 'ACTIVE' } = req.query;
  const where = { agencyId: agencyIdFor(req), status, ...(role ? { role } : {}) };
  const users = await prisma.user.findMany({ where, select: userSelect, orderBy: { name: 'asc' } });
  ok(res, users);
}

async function getUser(req, res) {
  const user = await prisma.user.findFirst({ where: { id: req.params.id, agencyId: agencyIdFor(req) }, select: userSelect });
  if (!user) return notFound(res);
  ok(res, user);
}

async function createUser(req, res) {
  const agencyId = agencyIdFor(req);
  if (req.body.agencyId && req.body.agencyId !== agencyId) {
    return fail(res, 'Cannot create users outside your agency', 403);
  }

  try {
    const user = await authService.createUser(req.body, agencyId);
    await createAuditLog({
      ...auditContext(req),
      action: 'USER_CREATED',
      entityType: 'User',
      entityId: user.id,
      newValue: user,
    });
    created(res, user);
  } catch (err) {
    if (err.code === 'P2002') return fail(res, 'Email already in use');
    throw err;
  }
}

async function deactivateUser(req, res) {
  const agencyId = agencyIdFor(req);
  const { id } = req.params;
  const reason = req.body.reason.trim();

  if (id === req.user.id) return fail(res, 'You cannot deactivate your own account', 409);

  const oldUser = await prisma.user.findFirst({ where: { id, agencyId }, select: userSelect });
  if (!oldUser) return notFound(res);
  if (oldUser.status === 'DEACTIVATED') return fail(res, 'User is already deactivated', 409);

  const user = await prisma.user.update({
    where: { id },
    data: {
      status: 'DEACTIVATED',
      deactivatedAt: new Date(),
      deactivatedById: req.user.id,
      deactivationReason: reason,
      fcmToken: null,
    },
    select: userSelect,
  });

  await createAuditLog({
    ...auditContext(req),
    action: 'USER_DEACTIVATED',
    entityType: 'User',
    entityId: user.id,
    oldValue: oldUser,
    newValue: user,
  });

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
  const oldUser = await prisma.user.findUnique({ where: { id: req.user.id }, select: meSelect });
  const user = await prisma.user.update({
    where: { id: req.user.id },
    data,
    select: meSelect,
  });
  await createAuditLog({
    ...auditContext(req),
    action: 'USER_UPDATED',
    entityType: 'User',
    entityId: user.id,
    oldValue: oldUser,
    newValue: user,
  });
  ok(res, user);
}

async function uploadAvatar(req, res) {
  if (!req.file) return fail(res, 'No file uploaded');
  const filename = req.file.filename;
  const profilePicture = `/uploads/avatars/${filename}`;
  const oldUser = await prisma.user.findUnique({ where: { id: req.user.id }, select: meSelect });
  const user = await prisma.user.update({
    where: { id: req.user.id },
    data: { profilePicture },
    select: meSelect,
  });
  await createAuditLog({
    ...auditContext(req),
    action: 'USER_UPDATED',
    entityType: 'User',
    entityId: user.id,
    oldValue: oldUser,
    newValue: user,
  });
  ok(res, user);
}

async function assignWorkerToHouse(req, res) {
  const agencyId = agencyIdFor(req);
  const { workerId, houseId } = req.body;
  if (!workerId || !houseId) return fail(res, 'workerId and houseId required');
  const [worker, house] = await Promise.all([
    prisma.user.findFirst({ where: { id: workerId, agencyId } }),
    prisma.house.findFirst({ where: { id: houseId, agencyId } }),
  ]);
  if (!worker || !house) return fail(res, 'Worker and house must belong to your agency', 403);
  if (worker.status === 'DEACTIVATED') return fail(res, 'Worker is deactivated and cannot be assigned to a house', 403);

  const record = await prisma.houseWorker.upsert({
    where: { houseId_workerId: { houseId, workerId } },
    create: { houseId, workerId },
    update: {},
  });
  created(res, record);
}

async function assignTeamLeaderToHouse(req, res) {
  const agencyId = agencyIdFor(req);
  const { teamLeaderId, houseId } = req.body;
  if (!teamLeaderId || !houseId) return fail(res, 'teamLeaderId and houseId required');
  const [teamLeader, house] = await Promise.all([
    prisma.user.findFirst({ where: { id: teamLeaderId, agencyId } }),
    prisma.house.findFirst({ where: { id: houseId, agencyId } }),
  ]);
  if (!teamLeader || !house) return fail(res, 'Team leader and house must belong to your agency', 403);
  if (teamLeader.status === 'DEACTIVATED') return fail(res, 'Team leader is deactivated and cannot be assigned to a house', 403);

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
  listUsers, getUser, createUser, deactivateUser, getMe, updateMe, uploadAvatar,
  assignWorkerToHouse, assignTeamLeaderToHouse, updateFcmToken,
};
