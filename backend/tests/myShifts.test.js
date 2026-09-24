process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-access-secret';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test-refresh-secret';
process.env.RATE_LIMIT_DISABLED = 'true';

// GET /shifts?mine=true — employee self-service "my shifts". The mobile
// attendance flow asks "what am I working / clocking into", which is a question
// about the EMPLOYEE, not their system role. The default GET /shifts stays
// role-scoped for administration (manager -> their houses, team leader -> their
// house, HR -> whole agency) and must not change.

const request = require('supertest');
const { PrismaClient } = require('@prisma/client');
const app = require('../src/app');
const { signAccess } = require('../src/utils/jwt');

const prisma = new PrismaClient();
// Release the app's shared client's pool when this file finishes — the whole
// suite shares one Postgres (see flexibleAttendance.test.js).
const appPrisma = require('../src/lib/prisma');
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const tokenFor = (u) => signAccess({ id: u.id, agencyId: u.agencyId, role: u.role, status: u.status, name: u.name, email: u.email });
const as = (u) => ({ get: (p) => request(app).get(p).set('Authorization', `Bearer ${tokenFor(u)}`) });

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

let agencyA, agencyB;
let houseA, locA, locB, houseB;
let worker, teamLeader, manager, hr, coworker, deactivated, hrB, workerB;
// shift ids by owner
const own = {};

async function mkUser(agencyId, role, tag, over = {}) {
  return prisma.user.create({
    data: { agencyId, role, name: `MS ${tag}`, email: `ms-${tag}-${suffix}@t.test`, passwordHash: 'x', ...over },
  });
}

let slot = 0;
async function mkShift(owner, kind, over = {}) {
  slot += 1;
  const start = Date.now() + slot * DAY; // its own day per shift
  const isFixed = kind === 'FIXED' || kind === 'FLEXIBLE';
  return prisma.shift.create({
    data: {
      agencyId: owner.agencyId,
      kind,
      houseId: isFixed ? null : (owner.agencyId === agencyA.id ? houseA.id : houseB.id),
      locationId: isFixed ? (owner.agencyId === agencyA.id ? locA.id : locB.id) : null,
      workerId: owner.id, createdById: owner.id,
      date: new Date(start), startTime: new Date(start), endTime: new Date(start + 8 * HOUR),
      status: 'SCHEDULED', ...over,
    },
  });
}

const idsOf = (res) => res.body.data.map((s) => s.id).sort();
const sorted = (...ids) => ids.flat().sort();

beforeAll(async () => {
  agencyA = await prisma.agency.create({ data: { name: `MS A ${suffix}` } });
  agencyB = await prisma.agency.create({ data: { name: `MS B ${suffix}` } });

  worker = await mkUser(agencyA.id, 'WORKER', 'worker');
  teamLeader = await mkUser(agencyA.id, 'TEAM_LEADER', 'tl');
  manager = await mkUser(agencyA.id, 'MANAGER', 'mgr');
  hr = await mkUser(agencyA.id, 'HR', 'hr');
  coworker = await mkUser(agencyA.id, 'WORKER', 'coworker');
  deactivated = await mkUser(agencyA.id, 'MANAGER', 'dead', { status: 'DEACTIVATED' });
  hrB = await mkUser(agencyB.id, 'HR', 'hr-b');
  workerB = await mkUser(agencyB.id, 'WORKER', 'worker-b');

  houseA = await prisma.house.create({
    data: { agencyId: agencyA.id, name: `MS House ${suffix}`, address: '1 Test St', latitude: 51.5, longitude: -0.12, managerId: manager.id },
  });
  houseB = await prisma.house.create({
    data: { agencyId: agencyB.id, name: `MS House B ${suffix}`, address: '2 Test St', latitude: 51.5, longitude: -0.12 },
  });
  await prisma.houseTeamLeader.create({ data: { houseId: houseA.id, teamLeaderId: teamLeader.id } });
  locA = await prisma.location.create({ data: { agencyId: agencyA.id, name: `MS Office ${suffix}`, type: 'OFFICE', latitude: 51.5, longitude: -0.12, active: true } });
  locB = await prisma.location.create({ data: { agencyId: agencyB.id, name: `MS Office B ${suffix}`, type: 'OFFICE', latitude: 51.5, longitude: -0.12, active: true } });

  // Each employee has their own scheduled shift(s). Agency A's coworker has a
  // ROTA shift at the house the manager manages and the team leader runs.
  own.worker = [(await mkShift(worker, 'ROTA')).id];
  own.teamLeader = [(await mkShift(teamLeader, 'ROTA')).id];
  own.manager = [(await mkShift(manager, 'FIXED')).id, (await mkShift(manager, 'ROTA')).id];
  own.hr = [(await mkShift(hr, 'FIXED')).id];
  own.coworker = [(await mkShift(coworker, 'ROTA')).id];
  own.hrB = [(await mkShift(hrB, 'FIXED')).id];
  own.workerB = [(await mkShift(workerB, 'ROTA')).id];

  // FLEXIBLE attendance sessions (created by clock-in, not scheduled): one
  // completed, one still open (endTime null) — for the HR employee.
  const past = Date.now() - 3 * DAY;
  own.hrFlexDone = (await prisma.shift.create({
    data: {
      agencyId: agencyA.id, kind: 'FLEXIBLE', locationId: locA.id, houseId: null, workerId: hr.id, createdById: hr.id,
      date: new Date(past), startTime: new Date(past), endTime: new Date(past + 4 * HOUR), status: 'COMPLETED',
    },
  })).id;
  own.hrFlexOpen = (await prisma.shift.create({
    data: {
      agencyId: agencyA.id, kind: 'FLEXIBLE', locationId: locA.id, houseId: null, workerId: hr.id, createdById: hr.id,
      date: new Date(), startTime: new Date(Date.now() - HOUR), endTime: null, status: 'IN_PROGRESS',
    },
  })).id;
});

