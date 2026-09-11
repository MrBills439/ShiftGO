process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-access-secret';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test-refresh-secret';
process.env.RATE_LIMIT_DISABLED = 'true';

// Location-Backed Shift V1 — a Shift can now target a House (ROTA) OR a
// Location (FIXED), never both, never neither. FLEXIBLE creation stays
// rejected. Care ROTA behaviour, clock-in, cover/swap, open shifts and
// missed-clock-in must all remain exactly as before.

const request = require('supertest');
const { PrismaClient } = require('@prisma/client');
const app = require('../src/app');
const { signAccess } = require('../src/utils/jwt');
const { missedClockInJob } = require('../src/jobs/missedClockInJob');
const { attendanceJob } = require('../src/jobs/attendanceJob');
const { weeklyScheduledHours } = require('../src/services/staffAllocationService');

const prisma = new PrismaClient();
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const tokenFor = (u) => signAccess({ id: u.id, agencyId: u.agencyId, role: u.role, status: u.status, name: u.name, email: u.email });
const as = (u) => ({
  get: (p) => request(app).get(p).set('Authorization', `Bearer ${tokenFor(u)}`),
  post: (p, b) => request(app).post(p).set('Authorization', `Bearer ${tokenFor(u)}`).send(b || {}),
  patch: (p, b) => request(app).patch(p).set('Authorization', `Bearer ${tokenFor(u)}`).send(b || {}),
});

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const LAT = 51.5;
const LNG = -0.12;

let agencyA, agencyB, managerA, workerA1, workerA2, houseA, houseA2, locationA, locationB;
const createdShiftIds = [];

function iso(ms) { return new Date(ms).toISOString(); }

// Every call gets its own day so shifts for the same worker (workerA1, unless
// overridden) never overlap across tests in this file.
let dayCounter = 0;
function shiftBody(over = {}) {
  dayCounter += 1;
  const start = Date.now() + (3 + dayCounter) * DAY;
  return {
    workerId: workerA1.id,
    date: iso(start), startTime: iso(start), endTime: iso(start + 8 * HOUR),
    ...over,
  };
}

beforeAll(async () => {
  agencyA = await prisma.agency.create({ data: { name: `LBS A ${suffix}` } });
  agencyB = await prisma.agency.create({ data: { name: `LBS B ${suffix}` } });

  managerA = await prisma.user.create({
    data: { agencyId: agencyA.id, role: 'MANAGER', name: 'LBS Mgr', email: `lbs-mgr-${suffix}@t.test`, passwordHash: 'x' },
  });
  workerA1 = await prisma.user.create({
    data: { agencyId: agencyA.id, role: 'WORKER', name: 'LBS Wkr1', email: `lbs-wkr1-${suffix}@t.test`, passwordHash: 'x' },
  });
  workerA2 = await prisma.user.create({
    data: { agencyId: agencyA.id, role: 'WORKER', name: 'LBS Wkr2', email: `lbs-wkr2-${suffix}@t.test`, passwordHash: 'x' },
  });
  houseA = await prisma.house.create({
    data: {
      agencyId: agencyA.id, name: `LBS House ${suffix}`, address: '1 Test St',
      latitude: LAT, longitude: LNG, geofenceRadius: 50, managerId: managerA.id,
    },
  });
  houseA2 = await prisma.house.create({
    data: {
      agencyId: agencyA.id, name: `LBS House 2 ${suffix}`, address: '3 Test St',
      latitude: LAT, longitude: LNG, geofenceRadius: 50, managerId: managerA.id,
    },
  });
  locationA = await prisma.location.create({
    data: { agencyId: agencyA.id, name: `LBS Office ${suffix}`, type: 'OFFICE', active: true },
  });
  locationB = await prisma.location.create({
    data: { agencyId: agencyB.id, name: `LBS Office B ${suffix}`, type: 'OFFICE', active: true },
  });
});

