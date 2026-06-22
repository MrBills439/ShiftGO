const { PrismaClient } = require('@prisma/client');
const { ok, created, notFound, fail } = require('../utils/response');

const prisma = new PrismaClient();

async function listHouses(req, res) {
  const { role, id } = req.user;
  let where = {};

  if (role === 'MANAGER') where = { managerId: id };
  else if (role === 'TEAM_LEADER') {
    const links = await prisma.houseTeamLeader.findMany({ where: { teamLeaderId: id } });
    where = { id: { in: links.map((l) => l.houseId) } };
  } else if (role === 'WORKER') {
    const links = await prisma.houseWorker.findMany({ where: { workerId: id } });
    where = { id: { in: links.map((l) => l.houseId) } };
  }

  const houses = await prisma.house.findMany({
    where,
    include: { manager: { select: { id: true, name: true } } },
    orderBy: { name: 'asc' },
  });
  ok(res, houses);
}

async function getHouse(req, res) {
  const house = await prisma.house.findUnique({
    where: { id: req.params.id },
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

  const house = await prisma.house.create({
    data: { name, address, latitude, longitude, geofenceRadius, managerId, autoConfirm },
  });
  created(res, house);
}

async function updateHouse(req, res) {
  const house = await prisma.house.update({
    where: { id: req.params.id },
    data: req.body,
  });
  ok(res, house);
}

async function updateGeofence(req, res) {
  const { radius } = req.body;
  if (!radius || radius < 10) return fail(res, 'Minimum radius is 10 metres');

  const house = await prisma.house.update({
    where: { id: req.params.id },
    data: { geofenceRadius: parseInt(radius, 10) },
  });
  ok(res, house);
}

async function deleteHouse(req, res) {
  await prisma.house.delete({ where: { id: req.params.id } });
  ok(res, { deleted: true });
}

module.exports = { listHouses, getHouse, createHouse, updateHouse, updateGeofence, deleteHouse };
