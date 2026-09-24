process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-access-secret';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test-refresh-secret';
process.env.RATE_LIMIT_DISABLED = 'true';

// Whole-workforce attendance access. System role (WORKER / TEAM_LEADER /
// MANAGER / HR) is a permission concept; workPatternType (ROTA / FIXED /
// FLEXIBLE) is the attendance model. Every /clock route is employee
// SELF-SERVICE, so any ACTIVE employee may record their OWN attendance whatever
// their role — while ownership (workerId = the authenticated user), tenancy
// (agency) and FLEXIBLE eligibility (User.workPatternType from the database)
// keep it from ever acting on someone else's attendance.

const request = require('supertest');
const { PrismaClient } = require('@prisma/client');
const app = require('../src/app');
const { signAccess } = require('../src/utils/jwt');

const prisma = new PrismaClient();
// Release the app's shared client's pool when this file finishes (see
// flexibleAttendance.test.js) — the whole suite shares one Postgres.
const appPrisma = require('../src/lib/prisma');
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const tokenFor = (u) => signAccess({ id: u.id, agencyId: u.agencyId, role: u.role, status: u.status, name: u.name, email: u.email });
const as = (u) => ({
  get: (p) => request(app).get(p).set('Authorization', `Bearer ${tokenFor(u)}`),
  post: (p, b) => request(app).post(p).set('Authorization', `Bearer ${tokenFor(u)}`).send(b || {}),
});

const HOUR = 3_600_000;
const LAT = 51.5;
const LNG = -0.12;
const OUTSIDE_LAT = 51.51;
const GPS = { latitude: LAT, longitude: LNG, accuracy: 10 };

let agencyA, agencyB;
let houseA, locA, locB;
// system role x work pattern — the two axes are independent
let worker, teamLeader, managerFixed, hrFixed, hrFlex, managerFlex, teamLeaderFlex, workerFlex, hrRota, deactivatedManager, hrB;

async function mkUser(agencyId, role, workPatternType, tag, over = {}) {
  return prisma.user.create({
    data: {
      agencyId, role, workPatternType, name: `WW ${tag}`, email: `ww-${tag}-${suffix}@t.test`, passwordHash: 'x', ...over,
    },
  });
}

// A shift owned by `owner`, open for clocking right now.
async function rotaShiftFor(owner) {
  const now = Date.now();
  return prisma.shift.create({
    data: {
      agencyId: owner.agencyId, houseId: houseA.id, kind: 'ROTA', workerId: owner.id, createdById: owner.id,
      date: new Date(now), startTime: new Date(now - HOUR), endTime: new Date(now + HOUR), status: 'SCHEDULED',
    },
  });
}
async function fixedShiftFor(owner) {
  const now = Date.now();
  return prisma.shift.create({
    data: {
      agencyId: owner.agencyId, locationId: locA.id, houseId: null, kind: 'FIXED', workerId: owner.id, createdById: owner.id,
      date: new Date(now), startTime: new Date(now - HOUR), endTime: new Date(now + HOUR), status: 'SCHEDULED',
    },
  });
}

// Full in -> out cycle for `user` on `shift` through the self-service routes.
async function clockCycle(user, shift, body) {
  const inRes = await as(user).post('/clock/in', { shiftId: shift.id, ...body, ...GPS });
  expect(inRes.status).toBe(200);
  const outRes = await as(user).post('/clock/out', { shiftId: shift.id, ...body, ...GPS });
  expect(outRes.status).toBe(200);
  const after = await prisma.shift.findUnique({ where: { id: shift.id } });
  expect(after.status).toBe('COMPLETED');
  const ts = await prisma.timesheet.findUnique({ where: { shiftId: shift.id } });
  expect(ts).toMatchObject({ workerId: user.id });
  expect(ts.clockInAt).toBeTruthy();
  expect(ts.clockOutAt).toBeTruthy();
}

