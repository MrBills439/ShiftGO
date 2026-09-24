process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-access-secret';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test-refresh-secret';
process.env.RATE_LIMIT_DISABLED = 'true';

// FLEXIBLE Staff Attendance V1 (foundation) — Shift.endTime is now nullable at
// the DB layer so a future FLEXIBLE clock-in can materialise an open-ended
// shift. This file proves the migration is purely additive:
//   - the DB itself accepts endTime = null (nothing enforces NOT NULL anymore)
//   - the ROTA/FIXED API surface still REQUIRES endTime — that was always an
//     application-layer validators.createShift/updateShift rule, never
//     relaxed by this column change
//   - FLEXIBLE shift creation is still rejected outright (unchanged from
//     Location-Backed Shift V1 — see locationBackedShift.test.js #10)
//   - every job/calculation that reads shift.endTime (missedClockInJob,
//     attendanceJob, weekly scheduled hours, overlap detection) still only
//     ever sees ROTA/FIXED rows, which always have a real endTime
//   - existing clock-in/clock-out is unaffected
//
// Recurring FIXED generation and cover/swap are deliberately NOT re-tested
// here — fixedWorkPatternGeneration.test.js and shiftChange.test.js already
// cover them and run unchanged as part of the same `npx jest --runInBand`
// pass; duplicating them here would just be redundant coverage of the same
// endTime-producing code paths, which this migration does not touch.

const request = require('supertest');
const { PrismaClient } = require('@prisma/client');
const app = require('../src/app');
const { signAccess } = require('../src/utils/jwt');
const { missedClockInJob } = require('../src/jobs/missedClockInJob');
const { attendanceJob } = require('../src/jobs/attendanceJob');
const { weeklyScheduledHours } = require('../src/services/staffAllocationService');

const prisma = new PrismaClient();
// The app's own shared client (src/lib/prisma) is never disconnected by the app;
// release its pool here so this file doesn't hold connections for the rest of
// the run (the suite shares one Postgres with a fixed connection cap).
const appPrisma = require('../src/lib/prisma');
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const tokenFor = (u) => signAccess({ id: u.id, agencyId: u.agencyId, role: u.role, status: u.status, name: u.name, email: u.email });
const as = (u) => ({
  get: (p) => request(app).get(p).set('Authorization', `Bearer ${tokenFor(u)}`),
  post: (p, b) => request(app).post(p).set('Authorization', `Bearer ${tokenFor(u)}`).send(b || {}),
});

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const LAT = 51.5;
const LNG = -0.12;

let agencyA, managerA, workerA1, workerA2, houseA, locationA;
const createdShiftIds = [];

function iso(ms) { return new Date(ms).toISOString(); }

let dayCounter = 0;
function shiftBody(over = {}) {
  dayCounter += 1;
  const start = Date.now() + (20 + dayCounter) * DAY;
  return {
    workerId: workerA1.id,
    date: iso(start), startTime: iso(start), endTime: iso(start + 8 * HOUR),
    ...over,
  };
}

beforeAll(async () => {
  agencyA = await prisma.agency.create({ data: { name: `FSE A ${suffix}` } });
  managerA = await prisma.user.create({
    data: { agencyId: agencyA.id, role: 'MANAGER', name: 'FSE Mgr', email: `fse-mgr-${suffix}@t.test`, passwordHash: 'x' },
  });
  workerA1 = await prisma.user.create({
    data: { agencyId: agencyA.id, role: 'WORKER', name: 'FSE Wkr1', email: `fse-wkr1-${suffix}@t.test`, passwordHash: 'x' },
  });
  workerA2 = await prisma.user.create({
    data: { agencyId: agencyA.id, role: 'WORKER', name: 'FSE Wkr2', email: `fse-wkr2-${suffix}@t.test`, passwordHash: 'x' },
  });
  houseA = await prisma.house.create({
    data: {
      agencyId: agencyA.id, name: `FSE House ${suffix}`, address: '1 Test St',
      latitude: LAT, longitude: LNG, geofenceRadius: 50, managerId: managerA.id,
    },
  });
  locationA = await prisma.location.create({
    data: {
      agencyId: agencyA.id, name: `FSE Office ${suffix}`, type: 'OFFICE',
      latitude: LAT, longitude: LNG, geofenceRadius: 50, active: true,
    },
  });
});

afterAll(async () => {
  await prisma.notification.deleteMany({ where: { agencyId: agencyA.id } });
  await prisma.auditLog.deleteMany({ where: { agencyId: agencyA.id } });
  await prisma.timesheet.deleteMany({ where: { agencyId: agencyA.id } });
  await prisma.attendanceMonitor.deleteMany({ where: { agencyId: agencyA.id } });
  await prisma.clockEvent.deleteMany({ where: { agencyId: agencyA.id } });
  await prisma.shift.deleteMany({ where: { agencyId: agencyA.id } });
  await prisma.location.deleteMany({ where: { agencyId: agencyA.id } });
  await prisma.house.deleteMany({ where: { agencyId: agencyA.id } });
  await prisma.user.deleteMany({ where: { agencyId: agencyA.id } });
  await prisma.agency.deleteMany({ where: { id: agencyA.id } });
  await prisma.$disconnect();
  await appPrisma.$disconnect();
});

