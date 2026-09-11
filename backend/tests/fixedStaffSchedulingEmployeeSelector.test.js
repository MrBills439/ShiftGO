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

// Fixed Staff Scheduling V1 correction: the employee selector for a FIXED
// (Location-backed) shift must draw from every ACTIVE employee in the
// caller's agency regardless of their system access Role (WORKER, TEAM_LEADER,
// MANAGER, HR) — Role and workPatternType are orthogonal. This proves the
// unfiltered `GET /users` query (what the web selector now calls) returns
// that full, correctly-scoped set for every operator role that can create a
// shift, and that the TEAM_LEADER-specific guard relaxation in
// backend/src/routes/users.js does not leak DEACTIVATED users or other
// agencies' users.
describe('Fixed Staff Scheduling V1 — employee selector pool', () => {
  let agencyA;
  let agencyB;
  let hrA;
  let managerA;
  let teamLeaderA;
  let workerA;
  let deactivatedWorkerA;
  let workerB;

  function tokenFor(user) {
    return signAccess({
      id: user.id,
      agencyId: user.agencyId,
      role: user.role,
      name: user.name,
      email: user.email,
    });
  }

  beforeAll(async () => {
    agencyA = await prisma.agency.create({ data: { name: `FixedSelector Agency A ${suffix}` } });
    agencyB = await prisma.agency.create({ data: { name: `FixedSelector Agency B ${suffix}` } });

    const makeUser = (agencyId, role, name, status = 'ACTIVE') =>
      prisma.user.create({
        data: {
          agencyId,
          name,
          email: `${name.toLowerCase().replace(/\s+/g, '-')}-${suffix}@shiftgo.test`,
          passwordHash: 'test-password-hash',
          role,
          status,
        },
      });

    hrA = await makeUser(agencyA.id, 'HR', 'Selector HR A');
    managerA = await makeUser(agencyA.id, 'MANAGER', 'Selector Manager A');
    teamLeaderA = await makeUser(agencyA.id, 'TEAM_LEADER', 'Selector TeamLeader A');
    workerA = await makeUser(agencyA.id, 'WORKER', 'Selector Worker A');
    deactivatedWorkerA = await makeUser(agencyA.id, 'WORKER', 'Selector Deactivated Worker A', 'DEACTIVATED');
    workerB = await makeUser(agencyB.id, 'WORKER', 'Selector Worker B');
  });

  afterAll(async () => {
    const ids = [hrA?.id, managerA?.id, teamLeaderA?.id, workerA?.id, deactivatedWorkerA?.id, workerB?.id].filter(Boolean);
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    await prisma.agency.deleteMany({ where: { id: { in: [agencyA?.id, agencyB?.id].filter(Boolean) } } });
    await prisma.$disconnect();
  });

  it.each([
    ['HR', () => hrA],
    ['MANAGER', () => managerA],
    ['TEAM_LEADER', () => teamLeaderA],
  ])('%s operator: unfiltered GET /users includes every active agency role and excludes deactivated/other-agency users', async (_label, getOperator) => {
    const res = await request(app)
      .get('/users')
      .set('Authorization', `Bearer ${tokenFor(getOperator())}`);

    expect(res.status).toBe(200);
    const ids = res.body.data.map((u) => u.id);

    // Included: ACTIVE, same-agency, any system role.
    expect(ids).toContain(hrA.id);
    expect(ids).toContain(managerA.id);
    expect(ids).toContain(teamLeaderA.id);
    expect(ids).toContain(workerA.id);

    // Excluded: DEACTIVATED and other-agency, even though they'd otherwise match.
    expect(ids).not.toContain(deactivatedWorkerA.id);
    expect(ids).not.toContain(workerB.id);
  });

  it('TEAM_LEADER can still list role=WORKER only (unchanged, pre-existing behaviour)', async () => {
    const res = await request(app)
      .get('/users')
      .query({ role: 'WORKER' })
      .set('Authorization', `Bearer ${tokenFor(teamLeaderA)}`);

    expect(res.status).toBe(200);
    const ids = res.body.data.map((u) => u.id);
    expect(ids).toContain(workerA.id);
    expect(ids).not.toContain(hrA.id);
    expect(ids).not.toContain(managerA.id);
    expect(ids).not.toContain(teamLeaderA.id);
  });

  it('TEAM_LEADER remains blocked from explicitly filtering to a non-WORKER role (guard stays narrow)', async () => {
    const res = await request(app)
      .get('/users')
      .query({ role: 'HR' })
      .set('Authorization', `Bearer ${tokenFor(teamLeaderA)}`);

    expect(res.status).toBe(403);
  });
});