// Flexible start -> clock-out for `user`.
async function flexibleCycle(user, locationId = locA.id) {
  const inRes = await as(user).post('/clock/in', { locationId, ...GPS });
  expect(inRes.status).toBe(200);
  const { shiftId } = inRes.body.data;
  const shift = await prisma.shift.findUnique({ where: { id: shiftId } });
  expect(shift).toMatchObject({ kind: 'FLEXIBLE', workerId: user.id, locationId, houseId: null, endTime: null, agencyId: user.agencyId });
  const outRes = await as(user).post('/clock/out', { shiftId, ...GPS });
  expect(outRes.status).toBe(200);
  const done = await prisma.shift.findUnique({ where: { id: shiftId } });
  expect(done).toMatchObject({ status: 'COMPLETED' });
  expect(done.endTime).toBeTruthy();
}

beforeAll(async () => {
  agencyA = await prisma.agency.create({ data: { name: `WW A ${suffix}` } });
  agencyB = await prisma.agency.create({ data: { name: `WW B ${suffix}` } });

  worker = await mkUser(agencyA.id, 'WORKER', 'ROTA', 'worker');
  teamLeader = await mkUser(agencyA.id, 'TEAM_LEADER', 'ROTA', 'tl');
  managerFixed = await mkUser(agencyA.id, 'MANAGER', 'FIXED', 'mgr-fixed');
  hrFixed = await mkUser(agencyA.id, 'HR', 'FIXED', 'hr-fixed');
  hrFlex = await mkUser(agencyA.id, 'HR', 'FLEXIBLE', 'hr-flex');
  managerFlex = await mkUser(agencyA.id, 'MANAGER', 'FLEXIBLE', 'mgr-flex');
  teamLeaderFlex = await mkUser(agencyA.id, 'TEAM_LEADER', 'FLEXIBLE', 'tl-flex');
  workerFlex = await mkUser(agencyA.id, 'WORKER', 'FLEXIBLE', 'worker-flex');
  hrRota = await mkUser(agencyA.id, 'HR', 'ROTA', 'hr-rota');
  deactivatedManager = await mkUser(agencyA.id, 'MANAGER', 'FLEXIBLE', 'mgr-dead', { status: 'DEACTIVATED' });
  hrB = await mkUser(agencyB.id, 'HR', 'FLEXIBLE', 'hr-b');

  houseA = await prisma.house.create({
    data: {
      agencyId: agencyA.id, name: `WW House ${suffix}`, address: '1 Test St',
      latitude: LAT, longitude: LNG, geofenceRadius: 50, managerId: managerFixed.id,
    },
  });
  const loc = (agencyId, name) => prisma.location.create({
    data: { agencyId, name: `WW ${name} ${suffix}`, type: 'OFFICE', latitude: LAT, longitude: LNG, geofenceRadius: 50, active: true },
  });
  locA = await loc(agencyA.id, 'Head Office');
  locB = await loc(agencyB.id, 'Other Agency Office');
});

afterAll(async () => {
  const agencyIds = [agencyA.id, agencyB.id];
  await prisma.notification.deleteMany({ where: { agencyId: { in: agencyIds } } });
  await prisma.auditLog.deleteMany({ where: { agencyId: { in: agencyIds } } });
  await prisma.timesheet.deleteMany({ where: { agencyId: { in: agencyIds } } });
  await prisma.attendanceMonitor.deleteMany({ where: { agencyId: { in: agencyIds } } });
  await prisma.clockEvent.deleteMany({ where: { agencyId: { in: agencyIds } } });
  await prisma.shift.deleteMany({ where: { agencyId: { in: agencyIds } } });
  await prisma.location.deleteMany({ where: { agencyId: { in: agencyIds } } });
  await prisma.house.deleteMany({ where: { agencyId: { in: agencyIds } } });
  await prisma.user.deleteMany({ where: { agencyId: { in: agencyIds } } });
  await prisma.agency.deleteMany({ where: { id: { in: agencyIds } } });
  await prisma.$disconnect();
  await appPrisma.$disconnect();
});

