// Regression tests for the security audit fixes (Nov 2026). Each describe block
// pins one finding so it cannot quietly come back.
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
const tokenFor = (u) => signAccess({ id: u.id, agencyId: u.agencyId, role: u.role });
const auth = (u) => ({ Authorization: `Bearer ${tokenFor(u)}` });

let agencyA;
let agencyB;
let hrA;
let managerA;
let teamLeaderA;
let workerA;
let workerB;
let houseA;

async function makeUser(agencyId, role, tag) {
  return prisma.user.create({
    data: { agencyId, role, name: `${role} ${tag}`, email: `audit-${tag}-${suffix}@shiftgo.test` },
  });
}
async function makeHouse(agencyId, name) {
  return prisma.house.create({ data: { agencyId, name, address: '1 Test St', latitude: 51.5, longitude: -0.1 } });
}

beforeAll(async () => {
  agencyA = await prisma.agency.create({ data: { name: `Audit A ${suffix}` } });
  agencyB = await prisma.agency.create({ data: { name: `Audit B ${suffix}` } });
  hrA = await makeUser(agencyA.id, 'HR', 'hra');
  managerA = await makeUser(agencyA.id, 'MANAGER', 'mgra');
  teamLeaderA = await makeUser(agencyA.id, 'TEAM_LEADER', 'tla');
  workerA = await makeUser(agencyA.id, 'WORKER', 'wa');
  workerB = await makeUser(agencyB.id, 'WORKER', 'wb');
  houseA = await makeHouse(agencyA.id, 'Audit House A');
  await prisma.house.update({ where: { id: houseA.id }, data: { managerId: managerA.id } });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('Fix 1 — no cross-agency writes through update endpoints', () => {
  test('PATCH /houses/:id ignores agencyId and other non-editable fields', async () => {
    const res = await request(app)
      .patch(`/houses/${houseA.id}`)
      .set(auth(managerA))
      .send({ agencyId: agencyB.id, name: 'Renamed House' });
    expect(res.status).toBe(200);
    const after = await prisma.house.findUnique({ where: { id: houseA.id } });
    expect(after.agencyId).toBe(agencyA.id);
    expect(after.name).toBe('Renamed House');
  });

  test('PATCH /training/:id cannot move a record to another agency or person', async () => {
    const tr = await prisma.training.create({ data: { agencyId: agencyA.id, userId: workerA.id, title: 'Safeguarding' } });
    const res = await request(app)
      .patch(`/training/${tr.id}`)
      .set(auth(managerA))
      .send({ agencyId: agencyB.id, userId: workerB.id, status: 'COMPLETED' });
    expect(res.status).toBe(200);
    const after = await prisma.training.findUnique({ where: { id: tr.id } });
    expect(after.agencyId).toBe(agencyA.id);
    expect(after.userId).toBe(workerA.id);
    expect(after.status).toBe('COMPLETED');
  });
});

describe('Fix 2 — team leaders only see their own services and staff', () => {
  let ownHouse;
  let otherHouse;
  let ownWorker;
  let otherWorker;

  beforeAll(async () => {
    ownHouse = await makeHouse(agencyA.id, 'TL Own House');
    otherHouse = await makeHouse(agencyA.id, 'TL Other House');
    ownWorker = await makeUser(agencyA.id, 'WORKER', 'own-worker');
    otherWorker = await makeUser(agencyA.id, 'WORKER', 'other-worker');
    await prisma.houseTeamLeader.create({ data: { houseId: ownHouse.id, teamLeaderId: teamLeaderA.id } });
    await prisma.houseWorker.create({ data: { houseId: ownHouse.id, workerId: ownWorker.id } });
    await prisma.houseWorker.create({ data: { houseId: otherHouse.id, workerId: otherWorker.id } });
    for (const h of [ownHouse, otherHouse]) {
      await prisma.supportedPerson.create({ data: { agencyId: agencyA.id, houseId: h.id, name: `Resident of ${h.name}` } });
    }
    for (const u of [ownWorker, otherWorker, managerA]) {
      await prisma.dbsCheck.create({ data: { agencyId: agencyA.id, userId: u.id, status: 'CLEAR' } });
      await prisma.training.create({ data: { agencyId: agencyA.id, userId: u.id, title: 'Manual handling' } });
      await prisma.shareCode.create({ data: { agencyId: agencyA.id, userId: u.id, code: 'ABC123XYZ', shareDate: new Date() } });
    }
  });

  test('house detail and residents: own house yes, other house 404', async () => {
    for (const path of ['', '/supported-people']) {
      const own = await request(app).get(`/houses/${ownHouse.id}${path}`).set(auth(teamLeaderA));
      expect(own.status).toBe(200);
      const other = await request(app).get(`/houses/${otherHouse.id}${path}`).set(auth(teamLeaderA));
      expect(other.status).toBe(404);
    }
  });

  test('house timesheets: own house yes, other house 404', async () => {
    expect((await request(app).get(`/timesheets/house/${ownHouse.id}`).set(auth(teamLeaderA))).status).toBe(200);
    expect((await request(app).get(`/timesheets/house/${otherHouse.id}`).set(auth(teamLeaderA))).status).toBe(404);
  });

  test.each(['/dbs/user', '/training/user', '/right-to-work/user'])(
    '%s/:id — own worker yes; other worker and manager 404',
    async (base) => {
      expect((await request(app).get(`${base}/${ownWorker.id}`).set(auth(teamLeaderA))).status).toBe(200);
      expect((await request(app).get(`${base}/${otherWorker.id}`).set(auth(teamLeaderA))).status).toBe(404);
      expect((await request(app).get(`${base}/${managerA.id}`).set(auth(teamLeaderA))).status).toBe(404);
    },
  );

  test('right-to-work document download for an out-of-scope worker is 404', async () => {
    const res = await request(app).get(`/right-to-work/user/${otherWorker.id}/document`).set(auth(teamLeaderA));
    expect(res.status).toBe(404);
  });

  test('managers and HR keep agency-wide access', async () => {
    for (const actor of [managerA, hrA]) {
      expect((await request(app).get(`/houses/${otherHouse.id}/supported-people`).set(auth(actor))).status).toBe(200);
      expect((await request(app).get(`/dbs/user/${otherWorker.id}`).set(auth(actor))).status).toBe(200);
    }
  });
});
