const prisma = require('../lib/prisma');
const { ok, created, notFound, fail } = require('../utils/response');
const { agencyIdFor } = require('../utils/agency');

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
    include: {
      manager: { select: { id: true, name: true } },
      workers: { include: { worker: { select: { id: true, name: true, email: true } } } },
    },
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
  const { name, address, latitude, longitude, geofenceRadius, autoConfirm, assignedHours } = req.body;
  // A manager who doesn't pick someone else defaults to managing what they create —
  // otherwise listHouses (which scopes managers to managerId: their own id) would
  // hide the service from them immediately after creating it.
  const managerId = req.body.managerId || (req.user.role === 'MANAGER' ? req.user.id : undefined);
  if (!name || !address || latitude == null || longitude == null) {
    return fail(res, 'name, address, latitude, longitude required');
  }

  if (managerId) {
    const manager = await prisma.user.findFirst({ where: { id: managerId, agencyId: agencyIdFor(req) } });
    if (!manager) return fail(res, 'Manager must belong to your agency', 403);
  }

  const house = await prisma.house.create({
    data: { agencyId: agencyIdFor(req), name, address, latitude, longitude, geofenceRadius, managerId, autoConfirm, assignedHours },
  });
  created(res, house);
}

async function updateHouse(req, res) {
  const existing = await prisma.house.findFirst({ where: { id: req.params.id, agencyId: agencyIdFor(req) } });
  if (!existing) return notFound(res);

  // Reassigning who manages a service is an HR-only decision (see the dedicated
  // "Change Manager" flow) — strip it here so opening general edits to Managers
  // doesn't let one reassign a service away from themselves or to someone else.
  const { managerId, ...body } = req.body;
  if (req.user.role === 'HR' && managerId !== undefined) {
    if (managerId) {
      const manager = await prisma.user.findFirst({ where: { id: managerId, agencyId: agencyIdFor(req) } });
      if (!manager) return fail(res, 'Manager must belong to your agency', 403);
    }
    body.managerId = managerId;
  }

  const house = await prisma.house.update({
    where: { id: req.params.id },
    data: body,
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

async function listSupportedPeople(req, res) {
  const house = await prisma.house.findFirst({ where: { id: req.params.id, agencyId: agencyIdFor(req) } });
  if (!house) return notFound(res);
  const people = await prisma.supportedPerson.findMany({
    where: { houseId: req.params.id },
    orderBy: { name: 'asc' },
  });
  ok(res, people);
}

async function createSupportedPerson(req, res) {
  const house = await prisma.house.findFirst({ where: { id: req.params.id, agencyId: agencyIdFor(req) } });
  if (!house) return notFound(res);

  const { name, dateOfBirth, emergencyContactName, emergencyContactPhone } = req.body;
  const person = await prisma.supportedPerson.create({
    data: {
      agencyId: agencyIdFor(req),
      houseId: house.id,
      name,
      dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : undefined,
      emergencyContactName: emergencyContactName || undefined,
      emergencyContactPhone: emergencyContactPhone || undefined,
    },
  });
  created(res, person);
}

async function deleteSupportedPerson(req, res) {
  const person = await prisma.supportedPerson.findFirst({
    where: { id: req.params.personId, houseId: req.params.id, agencyId: agencyIdFor(req) },
  });
  if (!person) return notFound(res);
  await prisma.supportedPerson.delete({ where: { id: person.id } });
  ok(res, { deleted: true });
}

module.exports = {
  listHouses, getHouse, createHouse, updateHouse, updateGeofence, deleteHouse,
  listSupportedPeople, createSupportedPerson, deleteSupportedPerson,
};