describe('own scheduled attendance — any system role', () => {
  test('1. WORKER clocks in and out of their own ROTA shift', async () => {
    await clockCycle(worker, await rotaShiftFor(worker), { houseId: houseA.id });
  });

  test('2. TEAM_LEADER clocks in and out of their own ROTA shift', async () => {
    await clockCycle(teamLeader, await rotaShiftFor(teamLeader), { houseId: houseA.id });
  });

  test('3. MANAGER clocks in and out of their own FIXED shift', async () => {
    await clockCycle(managerFixed, await fixedShiftFor(managerFixed), { locationId: locA.id });
  });

  test('4. HR clocks in and out of their own FIXED shift (geofence still enforced)', async () => {
    const shift = await fixedShiftFor(hrFixed);
    const outside = await as(hrFixed).post('/clock/in', { shiftId: shift.id, locationId: locA.id, ...GPS, latitude: OUTSIDE_LAT });
    expect(outside.status).toBe(422);
    expect(outside.body.code).toBe('OUTSIDE_GEOFENCE');
    await clockCycle(hrFixed, shift, { locationId: locA.id });
  });
});

describe('FLEXIBLE attendance is independent of system role', () => {
  test('5. HR + FLEXIBLE starts and ends a flexible session', async () => {
    await flexibleCycle(hrFlex);
  });
  test('6. MANAGER + FLEXIBLE starts and ends a flexible session', async () => {
    await flexibleCycle(managerFlex);
  });
  test('7. TEAM_LEADER + FLEXIBLE starts and ends a flexible session', async () => {
    await flexibleCycle(teamLeaderFlex);
  });
  test('8. WORKER + FLEXIBLE still works', async () => {
    await flexibleCycle(workerFlex);
  });

  test('role does not stand in for work pattern: an HR employee who is not FLEXIBLE cannot start one', async () => {
    for (const u of [hrRota, hrFixed, managerFixed, teamLeader, worker]) {
      const res = await as(u).post('/clock/in', { locationId: locA.id, ...GPS });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FLEXIBLE_NOT_ENABLED');
      expect(await prisma.shift.count({ where: { workerId: u.id, kind: 'FLEXIBLE' } })).toBe(0);
    }
  });

  test('a client-supplied kind / workPatternType cannot make a non-FLEXIBLE HR employee FLEXIBLE', async () => {
    const res = await as(hrRota).post('/clock/in', { locationId: locA.id, kind: 'FLEXIBLE', workPatternType: 'FLEXIBLE', role: 'WORKER', ...GPS });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FLEXIBLE_NOT_ENABLED');
  });

  test('13. the FLEXIBLE location stays agency-scoped for every role', async () => {
    for (const u of [hrFlex, managerFlex]) {
      const before = await prisma.shift.count({ where: { workerId: u.id, kind: 'FLEXIBLE' } });
      const res = await as(u).post('/clock/in', { locationId: locB.id, ...GPS });
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('LOCATION_NOT_AVAILABLE');
      expect(await prisma.shift.count({ where: { workerId: u.id, kind: 'FLEXIBLE' } })).toBe(before); // nothing created
    }
    // ...and the agency-B employee can use only their own agency's Location.
    const cross = await as(hrB).post('/clock/in', { locationId: locA.id, ...GPS });
    expect(cross.status).toBe(422);
    expect(cross.body.code).toBe('LOCATION_NOT_AVAILABLE');
    const own = await as(hrB).post('/clock/in', { locationId: locB.id, ...GPS });
    expect(own.status).toBe(200);
    const shift = await prisma.shift.findUnique({ where: { id: own.body.data.shiftId } });
    expect(shift.agencyId).toBe(agencyB.id);
    const out = await as(hrB).post('/clock/out', { shiftId: shift.id, ...GPS });
    expect(out.status).toBe(200);
  });
});

