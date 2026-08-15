const { PrismaClient } = require('@prisma/client');
const { ok, created, notFound, fail } = require('../utils/response');
const { agencyIdFor } = require('../utils/agency');

const prisma = new PrismaClient();

async function listHouses(req, res) {
  const { role, id } = req.user;
  const agencyId = agencyIdFor(req);
  let where = { agencyId };

  if (role === 'MANAGER') where = { agencyId, managerId: id };
  else if (role === 'TEAM_LEADER') {
    const links = await prisma.houseTeamLeader.findMany({ where: { teamLeaderId: id } });
    where = { agencyId, id: { in: links.map((l) => l.houseId) } };
  } else if (role === 'WORKER') {
    const links = await prisma.houseWorker.findMany({ where: { workerId: id } });
    where = { agencyId, id: { in: links.map((l) => l.houseId) } };
  }

  const houses = await prisma.house.findMany({
    where,
    include: { manager: { select: { id: true, name: true } } },
    orderBy: { name: 'asc' },
  });
  ok(res, houses);
}

async function getHouse(req, res) {
  const house = await prisma.house.findFirst({
    where: { id: req.params.id, agencyId: agencyIdFor(req) },
    include: {
      manager: { select: { id: true, name: true } },
      workers: { include: { worker: { select: { id: true, name: true, email: true } } } },
      teamLeaders: { include: { teamLeader: { select: { id: true, name: true } } } },
    },
  });
  if (!house) return notFound(res);
  ok(res, house);
}

async function createHouse(req, res) {
  const { name, address, latitude, longitude, geofenceRadius, managerId, autoConfirm } = req.body;
  if (!name || !address || latitude == null || longitude == null) {
    return fail(res, 'name, address, latitude, longitude required');
  }

  if (managerId) {
    const manager = await prisma.user.findFirst({ where: { id: managerId, agencyId: agencyIdFor(req) } });
    if (!manager) return fail(res, 'Manager must belong to your agency', 403);
  }

  const house = await prisma.house.create({
    data: { agencyId: agencyIdFor(req), name, address, latitude, longitude, geofenceRadius, managerId, autoConfirm },
  });
  created(res, house);
}

async function updateHouse(req, res) {
  const existing = await prisma.house.findFirst({ where: { id: req.params.id, agencyId: agencyIdFor(req) } });
  if (!existing) return notFound(res);
  const house = await prisma.house.update({
    where: { id: req.params.id },
    data: req.body,
  });
  ok(res, house);
}

async function updateGeofence(req, res) {
  const { radius } = req.body;
  if (!radius || radius < 10) return fail(res, 'Minimum radius is 10 metres');

  const existing = await prisma.house.findFirst({ where: { id: req.params.id, agencyId: agencyIdFor(req) } });
  if (!existing) return notFound(res);
  const house = await prisma.house.update({
    where: { id: req.params.id },
    data: { geofenceRadius: parseInt(radius, 10) },
  });
  ok(res, house);
}

async function deleteHouse(req, res) {
  const existing = await prisma.house.findFirst({ where: { id: req.params.id, agencyId: agencyIdFor(req) } });
  if (!existing) return notFound(res);
  await prisma.house.delete({ where: { id: req.params.id } });
  ok(res, { deleted: true });
}

module.exports = { listHouses, getHouse, createHouse, updateHouse, updateGeofence, deleteHouse };
