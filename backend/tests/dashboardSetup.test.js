/**
 * The new-agency setup checklist (dashboard.setup) is derived from real,
 * agency-scoped data: another agency's prefix, services, staff, invitations or
 * shifts must never mark a step complete.
 */
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-access-secret';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test-refresh-secret';
process.env.RATE_LIMIT_DISABLED = 'true';

const crypto = require('crypto');
const request = require('supertest');
const { PrismaClient } = require('@prisma/client');
const app = require('../src/app');
const { signAccess } = require('../src/utils/jwt');

const prisma = new PrismaClient();
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const tokenFor = (u) => signAccess({ id: u.id, agencyId: u.agencyId, role: u.role, status: u.status, name: u.name, email: u.email });
const get = (u) => request(app).get('/dashboard/today').set('Authorization', `Bearer ${tokenFor(u)}`);
const mkUser = (agencyId, role, tag) => prisma.user.create({
  data: { agencyId, role, name: tag, email: `${tag}-${suffix}@shiftgo.test`.toLowerCase(), passwordHash: 'x' },
});

let agA; let agB; let hrA; let mgrA; let tlA; let hrB;

beforeAll(async () => {
  agA = await prisma.agency.create({ data: { name: `Setup A ${suffix}` } });
  agB = await prisma.agency.create({ data: { name: `Setup B ${suffix}`, employeeIdPrefix: 'SETB' } });
  hrA = await mkUser(agA.id, 'HR', 'setup-hra');
  mgrA = await mkUser(agA.id, 'MANAGER', 'setup-mgra');
  tlA = await mkUser(agA.id, 'TEAM_LEADER', 'setup-tla');
  hrB = await mkUser(agB.id, 'HR', 'setup-hrb');

  // Agency B is fully set up — none of this may count for agency A.
  const houseB = await prisma.house.create({ data: { agencyId: agB.id, name: `B ${suffix}`, address: 'B', latitude: 52, longitude: -1 } });
  const workerB = await mkUser(agB.id, 'WORKER', 'setup-wb');
  await prisma.pendingEmployee.create({ data: {
    agencyId: agB.id, email: `setup-pb-${suffix}@shiftgo.test`, role: 'WORKER',
    inviteTokenHash: crypto.randomBytes(16).toString('hex'), expiresAt: new Date(Date.now() + 86_400_000),
  } });
  await prisma.shift.create({ data: {
    agencyId: agB.id, houseId: houseB.id, workerId: workerB.id, createdById: hrB.id,
    startTime: new Date(), endTime: new Date(Date.now() + 3_600_000), date: new Date(),
  } });
});

afterAll(async () => {
  const ids = [agA.id, agB.id];
  await prisma.shift.deleteMany({ where: { agencyId: { in: ids } } });
  await prisma.pendingEmployee.deleteMany({ where: { agencyId: { in: ids } } });
  await prisma.house.deleteMany({ where: { agencyId: { in: ids } } });
  await prisma.user.deleteMany({ where: { agencyId: { in: ids } } });
  await prisma.agency.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
});

describe('dashboard setup progress', () => {
  test("a new agency starts with nothing done, whatever other agencies have", async () => {
    const res = await get(hrA);
    expect(res.status).toBe(200);
    // tlA is a TEAM_LEADER, so activeStaff counts them (workers + team leaders).
    expect(res.body.data.setup).toEqual({
      employeeIdPrefixSet: false, services: 0, activeStaff: 1, pendingInvitations: 0, shifts: 0,
    });
  });

  test('each step is marked from this agency\'s own data', async () => {
    await prisma.agency.update({ where: { id: agA.id }, data: { employeeIdPrefix: 'SETA' } });
    const house = await prisma.house.create({ data: { agencyId: agA.id, name: `A ${suffix}`, address: 'A', latitude: 51, longitude: 0 } });
    await prisma.pendingEmployee.create({ data: {
      agencyId: agA.id, email: `setup-pa-${suffix}@shiftgo.test`, role: 'WORKER',
      inviteTokenHash: crypto.randomBytes(16).toString('hex'), expiresAt: new Date(Date.now() + 86_400_000),
    } });
    // Used and expired invitations are not "waiting".
    await prisma.pendingEmployee.create({ data: {
      agencyId: agA.id, email: `setup-used-${suffix}@shiftgo.test`, role: 'WORKER', consumedAt: new Date(),
      expiresAt: new Date(Date.now() + 86_400_000),
    } });
    await prisma.pendingEmployee.create({ data: {
      agencyId: agA.id, email: `setup-old-${suffix}@shiftgo.test`, role: 'WORKER',
      inviteTokenHash: crypto.randomBytes(16).toString('hex'), expiresAt: new Date(Date.now() - 1000),
    } });
    // A cancelled shift does not count as the first scheduled shift.
    await prisma.shift.create({ data: {
      agencyId: agA.id, houseId: house.id, createdById: hrA.id, status: 'CANCELLED',
      startTime: new Date(), endTime: new Date(Date.now() + 3_600_000), date: new Date(),
    } });

    let setup = (await get(mgrA)).body.data.setup;
    expect(setup).toEqual({ employeeIdPrefixSet: true, services: 1, activeStaff: 1, pendingInvitations: 1, shifts: 0 });

    await prisma.shift.create({ data: {
      agencyId: agA.id, houseId: house.id, createdById: hrA.id, status: 'OPEN',
      startTime: new Date(), endTime: new Date(Date.now() + 3_600_000), date: new Date(),
    } });
    setup = (await get(hrA)).body.data.setup;
    expect(setup.shifts).toBe(1);
  });

  test('team leaders do not get agency-wide setup counts', async () => {
    const res = await get(tlA);
    expect(res.status).toBe(200);
    expect(res.body.data.setup).toBeNull();
  });
});