afterAll(async () => {
  await prisma.notification.deleteMany({ where: { agencyId: { in: [agencyA.id, agencyB.id] } } });
  await prisma.shiftChangeRequest.deleteMany({ where: { agencyId: agencyA.id } });
  await prisma.auditLog.deleteMany({ where: { agencyId: { in: [agencyA.id, agencyB.id] } } });
  await prisma.timesheet.deleteMany({ where: { agencyId: { in: [agencyA.id, agencyB.id] } } });
  await prisma.attendanceMonitor.deleteMany({ where: { agencyId: { in: [agencyA.id, agencyB.id] } } });
  await prisma.clockEvent.deleteMany({ where: { agencyId: { in: [agencyA.id, agencyB.id] } } });
  await prisma.shift.deleteMany({ where: { agencyId: { in: [agencyA.id, agencyB.id] } } });
  await prisma.location.deleteMany({ where: { agencyId: { in: [agencyA.id, agencyB.id] } } });
  await prisma.house.deleteMany({ where: { agencyId: { in: [agencyA.id, agencyB.id] } } });
  await prisma.user.deleteMany({ where: { agencyId: { in: [agencyA.id, agencyB.id] } } });
  await prisma.agency.deleteMany({ where: { id: { in: [agencyA.id, agencyB.id] } } });
  await prisma.$disconnect();
});

describe('POST /shifts — ROTA (House) target', () => {
  test('1. an existing ROTA House shift still creates successfully', async () => {
    const res = await as(managerA).post('/shifts', shiftBody({ houseId: houseA.id }));
    expect(res.status).toBe(201);
    expect(res.body.data.houseId).toBe(houseA.id);
    createdShiftIds.push(res.body.data.id);
  });

  test('2. an omitted kind defaults to ROTA', async () => {
    const res = await as(managerA).post('/shifts', shiftBody({ houseId: houseA.id }));
    expect(res.status).toBe(201);
    expect(res.body.data.kind).toBe('ROTA');
    expect(res.body.data.locationId).toBeNull();
    createdShiftIds.push(res.body.data.id);
  });

  test('3. ROTA without a houseId (and no locationId) is rejected', async () => {
    const res = await as(managerA).post('/shifts', shiftBody({ kind: 'ROTA' }));
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('SHIFT_TARGET_REQUIRED');
  });

  test('4. ROTA with a locationId instead of a houseId is rejected', async () => {
    const res = await as(managerA).post('/shifts', shiftBody({ kind: 'ROTA', locationId: locationA.id }));
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('ROTA_REQUIRES_HOUSE');
  });

  test('12. existing House tenant validation is unchanged — a cross-agency houseId is rejected', async () => {
    const houseB = await prisma.house.create({
      data: { agencyId: agencyB.id, name: `LBS Cross House ${suffix}`, address: '2 Test St', latitude: LAT, longitude: LNG },
    });
    const res = await as(managerA).post('/shifts', shiftBody({ houseId: houseB.id }));
    expect(res.status).toBe(403);
    expect(res.body.message).toBe('Worker and house must belong to your agency');
  });
});

