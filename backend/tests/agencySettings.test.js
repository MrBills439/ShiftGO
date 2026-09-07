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
const tokenFor = (u) => signAccess({ id: u.id, agencyId: u.agencyId, role: u.role, status: u.status, name: u.name, email: u.email });

let agencyA;
let agencyB;
let hrA;
let managerA;
let workerA;
let hrB;

async function mkUser(agencyId, role, tag) {
  return prisma.user.create({ data: { agencyId, role, name: `AS ${tag}`, email: `as-${tag}-${suffix}@shiftgo.test`, passwordHash: 'x' } });
}

beforeAll(async () => {
  agencyA = await prisma.agency.create({ data: { name: `AS A ${suffix}` } });
  agencyB = await prisma.agency.create({ data: { name: `AS B ${suffix}`, maxWeeklyScheduledHours: 48 } });
  hrA = await mkUser(agencyA.id, 'HR', 'hrA');
  managerA = await mkUser(agencyA.id, 'MANAGER', 'mgrA');
  workerA = await mkUser(agencyA.id, 'WORKER', 'wkrA');
  hrB = await mkUser(agencyB.id, 'HR', 'hrB');
});

afterEach(async () => {
  await prisma.auditLog.deleteMany({ where: { agencyId: { in: [agencyA.id, agencyB.id] } } });
  await prisma.agency.update({ where: { id: agencyA.id }, data: { maxWeeklyScheduledHours: 60 } });
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { agencyId: { in: [agencyA.id, agencyB.id] } } });
  await prisma.agency.deleteMany({ where: { id: { in: [agencyA.id, agencyB.id] } } });
  await prisma.$disconnect();
});

const getAgency = (u) => request(app).get('/agency').set('Authorization', `Bearer ${tokenFor(u)}`);
const patchAgency = (u, body) => request(app).patch('/agency').set('Authorization', `Bearer ${tokenFor(u)}`).send(body);

describe('GET/PATCH /agency — max weekly hours setting', () => {
  test('GET returns the configured value (managers + HR)', async () => {
    for (const u of [hrA, managerA]) {
      const res = await getAgency(u);
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ id: agencyA.id, maxWeeklyScheduledHours: 60 });
    }
  });

  test('a worker cannot read or write agency settings', async () => {
    expect((await getAgency(workerA)).status).toBe(403);
    expect((await patchAgency(workerA, { maxWeeklyScheduledHours: 40 })).status).toBe(403);
  });

  test('HR updates the value, it persists, and the change is audited', async () => {
    const res = await patchAgency(hrA, { maxWeeklyScheduledHours: 55 });
    expect(res.status).toBe(200);
    expect(res.body.data.maxWeeklyScheduledHours).toBe(55);

    expect((await prisma.agency.findUnique({ where: { id: agencyA.id } })).maxWeeklyScheduledHours).toBe(55);

    const audit = await prisma.auditLog.findFirst({ where: { action: 'AGENCY_SETTINGS_UPDATED', entityId: agencyA.id } });
    expect(audit).toBeTruthy();
    expect(audit.actorId).toBe(hrA.id);
    expect(audit.oldValue.maxWeeklyScheduledHours).toBe(60);
    expect(audit.newValue.maxWeeklyScheduledHours).toBe(55);
  });

  test('a MANAGER cannot write the setting', async () => {
    const res = await patchAgency(managerA, { maxWeeklyScheduledHours: 40 });
    expect(res.status).toBe(403);
    expect((await prisma.agency.findUnique({ where: { id: agencyA.id } })).maxWeeklyScheduledHours).toBe(60);
  });

  test('rejects out-of-range values', async () => {
    for (const bad of [0, -5, 200, 12.5, 'sixty']) {
      const res = await patchAgency(hrA, { maxWeeklyScheduledHours: bad });
      expect(res.status).toBe(400);
    }
    expect((await prisma.agency.findUnique({ where: { id: agencyA.id } })).maxWeeklyScheduledHours).toBe(60);
  });

  test('agency scoping — HR of one agency cannot change another', async () => {
    await patchAgency(hrA, { maxWeeklyScheduledHours: 50 });
    expect((await prisma.agency.findUnique({ where: { id: agencyB.id } })).maxWeeklyScheduledHours).toBe(48);
    const resB = await getAgency(hrB);
    expect(resB.body.data.id).toBe(agencyB.id);
    expect(resB.body.data.maxWeeklyScheduledHours).toBe(48);
  });
});
