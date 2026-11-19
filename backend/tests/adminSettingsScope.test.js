/**
 * Admin → Agency settings must only ever touch the caller's own agency.
 * Covers each write the Admin page makes: the employee ID prefix (PATCH
 * /agency), and the geofence radius (GET /houses then PATCH
 * /houses/:id/geofence per service).
 */
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-access-secret';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test-refresh-secret';
process.env.RATE_LIMIT_DISABLED = 'true';

const request = require('supertest');
const { PrismaClient } = require('@prisma/client');
const app = require('../src/app');
const { signAccess } = require('../src/utils/jwt');

const prisma = new PrismaClient();
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const auth = (u) => `Bearer ${signAccess({ id: u.id, agencyId: u.agencyId, role: u.role, status: u.status, name: u.name, email: u.email })}`;
const mkUser = (agencyId, role, tag) => prisma.user.create({
  data: { agencyId, role, name: tag, email: `${tag}-${suffix}@shiftgo.test`.toLowerCase(), passwordHash: 'x' },
});

let agA; let agB; let hrA; let mgrA; let houseA; let houseB;

beforeAll(async () => {
  agA = await prisma.agency.create({ data: { name: `Scope A ${suffix}` } });
  agB = await prisma.agency.create({ data: { name: `Scope B ${suffix}`, employeeIdPrefix: 'BBB' } });
  hrA = await mkUser(agA.id, 'HR', 'scope-hra');
  mgrA = await mkUser(agA.id, 'MANAGER', 'scope-mgra');
  houseA = await prisma.house.create({ data: { agencyId: agA.id, name: `A ${suffix}`, address: 'A', latitude: 51, longitude: 0, geofenceRadius: 50 } });
  houseB = await prisma.house.create({ data: { agencyId: agB.id, name: `B ${suffix}`, address: 'B', latitude: 52, longitude: -1, geofenceRadius: 75 } });
});

afterAll(async () => {
  const ids = [agA.id, agB.id];
  await prisma.auditLog.deleteMany({ where: { agencyId: { in: ids } } });
  await prisma.house.deleteMany({ where: { agencyId: { in: ids } } });
  await prisma.user.deleteMany({ where: { agencyId: { in: ids } } });
  await prisma.agency.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
});

test("setting the employee ID prefix changes only the caller's agency", async () => {
  const res = await request(app).patch('/agency').set('Authorization', auth(hrA)).send({ employeeIdPrefix: 'AAA', id: agB.id, agencyId: agB.id });
  expect(res.status).toBe(200);
  expect(res.body.data.id).toBe(agA.id);
  expect((await prisma.agency.findUnique({ where: { id: agA.id } })).employeeIdPrefix).toBe('AAA');
  expect((await prisma.agency.findUnique({ where: { id: agB.id } })).employeeIdPrefix).toBe('BBB');
});

test("'apply to all services' only lists the caller's services", async () => {
  const res = await request(app).get('/houses').set('Authorization', auth(hrA));
  expect(res.status).toBe(200);
  const ids = res.body.data.map((h) => h.id);
  expect(ids).toContain(houseA.id);
  expect(ids).not.toContain(houseB.id);
});

test("another agency's service geofence cannot be changed (404, unchanged)", async () => {
  for (const user of [hrA, mgrA]) {
    const res = await request(app).patch(`/houses/${houseB.id}/geofence`).set('Authorization', auth(user)).send({ radius: 500 });
    expect(res.status).toBe(404);
  }
  expect((await prisma.house.findUnique({ where: { id: houseB.id } })).geofenceRadius).toBe(75);

  const own = await request(app).patch(`/houses/${houseA.id}/geofence`).set('Authorization', auth(hrA)).send({ radius: 120 });
  expect(own.status).toBe(200);
  expect((await prisma.house.findUnique({ where: { id: houseA.id } })).geofenceRadius).toBe(120);
});
