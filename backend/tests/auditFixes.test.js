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

describe('Fix 3 — nobody reviews their own timesheet; team leaders only their services', () => {
  let tlHouse;
  let otherHouse;

  async function makeTimesheet(worker, house) {
    const now = new Date();
    const shift = await prisma.shift.create({
      data: { agencyId: agencyA.id, houseId: house.id, workerId: worker.id, createdById: managerA.id, startTime: now, endTime: now, date: now },
    });
    return prisma.timesheet.create({
      data: { agencyId: agencyA.id, houseId: house.id, workerId: worker.id, shiftId: shift.id, totalHours: 8 },
    });
  }

  beforeAll(async () => {
    tlHouse = await makeHouse(agencyA.id, 'TS TL House');
    otherHouse = await makeHouse(agencyA.id, 'TS Other House');
    await prisma.houseTeamLeader.create({ data: { houseId: tlHouse.id, teamLeaderId: teamLeaderA.id } });
  });

  test('team leader cannot approve their own timesheet', async () => {
    const ts = await makeTimesheet(teamLeaderA, tlHouse);
    const res = await request(app).post(`/timesheets/${ts.id}/confirm`).set(auth(teamLeaderA)).send({});
    expect(res.status).toBe(403);
    expect((await prisma.timesheet.findUnique({ where: { id: ts.id } })).status).toBe('PENDING');
  });

  test('manager cannot approve or reject their own timesheet', async () => {
    const ts = await makeTimesheet(managerA, tlHouse);
    expect((await request(app).post(`/timesheets/${ts.id}/confirm`).set(auth(managerA)).send({})).status).toBe(403);
    expect((await request(app).post(`/timesheets/${ts.id}/reject`).set(auth(managerA)).send({ reason: 'Hours do not match the rota' })).status).toBe(403);
  });

  test('team leader can approve a worker at their own house, not at another house', async () => {
    const own = await makeTimesheet(workerA, tlHouse);
    const other = await makeTimesheet(workerA, otherHouse);
    expect((await request(app).post(`/timesheets/${own.id}/confirm`).set(auth(teamLeaderA)).send({})).status).toBe(200);
    expect((await request(app).post(`/timesheets/${other.id}/confirm`).set(auth(teamLeaderA)).send({})).status).toBe(404);
    expect((await prisma.timesheet.findUnique({ where: { id: other.id } })).status).toBe('PENDING');
  });

  test('manager can approve a team leader timesheet', async () => {
    const ts = await makeTimesheet(teamLeaderA, tlHouse);
    const res = await request(app).post(`/timesheets/${ts.id}/confirm`).set(auth(managerA)).send({});
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('APPROVED');
  });
});

describe('Week 2 — no fallback tenant', () => {
  const { agencyIdFor } = require('../src/utils/agency');

  test('agencyIdFor returns the caller agency', () => {
    expect(agencyIdFor({ user: { agencyId: 'agency_x' } })).toBe('agency_x');
    expect(agencyIdFor({ agencyId: 'agency_y' })).toBe('agency_y');
  });

  test('agencyIdFor throws instead of falling back to a shared agency', () => {
    expect(() => agencyIdFor({ user: {} })).toThrow('No agency in request context');
    expect(() => agencyIdFor(undefined)).toThrow();
  });

  test('new rows must name their agency (no database default)', async () => {
    await expect(
      prisma.house.create({ data: { name: 'No agency', address: 'x', latitude: 0, longitude: 0 } }),
    ).rejects.toThrow();
  });
});

describe('Week 2 — audit trail for sensitive records', () => {
  const latest = (where) => prisma.auditLog.findFirst({ where: { agencyId: agencyA.id, ...where }, orderBy: { createdAt: 'desc' } });

  test('viewing someone else\'s DBS is logged, without the notes', async () => {
    const subject = await makeUser(agencyA.id, 'WORKER', 'dbs-subject');
    await request(app).post('/dbs').set(auth(hrA))
      .send({ userId: subject.id, status: 'FLAGGED', reference: 'DBS-SECRET-REF', notes: 'conviction details here' });
    const write = await latest({ action: 'DBS_RECORD_CREATED', actorId: hrA.id });
    expect(write).toBeTruthy();
    expect(JSON.stringify(write)).not.toContain('conviction details');
    expect(JSON.stringify(write)).not.toContain('DBS-SECRET-REF');

    const res = await request(app).get(`/dbs/user/${subject.id}`).set(auth(managerA));
    expect(res.status).toBe(200);
    const view = await latest({ action: 'DBS_RECORD_VIEWED', actorId: managerA.id });
    expect(view.newValue.subjectUserId).toBe(subject.id);
    expect(JSON.stringify(view)).not.toContain('conviction details');
  });

  test('viewing a right-to-work record is logged; share code is not copied into the log', async () => {
    const subject = await makeUser(agencyA.id, 'WORKER', 'rtw-subject');
    await request(app).put(`/right-to-work/user/${subject.id}`).set(auth(hrA)).send({ code: 'QQ1WW2EE3', shareDate: new Date().toISOString() });
    await request(app).get(`/right-to-work/user/${subject.id}`).set(auth(managerA));
    const view = await latest({ action: 'RTW_RECORD_VIEWED', actorId: managerA.id });
    expect(view.newValue.subjectUserId).toBe(subject.id);
    const write = await latest({ action: 'RTW_SHARE_CODE_UPDATED', actorId: hrA.id });
    expect(write).toBeTruthy();
    expect(JSON.stringify(write)).not.toContain('QQ1WW2EE3');
  });

  test('viewing a service\'s residents is logged', async () => {
    await request(app).get(`/houses/${houseA.id}/supported-people`).set(auth(managerA));
    expect(await latest({ action: 'RESIDENTS_VIEWED', actorId: managerA.id, entityId: houseA.id })).toBeTruthy();
  });

  test('the full audit log is HR only', async () => {
    expect((await request(app).get('/audit-logs').set(auth(managerA))).status).toBe(403);
    expect((await request(app).get('/audit-logs').set(auth(hrA))).status).toBe(200);
  });

  test('activity feed: real headings and actor names, no sensitive-access entries', async () => {
    await prisma.auditLog.create({
      data: { agencyId: agencyA.id, actorId: managerA.id, action: 'SHIFT_CANCELLED', entityType: 'Shift', entityId: 'shift-x' },
    });
    const res = await request(app).get('/activity?limit=100').set(auth(managerA));
    expect(res.status).toBe(200);
    const cancelled = res.body.data.find((e) => e.entityId === 'shift-x');
    expect(cancelled).toMatchObject({
      action: 'Shift cancelled',
      type: 'shift_cancelled',
      actor: { id: managerA.id, name: managerA.name },
      description: `${managerA.name} cancelled a shift`,
    });
    const actions = res.body.data.map((e) => e.title);
    expect(actions.join(' ')).not.toMatch(/DBS|RTW|RESIDENTS/);
  });

  test('a failed audit write is counted, not silently dropped', async () => {
    const metrics = require('../src/lib/metrics');
    const { createAuditLog } = require('../src/services/auditService');
    const before = metrics.snapshot().auditWriteFailures;
    await createAuditLog({ agencyId: 'agency-that-does-not-exist', action: 'X', entityType: 'X', entityId: 'x' });
    expect(metrics.snapshot().auditWriteFailures).toBe(before + 1);
  });
});