describe('1. schema supports Shift.endTime = null', () => {
  test('a raw Prisma write with endTime: null succeeds (DB no longer enforces NOT NULL)', async () => {
    const now = Date.now();
    const shift = await prisma.shift.create({
      data: {
        agencyId: agencyA.id, kind: 'FLEXIBLE', locationId: locationA.id, houseId: null,
        workerId: workerA1.id, createdById: managerA.id, status: 'IN_PROGRESS',
        date: new Date(now), startTime: new Date(now), endTime: null,
      },
    });
    createdShiftIds.push(shift.id);
    expect(shift.endTime).toBeNull();

    const closed = await prisma.shift.update({ where: { id: shift.id }, data: { endTime: new Date(now + HOUR), status: 'COMPLETED' } });
    expect(closed.endTime).not.toBeNull();
  });
});

describe('2-5. ROTA/FIXED API endTime requirement is unchanged (application layer, not DB)', () => {
  test('2. ROTA creation without endTime is still rejected', async () => {
    const body = shiftBody({ houseId: houseA.id });
    delete body.endTime;
    const res = await as(managerA).post('/shifts', body);
    // Caught by validators.createShift's `.notEmpty()` on endTime, before the
    // request ever reaches the controller/service — same validator as before,
    // untouched by this migration.
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.fields.endTime).toMatch(/end time/i);
  });

  test('3. FIXED creation without endTime is still rejected', async () => {
    const body = shiftBody({ kind: 'FIXED', locationId: locationA.id });
    delete body.endTime;
    const res = await as(managerA).post('/shifts', body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.fields.endTime).toMatch(/end time/i);
  });

  test('4. valid ROTA creation still works and endTime is stored', async () => {
    const res = await as(managerA).post('/shifts', shiftBody({ houseId: houseA.id }));
    expect(res.status).toBe(201);
    expect(res.body.data.endTime).toBeTruthy();
    createdShiftIds.push(res.body.data.id);
  });

  test('5. valid FIXED creation still works and endTime is stored', async () => {
    const res = await as(managerA).post('/shifts', shiftBody({ kind: 'FIXED', locationId: locationA.id }));
    expect(res.status).toBe(201);
    expect(res.body.data.endTime).toBeTruthy();
    createdShiftIds.push(res.body.data.id);
  });

  test('FLEXIBLE creation via the API is still rejected outright (unchanged from Location-Backed Shift V1)', async () => {
    const res = await as(managerA).post('/shifts', shiftBody({ kind: 'FLEXIBLE', locationId: locationA.id }));
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('FLEXIBLE_NOT_SUPPORTED');
  });
});

describe('6-7. overlap detection unchanged', () => {
  test('6. ROTA overlap is still rejected', async () => {
    const start = Date.now() + 40 * DAY;
    const first = await as(managerA).post('/shifts', {
      workerId: workerA2.id, houseId: houseA.id,
      date: iso(start), startTime: iso(start), endTime: iso(start + 8 * HOUR),
    });
    expect(first.status).toBe(201);
    createdShiftIds.push(first.body.data.id);

    const overlap = await as(managerA).post('/shifts', {
      workerId: workerA2.id, houseId: houseA.id,
      date: iso(start), startTime: iso(start + HOUR), endTime: iso(start + 4 * HOUR),
    });
    expect(overlap.status).toBe(409);
  });

  test('7. FIXED overlap is still rejected', async () => {
    const start = Date.now() + 41 * DAY;
    const first = await as(managerA).post('/shifts', {
      workerId: workerA2.id, kind: 'FIXED', locationId: locationA.id,
      date: iso(start), startTime: iso(start), endTime: iso(start + 8 * HOUR),
    });
    expect(first.status).toBe(201);
    createdShiftIds.push(first.body.data.id);

    const overlap = await as(managerA).post('/shifts', {
      workerId: workerA2.id, kind: 'FIXED', locationId: locationA.id,
      date: iso(start), startTime: iso(start + HOUR), endTime: iso(start + 4 * HOUR),
    });
    expect(overlap.status).toBe(409);
  });
});