describe('ownership — a higher role gets no way to act on someone else\'s attendance', () => {
  let workerShift;
  let workerShiftIn;

  beforeAll(async () => {
    workerShift = await rotaShiftFor(worker);
    // The worker clocks themself in; everyone else below tries to interfere.
    workerShiftIn = await as(worker).post('/clock/in', { shiftId: workerShift.id, houseId: houseA.id, ...GPS });
    expect(workerShiftIn.status).toBe(200);
  });

  test('9. HR / MANAGER (incl. the house manager) / TEAM_LEADER cannot clock in another employee\'s shift', async () => {
    const other = await rotaShiftFor(teamLeader); // TEAM_LEADER's own, not yet clocked in
    for (const u of [hrFixed, hrFlex, managerFixed, managerFlex]) {
      const res = await as(u).post('/clock/in', { shiftId: other.id, ...GPS });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
    }
    expect(await prisma.clockEvent.count({ where: { shiftId: other.id } })).toBe(0);
    expect(await prisma.timesheet.count({ where: { shiftId: other.id } })).toBe(0);
    expect((await prisma.shift.findUnique({ where: { id: other.id } })).status).toBe('SCHEDULED');
  });

  test('10. HR / MANAGER cannot clock another employee out through the self-service route', async () => {
    for (const u of [hrFixed, managerFixed, teamLeader]) {
      const res = await as(u).post('/clock/out', { shiftId: workerShift.id, ...GPS });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
    }
    expect(await prisma.clockEvent.count({ where: { shiftId: workerShift.id, type: 'OUT' } })).toBe(0);
    const ts = await prisma.timesheet.findUnique({ where: { shiftId: workerShift.id } });
    expect(ts.clockOutAt).toBeNull();
    expect((await prisma.shift.findUnique({ where: { id: workerShift.id } })).status).toBe('IN_PROGRESS');
  });

  test('a claimed houseId/locationId cannot redirect the request onto another employee\'s shift', async () => {
    const res = await as(managerFixed).post('/clock/out', { shiftId: workerShift.id, houseId: houseA.id, ...GPS });
    expect(res.status).toBe(403);
  });

  test('11. a shift of another agency is rejected (and vice versa)', async () => {
    const res = await as(hrB).post('/clock/out', { shiftId: workerShift.id, ...GPS });
    expect(res.status).toBe(403);
    expect(await prisma.clockEvent.count({ where: { shiftId: workerShift.id, type: 'OUT' } })).toBe(0);
    const inRes = await as(hrB).post('/clock/in', { shiftId: workerShift.id, ...GPS });
    expect(inRes.status).toBe(403);
  });

  test('15. reporting a location for someone else\'s session is ignored — own-session only', async () => {
    const before = await prisma.attendanceMonitor.findUnique({ where: { shiftId: workerShift.id } });
    for (const u of [hrFixed, managerFixed, hrB]) {
      const res = await as(u).post('/clock/location', { shiftId: workerShift.id, latitude: OUTSIDE_LAT, longitude: LNG, accuracy: 10 });
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ active: false, reason: 'NOT_MONITORED' });
    }
    const after = await prisma.attendanceMonitor.findUnique({ where: { shiftId: workerShift.id } });
    expect(after.lastReadingAt.getTime()).toBe(before.lastReadingAt.getTime());
    expect(after.consecutiveOutsideCount).toBe(0);
    expect(after.locationStatus).toBe('ONSITE');
    // ...whereas the owner's own report is accepted.
    const own = await as(worker).post('/clock/location', { shiftId: workerShift.id, ...GPS });
    expect(own.body.data).toMatchObject({ active: true, accepted: true });
  });

  test('16. "still working" for someone else\'s session is ignored — own-session only', async () => {
    for (const u of [hrFixed, managerFixed, hrB]) {
      const res = await as(u).post('/clock/still-working', { shiftId: workerShift.id });
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ active: false, reason: 'NOT_MONITORED' });
    }
    expect((await prisma.attendanceMonitor.findUnique({ where: { shiftId: workerShift.id } })).stillWorkingConfirmedAt).toBeNull();
    const own = await as(worker).post('/clock/still-working', { shiftId: workerShift.id });
    expect(own.body.data.active).toBe(true);
    expect((await prisma.attendanceMonitor.findUnique({ where: { shiftId: workerShift.id } })).stillWorkingConfirmedAt).toBeTruthy();
  });

  test('clock state of someone else\'s shift reveals nothing', async () => {
    const other = await as(hrFixed).get(`/clock/state?shiftId=${workerShift.id}`);
    expect(other.status).toBe(200);
    expect(other.body.data).toMatchObject({ clockedIn: false, monitorActive: false, locationStatus: 'UNKNOWN' });
    const own = await as(worker).get(`/clock/state?shiftId=${workerShift.id}`);
    expect(own.body.data).toMatchObject({ clockedIn: true, monitorActive: true });
  });

  test('the owner can still clock themself out after all of that', async () => {
    const res = await as(worker).post('/clock/out', { shiftId: workerShift.id, houseId: houseA.id, ...GPS });
    expect(res.status).toBe(200);
  });
});