afterAll(async () => {
  const agencyIds = [agencyA.id, agencyB.id];
  await prisma.timesheet.deleteMany({ where: { agencyId: { in: agencyIds } } });
  await prisma.shift.deleteMany({ where: { agencyId: { in: agencyIds } } });
  await prisma.houseTeamLeader.deleteMany({ where: { houseId: { in: [houseA.id, houseB.id] } } });
  await prisma.location.deleteMany({ where: { agencyId: { in: agencyIds } } });
  await prisma.house.deleteMany({ where: { agencyId: { in: agencyIds } } });
  await prisma.user.deleteMany({ where: { agencyId: { in: agencyIds } } });
  await prisma.agency.deleteMany({ where: { id: { in: agencyIds } } });
  await prisma.$disconnect();
  await appPrisma.$disconnect();
});

describe('GET /shifts?mine=true — every system role gets only their own shifts', () => {
  test('1. WORKER', async () => {
    const res = await as(worker).get('/shifts?mine=true');
    expect(res.status).toBe(200);
    expect(idsOf(res)).toEqual(sorted(own.worker));
  });

  test('2. TEAM_LEADER (not the house\'s shifts)', async () => {
    const res = await as(teamLeader).get('/shifts?mine=true');
    expect(res.status).toBe(200);
    expect(idsOf(res)).toEqual(sorted(own.teamLeader));
    expect(idsOf(res)).not.toContain(own.coworker[0]);
  });

  test('3. MANAGER (own ROTA + own FIXED, not the managed house\'s shifts)', async () => {
    const res = await as(manager).get('/shifts?mine=true');
    expect(res.status).toBe(200);
    expect(idsOf(res)).toEqual(sorted(own.manager));
    expect(idsOf(res)).not.toContain(own.coworker[0]);
  });

  test('4. HR (not the whole agency)', async () => {
    const res = await as(hr).get('/shifts?mine=true');
    expect(res.status).toBe(200);
    expect(idsOf(res)).toEqual(sorted(own.hr));
    expect(res.body.data.every((s) => s.workerId === hr.id)).toBe(true);
  });
});

describe('ownership comes from authentication only', () => {
  test('5-7. HR / MANAGER / TEAM_LEADER cannot select another employee via workerId or houseId', async () => {
    for (const u of [hr, manager, teamLeader]) {
      const own_ = { hr: own.hr, manager: own.manager, teamLeader: own.teamLeader }[u === hr ? 'hr' : u === manager ? 'manager' : 'teamLeader'];
      const byWorker = await as(u).get(`/shifts?mine=true&workerId=${coworker.id}`);
      expect(byWorker.status).toBe(200);
      expect(idsOf(byWorker)).toEqual(sorted(own_));

      const byHouse = await as(u).get(`/shifts?mine=true&houseId=${houseA.id}`);
      expect(byHouse.status).toBe(200);
      expect(idsOf(byHouse)).toEqual(sorted(own_));
      expect(idsOf(byHouse)).not.toContain(own.coworker[0]);
    }
  });

  test('8. another agency\'s shifts are never returned — even when its ids are requested', async () => {
    const asHr = await as(hr).get(`/shifts?mine=true&workerId=${workerB.id}&houseId=${houseB.id}`);
    expect(idsOf(asHr)).toEqual(sorted(own.hr));
    expect(idsOf(asHr)).not.toContain(own.workerB[0]);
    expect(idsOf(asHr)).not.toContain(own.hrB[0]);

    const asHrB = await as(hrB).get('/shifts?mine=true');
    expect(idsOf(asHrB)).toEqual(sorted(own.hrB));
    const spoof = await as(hrB).get(`/shifts?mine=true&workerId=${worker.id}`);
    expect(idsOf(spoof)).toEqual(sorted(own.hrB));
  });

  test('a non-boolean mine value is rejected rather than guessed at', async () => {
    const res = await as(hr).get('/shifts?mine=yes');
    expect(res.status).toBe(400);
  });

  test('date and status filters still narrow the caller\'s own shifts', async () => {
    const from = new Date(Date.now() - DAY).toISOString();
    const to = new Date(Date.now() + 1.5 * DAY).toISOString();
    const res = await as(manager).get(`/shifts?mine=true&startDate=${from}&endDate=${to}`);
    expect(res.status).toBe(200);
    expect(res.body.data.every((s) => s.workerId === manager.id)).toBe(true);
    const none = await as(manager).get('/shifts?mine=true&status=COMPLETED');
    expect(none.body.data).toEqual([]);
  });
});