describe('POST /shifts — FIXED (Location) target', () => {
  test('5. a FIXED Location shift creates successfully', async () => {
    const res = await as(managerA).post('/shifts', shiftBody({ kind: 'FIXED', locationId: locationA.id }));
    expect(res.status).toBe(201);
    expect(res.body.data.kind).toBe('FIXED');
    expect(res.body.data.locationId).toBe(locationA.id);
    expect(res.body.data.houseId).toBeNull();
    createdShiftIds.push(res.body.data.id);
  });

  test('6. FIXED without a locationId is rejected', async () => {
    const res = await as(managerA).post('/shifts', shiftBody({ kind: 'FIXED' }));
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('SHIFT_TARGET_REQUIRED');
  });

  test('7. FIXED with a houseId instead of a locationId is rejected', async () => {
    const res = await as(managerA).post('/shifts', shiftBody({ kind: 'FIXED', houseId: houseA.id }));
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('FIXED_REQUIRES_LOCATION');
  });

  test('8. both houseId and locationId together are rejected', async () => {
    const res = await as(managerA).post('/shifts', shiftBody({ kind: 'ROTA', houseId: houseA.id, locationId: locationA.id }));
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('SHIFT_TARGET_CONFLICT');
  });

  test('9. neither houseId nor locationId is rejected', async () => {
    const res = await as(managerA).post('/shifts', shiftBody({ kind: 'FIXED' }));
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('SHIFT_TARGET_REQUIRED');
  });

  test('10. FLEXIBLE creation is rejected with a clear error', async () => {
    const res = await as(managerA).post('/shifts', shiftBody({ kind: 'FLEXIBLE', locationId: locationA.id }));
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('FLEXIBLE_NOT_SUPPORTED');
  });

  test('11. a cross-agency Location is rejected', async () => {
    const res = await as(managerA).post('/shifts', shiftBody({ kind: 'FIXED', locationId: locationB.id }));
    expect(res.status).toBe(403);
    expect(res.body.message).toBe('Worker and location must belong to your agency');
  });

  test('13. a FIXED shift can be read normally', async () => {
    const create = await as(managerA).post('/shifts', shiftBody({ kind: 'FIXED', locationId: locationA.id }));
    expect(create.status).toBe(201);
    createdShiftIds.push(create.body.data.id);

    const res = await as(managerA).get(`/shifts/${create.body.data.id}`);
    expect(res.status).toBe(200);
    expect(res.body.data.kind).toBe('FIXED');
    expect(res.body.data.locationId).toBe(locationA.id);
    expect(res.body.data.location).toMatchObject({ id: locationA.id });
    expect(res.body.data.house).toBeNull();
  });

  test('14. a FIXED shift counts toward weekly scheduled hours', async () => {
    // A Monday well clear of other fixtures' shifts.
    const monday = Date.UTC(2026, 7, 3, 9, 0, 0); // 2026-08-03 09:00 UTC
    const create = await as(managerA).post('/shifts', {
      workerId: workerA2.id, kind: 'FIXED', locationId: locationA.id,
      date: iso(monday), startTime: iso(monday), endTime: iso(monday + 8 * HOUR),
    });
    expect(create.status).toBe(201);
    createdShiftIds.push(create.body.data.id);

    const weekRes = await as(managerA).get('/staff/allocation?week=2026-08-03');
    expect(weekRes.status).toBe(200);
    const row = weekRes.body.data.workers.find((w) => w.id === workerA2.id);
    expect(row).toBeTruthy();
    expect(row.scheduledHours).toBe(8);

    // Same thing, one level down — the shared hours engine itself.
    const hrs = await weeklyScheduledHours(workerA2.id, agencyA.id, new Date(Date.UTC(2026, 7, 3)), new Date(Date.UTC(2026, 7, 10)));
    expect(hrs).toBe(8);
  });

  test('15. open-shift creation remains ROTA only — a FIXED open shift is rejected', async () => {
    const start = Date.now() + 5 * DAY;
    const res = await as(managerA).post('/shifts', {
      status: 'OPEN', kind: 'FIXED', houseId: houseA.id,
      date: iso(start), startTime: iso(start), endTime: iso(start + 8 * HOUR),
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('OPEN_SHIFT_ROTA_ONLY');
  });
});

describe('care-only flows explicitly reject non-ROTA shifts', () => {
  test('16. claiming remains ROTA only — a FIXED shift force-opened at the DB layer cannot be claimed', async () => {
    const start = Date.now() + 6 * DAY;
    const fixedOpen = await prisma.shift.create({
      data: {
        agencyId: agencyA.id, kind: 'FIXED', locationId: locationA.id, houseId: null,
        createdById: managerA.id, status: 'OPEN', eligibleRoles: ['WORKER'],
        date: new Date(start), startTime: new Date(start), endTime: new Date(start + 8 * HOUR),
      },
    });
    createdShiftIds.push(fixedOpen.id);

    const res = await as(workerA1).post(`/shifts/${fixedOpen.id}/claim`);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('CLAIM_SHIFT_ROTA_ONLY');
  });

  test('17. cover requests remain ROTA only — requesting cover for a FIXED shift is rejected', async () => {
    const start = Date.now() + 7 * DAY;
    const fixedAssigned = await prisma.shift.create({
      data: {
        agencyId: agencyA.id, kind: 'FIXED', locationId: locationA.id, houseId: null,
        workerId: workerA1.id, createdById: managerA.id, status: 'SCHEDULED',
        date: new Date(start), startTime: new Date(start), endTime: new Date(start + 8 * HOUR),
      },
    });
    createdShiftIds.push(fixedAssigned.id);

    const res = await as(workerA1).post('/shift-change/cover', {
      shiftId: fixedAssigned.id, targetWorkerId: workerA2.id, reason: 'Cannot make it',
    });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('SHIFT_NOT_ROTA');
  });
});

describe('care clock-in behaviour is unchanged; a FIXED shift cannot be clocked', () => {
  test('18. a ROTA House shift still clocks in and out exactly as before', async () => {
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
    expect(await prisma.clockEvent.count({ where: { shiftId: shift.id } })).toBe(2);
  });

  // Superseded by Location-Backed Attendance Records V1: a FIXED shift CAN now
  // clock in (see tests/locationBackedAttendanceRecords.test.js) — what this
  // test actually proves is that a claimed houseId that disagrees with the
  // Shift's own (null, for a FIXED shift) is rejected as a target mismatch,
  // never silently accepted.
  test('19. a FIXED shift rejects a clock-in that claims the wrong (House) target', async () => {
    const now = Date.now();
    const fixedShift = await prisma.shift.create({
      data: {
        agencyId: agencyA.id, kind: 'FIXED', locationId: locationA.id, houseId: null,
        workerId: workerA1.id, createdById: managerA.id, status: 'SCHEDULED',
        date: new Date(now), startTime: new Date(now - HOUR), endTime: new Date(now + HOUR),
      },
    });
    createdShiftIds.push(fixedShift.id);

    const res = await as(workerA1).post('/clock/in', {
      houseId: houseA.id, shiftId: fixedShift.id, latitude: LAT, longitude: LNG, accuracy: 10,
    });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
    expect(await prisma.clockEvent.count({ where: { shiftId: fixedShift.id } })).toBe(0);
  });
});

// Superseded by Location-Backed Attendance Records V1: FIXED shifts can now
// clock in and be missed/monitored exactly like ROTA shifts — see
// tests/locationBackedAttendanceRecords.test.js for full coverage (items
// 21-26). These two tests are kept, updated to the new intended behaviour, so
// this file's own regression story stays self-contained.
describe('background jobs now also process FIXED shifts', () => {
  test('20. missedClockInJob alerts for a missed FIXED shift, same as a missed ROTA one', async () => {
    const startedAgo = Date.now() - 8 * 60 * 1000; // 8 minutes ago — inside the 5-15 min window
    const rota = await prisma.shift.create({
      data: {
        agencyId: agencyA.id, houseId: houseA.id, kind: 'ROTA', workerId: workerA1.id, createdById: managerA.id,
        date: new Date(startedAgo), startTime: new Date(startedAgo), endTime: new Date(startedAgo + 4 * HOUR), status: 'SCHEDULED',
      },
    });
    const fixed = await prisma.shift.create({
      data: {
        agencyId: agencyA.id, kind: 'FIXED', locationId: locationA.id, houseId: null,
        workerId: workerA2.id, createdById: managerA.id,
        date: new Date(startedAgo), startTime: new Date(startedAgo), endTime: new Date(startedAgo + 4 * HOUR), status: 'SCHEDULED',
      },
    });
    createdShiftIds.push(rota.id, fixed.id);

    await missedClockInJob();

    const rotaAlert = await prisma.notification.findFirst({ where: { type: 'MISSED_CLOCK_IN', userId: workerA1.id, data: { path: ['shiftId'], equals: rota.id } } });
    const fixedAlert = await prisma.notification.findFirst({ where: { type: 'MISSED_CLOCK_IN', userId: workerA2.id, data: { path: ['shiftId'], equals: fixed.id } } });
    expect(rotaAlert).toBeTruthy();
    expect(fixedAlert).toBeTruthy();
  });

  test('21. attendanceJob does process a monitor on a FIXED shift', async () => {
    const now = Date.now();
    const fixed = await prisma.shift.create({
      data: {
        agencyId: agencyA.id, kind: 'FIXED', locationId: locationA.id, houseId: null,
        workerId: workerA1.id, createdById: managerA.id, status: 'IN_PROGRESS',
        date: new Date(now), startTime: new Date(now - 2 * HOUR), endTime: new Date(now - HOUR),
      },
    });
    createdShiftIds.push(fixed.id);
    // A monitor for a FIXED shift is now reachable via the real clock-in path
    // (see the new suite) — created directly here to isolate the job's own
    // behaviour from clock-in.
    const monitor = await prisma.attendanceMonitor.create({
      data: {
        agencyId: agencyA.id, shiftId: fixed.id, workerId: workerA1.id, locationId: locationA.id,
        closedAt: null, shiftEndPromptedAt: null,
      },
    });

    await expect(attendanceJob(new Date(now))).resolves.not.toThrow();

    const fresh = await prisma.attendanceMonitor.findUnique({ where: { id: monitor.id } });
    expect(fresh.shiftEndPromptedAt).not.toBeNull(); // shift already ended — the job did prompt it
    await prisma.attendanceMonitor.delete({ where: { id: monitor.id } });
  });
});

describe('updateShift locks the attendance target once history exists', () => {
  // A ROTA shift, not clocked in — used for the "before attendance" case.
  async function mkRotaShift(over = {}) {
    const start = Date.now() + (10 + dayCounter++) * DAY;
    return prisma.shift.create({
      data: {
        agencyId: agencyA.id, houseId: houseA.id, kind: 'ROTA', workerId: workerA1.id, createdById: managerA.id,
        date: new Date(start), startTime: new Date(start), endTime: new Date(start + 8 * HOUR), status: 'SCHEDULED',
        ...over,
      },
    });
  }

  test('1. House A → House B works before any attendance/history exists', async () => {
    const shift = await mkRotaShift();
    createdShiftIds.push(shift.id);

    const res = await as(managerA).patch(`/shifts/${shift.id}`, { houseId: houseA2.id });
    expect(res.status).toBe(200);
    expect(res.body.data.houseId).toBe(houseA2.id);
  });

  test('2. House A → House B returns 409 SHIFT_ATTENDANCE_TARGET_LOCKED once a ClockEvent exists', async () => {
    const shift = await mkRotaShift();
    createdShiftIds.push(shift.id);
    await prisma.clockEvent.create({
      data: { agencyId: agencyA.id, workerId: workerA1.id, houseId: houseA.id, shiftId: shift.id, type: 'IN', method: 'MANUAL' },
    });

    const res = await as(managerA).patch(`/shifts/${shift.id}`, { houseId: houseA2.id });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('SHIFT_ATTENDANCE_TARGET_LOCKED');
    expect(res.body.message).toBe('Shift attendance target cannot be changed after attendance has been recorded');
    // Not mutated, not deleted.
    expect((await prisma.shift.findUnique({ where: { id: shift.id } })).houseId).toBe(houseA.id);
    expect(await prisma.clockEvent.count({ where: { shiftId: shift.id } })).toBe(1);
  });

  test('3. a target change returns 409 once an AttendanceMonitor exists', async () => {
    const shift = await mkRotaShift();
    createdShiftIds.push(shift.id);
    await prisma.attendanceMonitor.create({
      data: { agencyId: agencyA.id, shiftId: shift.id, workerId: workerA1.id, houseId: houseA.id },
    });

    const res = await as(managerA).patch(`/shifts/${shift.id}`, { houseId: houseA2.id });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('SHIFT_ATTENDANCE_TARGET_LOCKED');
    expect((await prisma.shift.findUnique({ where: { id: shift.id } })).houseId).toBe(houseA.id);
  });

  test('4. a target change returns 409 once a Timesheet exists', async () => {
    const shift = await mkRotaShift();
    createdShiftIds.push(shift.id);
    await prisma.timesheet.create({
      data: { agencyId: agencyA.id, workerId: workerA1.id, houseId: houseA.id, shiftId: shift.id },
    });

    const res = await as(managerA).patch(`/shifts/${shift.id}`, { houseId: houseA2.id });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('SHIFT_ATTENDANCE_TARGET_LOCKED');
    expect((await prisma.shift.findUnique({ where: { id: shift.id } })).houseId).toBe(houseA.id);
  });

  test('5. ROTA → FIXED returns 409 after attendance exists', async () => {
    const shift = await mkRotaShift();
    createdShiftIds.push(shift.id);
    await prisma.timesheet.create({
      data: { agencyId: agencyA.id, workerId: workerA1.id, houseId: houseA.id, shiftId: shift.id },
    });

    const res = await as(managerA).patch(`/shifts/${shift.id}`, { kind: 'FIXED', locationId: locationA.id });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('SHIFT_ATTENDANCE_TARGET_LOCKED');
    const fresh = await prisma.shift.findUnique({ where: { id: shift.id } });
    expect(fresh.kind).toBe('ROTA');
    expect(fresh.houseId).toBe(houseA.id);
    expect(fresh.locationId).toBeNull();
  });

  test('6. resending the exact existing houseId/kind after attendance exists is still allowed', async () => {
    const shift = await mkRotaShift();
    createdShiftIds.push(shift.id);
    await prisma.clockEvent.create({
      data: { agencyId: agencyA.id, workerId: workerA1.id, houseId: houseA.id, shiftId: shift.id, type: 'IN', method: 'MANUAL' },
    });

    const res = await as(managerA).patch(`/shifts/${shift.id}`, { houseId: houseA.id, kind: 'ROTA' });
    expect(res.status).toBe(200);
    expect(res.body.data.houseId).toBe(houseA.id);
  });

  test('7. an unrelated field update (urgent) remains allowed after attendance exists', async () => {
    const shift = await mkRotaShift();
    createdShiftIds.push(shift.id);
    await prisma.clockEvent.create({
      data: { agencyId: agencyA.id, workerId: workerA1.id, houseId: houseA.id, shiftId: shift.id, type: 'IN', method: 'MANUAL' },
    });

    const res = await as(managerA).patch(`/shifts/${shift.id}`, { urgent: true });
    expect(res.status).toBe(200);
    expect(res.body.data.urgent).toBe(true);
    expect(res.body.data.houseId).toBe(houseA.id);
  });

  test('a startTime-only change remains allowed after attendance exists', async () => {
    const shift = await mkRotaShift();
    createdShiftIds.push(shift.id);
    await prisma.timesheet.create({
      data: { agencyId: agencyA.id, workerId: workerA1.id, houseId: houseA.id, shiftId: shift.id },
    });

    const newStart = new Date(shift.startTime.getTime() + 30 * 60_000);
    const res = await as(managerA).patch(`/shifts/${shift.id}`, { startTime: newStart.toISOString() });
    expect(res.status).toBe(200);
    expect(new Date(res.body.data.startTime).getTime()).toBe(newStart.getTime());
    expect(res.body.data.houseId).toBe(houseA.id);
  });
});