describe('14. active-session lookup is per authenticated employee', () => {
  test('each role sees only their own open FLEXIBLE session', async () => {
    const hrIn = await as(hrFlex).post('/clock/in', { locationId: locA.id, ...GPS });
    expect(hrIn.status).toBe(200);

    const mine = await as(hrFlex).get('/clock/active-session');
    expect(mine.status).toBe(200);
    expect(mine.body.data.session).toMatchObject({ shiftId: hrIn.body.data.shiftId, kind: 'FLEXIBLE' });

    for (const u of [managerFlex, teamLeaderFlex, workerFlex, managerFixed, hrB]) {
      const res = await as(u).get('/clock/active-session');
      expect(res.status).toBe(200);
      expect(res.body.data.session).toBeNull();
    }

    // One employee's open session doesn't block another's clock-in, and a
    // second start by the SAME employee is still refused.
    const mgrIn = await as(managerFlex).post('/clock/in', { locationId: locA.id, ...GPS });
    expect(mgrIn.status).toBe(200);
    const again = await as(hrFlex).post('/clock/in', { locationId: locA.id, ...GPS });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('ACTIVE_SESSION_EXISTS');

    // Another role cannot end the HR employee's flexible session.
    const hijack = await as(managerFlex).post('/clock/out', { shiftId: hrIn.body.data.shiftId, ...GPS });
    expect(hijack.status).toBe(403);
    expect((await prisma.shift.findUnique({ where: { id: hrIn.body.data.shiftId } })).status).toBe('IN_PROGRESS');

    expect((await as(hrFlex).post('/clock/out', { shiftId: hrIn.body.data.shiftId, ...GPS })).status).toBe(200);
    expect((await as(managerFlex).post('/clock/out', { shiftId: mgrIn.body.data.shiftId, ...GPS })).status).toBe(200);
  });
});

describe('12. inactive employees are rejected on every self-service route', () => {
  test('a deactivated MANAGER cannot use any /clock route', async () => {
    const someShift = await rotaShiftFor(worker);
    const calls = [
      as(deactivatedManager).post('/clock/in', { locationId: locA.id, ...GPS }),
      as(deactivatedManager).post('/clock/in', { shiftId: someShift.id, ...GPS }),
      as(deactivatedManager).post('/clock/out', { shiftId: someShift.id, ...GPS }),
      as(deactivatedManager).post('/clock/location', { shiftId: someShift.id, ...GPS }),
      as(deactivatedManager).post('/clock/still-working', { shiftId: someShift.id }),
      as(deactivatedManager).get(`/clock/state?shiftId=${someShift.id}`),
      as(deactivatedManager).get('/clock/active-session'),
    ];
    for (const res of await Promise.all(calls)) expect(res.status).toBe(401);
    expect(await prisma.shift.count({ where: { workerId: deactivatedManager.id } })).toBe(0);
  });

  test('unauthenticated requests are still rejected', async () => {
    expect((await request(app).post('/clock/in').send({ locationId: locA.id, ...GPS })).status).toBe(401);
    expect((await request(app).get('/clock/active-session')).status).toBe(401);
  });
});