describe('shift kinds', () => {
  test('9. an own ROTA shift is returned (with its house)', async () => {
    const res = await as(manager).get('/shifts?mine=true');
    const rota = res.body.data.find((s) => s.kind === 'ROTA');
    expect(rota).toMatchObject({ id: own.manager[1], houseId: houseA.id, locationId: null });
    expect(rota.house).toMatchObject({ id: houseA.id });
  });

  test('10. an own FIXED shift is returned (with its location)', async () => {
    const res = await as(hr).get('/shifts?mine=true');
    const fixed = res.body.data[0];
    expect(fixed).toMatchObject({ id: own.hr[0], kind: 'FIXED', houseId: null, locationId: locA.id });
    expect(fixed.location).toMatchObject({ id: locA.id });
  });

  test('11. FLEXIBLE attendance sessions (completed or open) never appear in the scheduled list', async () => {
    const res = await as(hr).get('/shifts?mine=true');
    const ids = idsOf(res);
    expect(ids).not.toContain(own.hrFlexDone);
    expect(ids).not.toContain(own.hrFlexOpen);
    expect(res.body.data.every((s) => s.kind !== 'FLEXIBLE')).toBe(true);

    // ...but they still exist and are still reachable for history/timesheets.
    expect(await prisma.shift.count({ where: { id: { in: [own.hrFlexDone, own.hrFlexOpen] } } })).toBe(2);
    const direct = await as(hr).get(`/shifts/${own.hrFlexDone}`);
    expect(direct.status).toBe(200);
  });
});

describe('12. the existing role-scoped GET /shifts is unchanged', () => {
  test('WORKER without mine still gets their own shifts', async () => {
    expect(idsOf(await as(worker).get('/shifts'))).toEqual(sorted(own.worker));
  });

  test('MANAGER without mine still gets the shifts of the houses they manage (co-worker\'s included)', async () => {
    const ids = idsOf(await as(manager).get('/shifts'));
    expect(ids).toContain(own.coworker[0]);
    expect(ids).toContain(own.manager[1]); // their own ROTA shift at that house
    expect(ids).not.toContain(own.manager[0]); // their own FIXED shift has no house -> not in the house-scoped list
    expect(ids).not.toContain(own.workerB[0]); // never another agency
  });

  test('TEAM_LEADER without mine still gets their house\'s shifts', async () => {
    const ids = idsOf(await as(teamLeader).get('/shifts'));
    expect(ids).toEqual(expect.arrayContaining([own.teamLeader[0], own.coworker[0], own.worker[0]]));
    expect(ids).not.toContain(own.workerB[0]);
  });

  test('HR without mine still gets every scheduled shift of the agency, and none of another', async () => {
    const ids = idsOf(await as(hr).get('/shifts'));
    expect(ids).toEqual(expect.arrayContaining([...own.worker, ...own.teamLeader, ...own.manager, ...own.hr, ...own.coworker]));
    expect(ids).not.toContain(own.hrB[0]);
    expect(ids).not.toContain(own.workerB[0]);
    // FLEXIBLE sessions were already kept off the schedule listings.
    expect(ids).not.toContain(own.hrFlexDone);
  });

  test('HR with an explicit workerId filter (admin use) still works, and mine=false is the default', async () => {
    const byWorker = await as(hr).get(`/shifts?workerId=${coworker.id}`);
    expect(idsOf(byWorker)).toEqual(sorted(own.coworker));
    const explicitFalse = await as(hr).get(`/shifts?mine=false&workerId=${coworker.id}`);
    expect(idsOf(explicitFalse)).toEqual(sorted(own.coworker));
  });
});

describe('authentication', () => {
  test('13. unauthenticated requests are rejected', async () => {
    const res = await request(app).get('/shifts?mine=true');
    expect(res.status).toBe(401);
  });

  test('14. a deactivated user is rejected', async () => {
    const res = await as(deactivated).get('/shifts?mine=true');
    expect(res.status).toBe(401);
  });
});