describe('8. scheduled weekly-hours behaviour unchanged', () => {
  test('a FIXED shift still counts toward weekly scheduled hours via the shared hours engine', async () => {
    const monday = Date.UTC(2026, 8, 21, 9, 0, 0); // a Monday clear of other fixtures
    const create = await as(managerA).post('/shifts', {
      workerId: workerA1.id, kind: 'FIXED', locationId: locationA.id,
      date: iso(monday), startTime: iso(monday), endTime: iso(monday + 8 * HOUR),
    });
    expect(create.status).toBe(201);
    createdShiftIds.push(create.body.data.id);

    const hrs = await weeklyScheduledHours(workerA1.id, agencyA.id, new Date(Date.UTC(2026, 8, 21)), new Date(Date.UTC(2026, 8, 28)));
    expect(hrs).toBe(8);
  });
});

describe('9. missedClockInJob remains ROTA/FIXED only', () => {
  test('a FLEXIBLE shift (endTime null, no clock-in) is never alerted', async () => {
    const now = Date.now();
    const tenMinsAgo = now - 10 * 60_000;
    const flexShift = await prisma.shift.create({
      data: {
        agencyId: agencyA.id, kind: 'FLEXIBLE', locationId: locationA.id, houseId: null,
        workerId: workerA1.id, createdById: managerA.id, status: 'IN_PROGRESS',
        date: new Date(tenMinsAgo), startTime: new Date(tenMinsAgo), endTime: null,
      },
    });
    createdShiftIds.push(flexShift.id);

    await missedClockInJob();

    const alerts = await prisma.notification.findMany({
      where: { type: 'MISSED_CLOCK_IN', userId: workerA1.id },
    });
    expect(alerts.some((n) => n.data && n.data.shiftId === flexShift.id)).toBe(false);
  });
});

describe('10. attendanceJob scheduled-end logic remains ROTA/FIXED only', () => {
  test('an open AttendanceMonitor on a FLEXIBLE (endTime null) shift is never touched', async () => {
    const now = Date.now();
    const flexShift = await prisma.shift.create({
      data: {
        agencyId: agencyA.id, kind: 'FLEXIBLE', locationId: locationA.id, houseId: null,
        workerId: workerA1.id, createdById: managerA.id, status: 'IN_PROGRESS',
        date: new Date(now), startTime: new Date(now - HOUR), endTime: null,
      },
    });
    createdShiftIds.push(flexShift.id);
    const monitor = await prisma.attendanceMonitor.create({
      data: {
        agencyId: agencyA.id, shiftId: flexShift.id, workerId: workerA1.id, locationId: locationA.id,
        locationStatus: 'ONSITE', lastLatitude: LAT, lastLongitude: LNG, lastReadingAt: new Date(now),
      },
    });

    // Would throw on `shift.endTime.getTime()` if the query ever stopped
    // excluding FLEXIBLE — proving both the exclusion and endTime-null safety.
    await expect(attendanceJob(new Date(now))).resolves.not.toThrow();

    const after = await prisma.attendanceMonitor.findUnique({ where: { id: monitor.id } });
    expect(after.closedAt).toBeNull();
    expect(after.shiftEndPromptedAt).toBeNull();
  });
});

describe('13-14. existing clock-in / clock-out unaffected', () => {
  test('13. a ROTA shift still clocks in exactly as before', async () => {
    const now = Date.now();
    const shift = await prisma.shift.create({
      data: {
        agencyId: agencyA.id, houseId: houseA.id, kind: 'ROTA', workerId: workerA1.id, createdById: managerA.id,
        date: new Date(now), startTime: new Date(now - HOUR), endTime: new Date(now + HOUR), status: 'SCHEDULED',
      },
    });
    createdShiftIds.push(shift.id);

    const res = await as(workerA1).post('/clock/in', {
      houseId: houseA.id, shiftId: shift.id, latitude: LAT, longitude: LNG, accuracy: 10,
    });
    expect(res.status).toBe(200);
    expect(await prisma.clockEvent.count({ where: { shiftId: shift.id, type: 'IN' } })).toBe(1);
  });

  test('14. a ROTA shift still clocks out exactly as before', async () => {
    const now = Date.now();
    const shift = await prisma.shift.create({
      data: {
        agencyId: agencyA.id, houseId: houseA.id, kind: 'ROTA', workerId: workerA1.id, createdById: managerA.id,
        date: new Date(now), startTime: new Date(now - HOUR), endTime: new Date(now + HOUR), status: 'SCHEDULED',
      },
    });
    createdShiftIds.push(shift.id);

    const inRes = await as(workerA1).post('/clock/in', {
      houseId: houseA.id, shiftId: shift.id, latitude: LAT, longitude: LNG, accuracy: 10,
    });
    expect(inRes.status).toBe(200);
    const outRes = await as(workerA1).post('/clock/out', {
      houseId: houseA.id, shiftId: shift.id, latitude: LAT, longitude: LNG, accuracy: 10,
    });
    expect(outRes.status).toBe(200);
    const ts = await prisma.timesheet.findUnique({ where: { shiftId: shift.id } });
    expect(ts.clockOutAt).toBeTruthy();
    expect(ts.totalHours).toBeGreaterThan(0);
  });
});
