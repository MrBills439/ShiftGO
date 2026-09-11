process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-access-secret';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test-refresh-secret';
process.env.RATE_LIMIT_DISABLED = 'true';

// Location-Backed Attendance Records V1 — ClockEvent / AttendanceMonitor /
// Timesheet become target-neutral: a FIXED (Location-backed) shift can now
// clock in, clock out, report location and use the still-working flow exactly
// like a ROTA (House-backed) shift, writing locationId instead of houseId.
// Care ROTA attendance must remain byte-for-byte identical.

const request = require('supertest');
const { PrismaClient } = require('@prisma/client');
const app = require('../src/app');
const { signAccess } = require('../src/utils/jwt');
const { missedClockInJob } = require('../src/jobs/missedClockInJob');
const { attendanceJob } = require('../src/jobs/attendanceJob');

const prisma = new PrismaClient();
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const tokenFor = (u) => signAccess({ id: u.id, agencyId: u.agencyId, role: u.role, status: u.status, name: u.name, email: u.email });
const as = (u) => ({
  post: (p, b) => request(app).post(p).set('Authorization', `Bearer ${tokenFor(u)}`).send(b || {}),
});

const HOUR = 3_600_000;
const MIN = 60_000;
const LAT = 51.5;
const LNG = -0.12;
const OUTSIDE_LAT = 51.51; // ~1.1 km north — well outside a 50 m radius

let agencyA, agencyB;
let managerA, workerA1, workerA2, workerB;
let houseA, locationA, locationA2, locationB;

function iso(ms) { return new Date(ms).toISOString(); }

beforeAll(async () => {
  agencyA = await prisma.agency.create({ data: { name: `LAR A ${suffix}` } });
  agencyB = await prisma.agency.create({ data: { name: `LAR B ${suffix}` } });

  managerA = await prisma.user.create({
    data: { agencyId: agencyA.id, role: 'MANAGER', name: 'LAR Mgr', email: `lar-mgr-${suffix}@t.test`, passwordHash: 'x' },
  });
  workerA1 = await prisma.user.create({
    data: { agencyId: agencyA.id, role: 'WORKER', name: 'LAR Wkr1', email: `lar-wkr1-${suffix}@t.test`, passwordHash: 'x' },
  });
  workerA2 = await prisma.user.create({
    data: { agencyId: agencyA.id, role: 'WORKER', name: 'LAR Wkr2', email: `lar-wkr2-${suffix}@t.test`, passwordHash: 'x' },
  });
  workerB = await prisma.user.create({
    data: { agencyId: agencyB.id, role: 'WORKER', name: 'LAR WkrB', email: `lar-wkrb-${suffix}@t.test`, passwordHash: 'x' },
  });

  houseA = await prisma.house.create({
    data: {
      agencyId: agencyA.id, name: `LAR House ${suffix}`, address: '1 Test St',
      latitude: LAT, longitude: LNG, geofenceRadius: 50, managerId: managerA.id,
    },
  });
  locationA = await prisma.location.create({
    data: {
      agencyId: agencyA.id, name: `LAR Office ${suffix}`, type: 'OFFICE',
      latitude: LAT, longitude: LNG, geofenceRadius: 50, active: true,
    },
  });
  locationA2 = await prisma.location.create({
    data: {
      agencyId: agencyA.id, name: `LAR Office 2 ${suffix}`, type: 'OFFICE',
      latitude: LAT, longitude: LNG, geofenceRadius: 50, active: true,
    },
  });
  locationB = await prisma.location.create({
    data: { agencyId: agencyB.id, name: `LAR Office B ${suffix}`, type: 'OFFICE', latitude: LAT, longitude: LNG, geofenceRadius: 50, active: true },
  });
});

afterAll(async () => {
  await prisma.notification.deleteMany({ where: { agencyId: { in: [agencyA.id, agencyB.id] } } });
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

let shiftCounter = 0;
function mkRotaShift(worker, over = {}) {
  shiftCounter += 1;
  const now = Date.now() + shiftCounter * MIN; // each shift gets its own instant, no overlap
  return prisma.shift.create({
    data: {
      agencyId: agencyA.id, houseId: houseA.id, kind: 'ROTA', workerId: worker.id, createdById: managerA.id,
      date: new Date(now), startTime: new Date(now - HOUR), endTime: new Date(now + HOUR), status: 'SCHEDULED',
      ...over,
    },
  });
}
function mkFixedShift(worker, over = {}) {
  shiftCounter += 1;
  const now = Date.now() + shiftCounter * MIN;
  return prisma.shift.create({
    data: {
      agencyId: agencyA.id, locationId: locationA.id, houseId: null, kind: 'FIXED', workerId: worker.id, createdById: managerA.id,
      date: new Date(now), startTime: new Date(now - HOUR), endTime: new Date(now + HOUR), status: 'SCHEDULED',
      ...over,
    },
  });
}

describe('ROTA (House) attendance records — unchanged', () => {
  test('1-4. ROTA clock-in/out works, and ClockEvent/AttendanceMonitor/Timesheet all carry houseId with locationId null', async () => {
    const shift = await mkRotaShift(workerA1);

    const inRes = await as(workerA1).post('/clock/in', { houseId: houseA.id, shiftId: shift.id, latitude: LAT, longitude: LNG, accuracy: 10 });
    expect(inRes.status).toBe(200);
    const outRes = await as(workerA1).post('/clock/out', { houseId: houseA.id, shiftId: shift.id, latitude: LAT, longitude: LNG, accuracy: 10 });
    expect(outRes.status).toBe(200);

    const events = await prisma.clockEvent.findMany({ where: { shiftId: shift.id } });
    expect(events).toHaveLength(2);
    for (const e of events) {
      expect(e.houseId).toBe(houseA.id);
      expect(e.locationId).toBeNull();
    }
    const monitor = await prisma.attendanceMonitor.findUnique({ where: { shiftId: shift.id } });
    expect(monitor.houseId).toBe(houseA.id);
    expect(monitor.locationId).toBeNull();
    const ts = await prisma.timesheet.findUnique({ where: { shiftId: shift.id } });
    expect(ts.houseId).toBe(houseA.id);
    expect(ts.locationId).toBeNull();
    expect(ts.totalHours).toBeGreaterThan(0);
  });
});

describe('FIXED (Location) attendance records', () => {
  test('5-8. FIXED clock-in works, and ClockEvent/AttendanceMonitor/Timesheet all carry locationId with houseId null', async () => {
    const shift = await mkFixedShift(workerA1);

    const res = await as(workerA1).post('/clock/in', { shiftId: shift.id, latitude: LAT, longitude: LNG, accuracy: 10 });
    expect(res.status).toBe(200);
    expect(res.body.data.alreadyClockedIn).toBeFalsy();

    const events = await prisma.clockEvent.findMany({ where: { shiftId: shift.id } });
    expect(events).toHaveLength(1);
    expect(events[0].houseId).toBeNull();
    expect(events[0].locationId).toBe(locationA.id);

    const monitor = await prisma.attendanceMonitor.findUnique({ where: { shiftId: shift.id } });
    expect(monitor.houseId).toBeNull();
    expect(monitor.locationId).toBe(locationA.id);

    const ts = await prisma.timesheet.findUnique({ where: { shiftId: shift.id } });
    expect(ts.houseId).toBeNull();
    expect(ts.locationId).toBe(locationA.id);

    // 9. clock-out also works and writes the same target.
    const outRes = await as(workerA1).post('/clock/out', { shiftId: shift.id, latitude: LAT, longitude: LNG, accuracy: 10 });
    expect(outRes.status).toBe(200);
    const freshShift = await prisma.shift.findUnique({ where: { id: shift.id } });
    expect(freshShift.status).toBe('COMPLETED');
    const outEvent = await prisma.clockEvent.findFirst({ where: { shiftId: shift.id, type: 'OUT' } });
    expect(outEvent.houseId).toBeNull();
    expect(outEvent.locationId).toBe(locationA.id);
    const finalTs = await prisma.timesheet.findUnique({ where: { shiftId: shift.id } });
    expect(finalTs.totalHours).toBeGreaterThan(0);
  });

  test('10. FIXED report-location works while clocked in', async () => {
    const shift = await mkFixedShift(workerA1);
    await as(workerA1).post('/clock/in', { shiftId: shift.id, latitude: LAT, longitude: LNG, accuracy: 10 });

    const res = await as(workerA1).post('/clock/location', {
      shiftId: shift.id, latitude: LAT, longitude: LNG, accuracy: 10, capturedAt: new Date().toISOString(),
    });
    expect(res.status).toBe(200);
    expect(res.body.data.active).toBe(true);
    expect(res.body.data.accepted).toBe(true);
    expect(res.body.data.locationStatus).toBe('ONSITE');
  });

  test('11. FIXED still-working flow: exit debounce, prompt, and confirmation', async () => {
    const shift = await mkFixedShift(workerA1);
    await as(workerA1).post('/clock/in', { shiftId: shift.id, latitude: LAT, longitude: LNG, accuracy: 10 });

    // Three consecutive OFFSITE readings confirm a genuine exit (debounce).
    let last;
    for (let i = 0; i < 3; i += 1) {
      last = await as(workerA1).post('/clock/location', {
        shiftId: shift.id, latitude: OUTSIDE_LAT, longitude: LNG, accuracy: 10, capturedAt: new Date().toISOString(),
      });
      expect(last.status).toBe(200);
    }
    expect(last.body.data.locationStatus).toBe('OFFSITE');
    expect(last.body.data.prompt).toBe('LEFT_GEOFENCE_STILL_WORKING');

    const monitor = await prisma.attendanceMonitor.findUnique({ where: { shiftId: shift.id } });
    expect(monitor.geofenceExitConfirmedAt).not.toBeNull();
    expect(monitor.locationId).toBe(locationA.id);

    const confirm = await as(workerA1).post('/clock/still-working', { shiftId: shift.id });
    expect(confirm.status).toBe(200);
    expect(confirm.body.data.active).toBe(true);

    const afterConfirm = await prisma.attendanceMonitor.findUnique({ where: { shiftId: shift.id } });
    expect(afterConfirm.stillWorkingConfirmedAt).not.toBeNull();
  });
});

describe('Location geofence', () => {
  test('12. onsite reading at the Location is accepted and classified ONSITE', async () => {
    const shift = await mkFixedShift(workerA1);
    const res = await as(workerA1).post('/clock/in', { shiftId: shift.id, latitude: LAT, longitude: LNG, accuracy: 10 });
    expect(res.status).toBe(200);
    expect(res.body.data.event.locationStatusResult).toBe('ONSITE');
    expect(res.body.data.event.distanceMeters).toBe(0);
  });

  test('13. offsite reading at the Location is rejected (OUTSIDE_GEOFENCE) and never clocks in', async () => {
    const shift = await mkFixedShift(workerA1);
    const res = await as(workerA1).post('/clock/in', { shiftId: shift.id, latitude: OUTSIDE_LAT, longitude: LNG, accuracy: 10 });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('OUTSIDE_GEOFENCE');
    expect(await prisma.clockEvent.count({ where: { shiftId: shift.id } })).toBe(0);
  });

  test('14. Location geofence uses the same distance/radius logic as House (identical outcome for the same coordinates)', async () => {
    const rota = await mkRotaShift(workerA1);
    const fixed = await mkFixedShift(workerA2);

    const houseRes = await as(workerA1).post('/clock/in', { houseId: houseA.id, shiftId: rota.id, latitude: OUTSIDE_LAT, longitude: LNG, accuracy: 10 });
    const locationRes = await as(workerA2).post('/clock/in', { shiftId: fixed.id, latitude: OUTSIDE_LAT, longitude: LNG, accuracy: 10 });

    expect(houseRes.status).toBe(422);
    expect(locationRes.status).toBe(422);
    expect(houseRes.body.code).toBe('OUTSIDE_GEOFENCE');
    expect(locationRes.body.code).toBe('OUTSIDE_GEOFENCE');
    expect(locationRes.body.details.distanceMeters).toBe(houseRes.body.details.distanceMeters);
    expect(locationRes.body.details.geofenceRadius).toBe(houseRes.body.details.geofenceRadius);
  });
});

describe('the Shift is always authoritative — client-claimed targets are consistency checks only', () => {
  test('15. a FIXED shift rejects a clock-in that claims the wrong Location', async () => {
    const shift = await mkFixedShift(workerA1);
    const res = await as(workerA1).post('/clock/in', {
      locationId: locationA2.id, shiftId: shift.id, latitude: LAT, longitude: LNG, accuracy: 10,
    });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
    expect(await prisma.clockEvent.count({ where: { shiftId: shift.id } })).toBe(0);
  });

  test('16. a ROTA shift rejects a clock-in that claims a Location instead of its House', async () => {
    const shift = await mkRotaShift(workerA1);
    const res = await as(workerA1).post('/clock/in', {
      locationId: locationA.id, shiftId: shift.id, latitude: LAT, longitude: LNG, accuracy: 10,
    });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
    expect(await prisma.clockEvent.count({ where: { shiftId: shift.id } })).toBe(0);
  });

  test('17. a FIXED shift rejects a clock-in that claims a House instead of its Location', async () => {
    const shift = await mkFixedShift(workerA1);
    const res = await as(workerA1).post('/clock/in', {
      houseId: houseA.id, shiftId: shift.id, latitude: LAT, longitude: LNG, accuracy: 10,
    });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });

  test('18. cross-agency safety remains — a worker from another agency cannot clock into this shift', async () => {
    const shift = await mkFixedShift(workerA1);
    const res = await as(workerB).post('/clock/in', { shiftId: shift.id, latitude: LAT, longitude: LNG, accuracy: 10 });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
    expect(await prisma.clockEvent.count({ where: { shiftId: shift.id } })).toBe(0);
  });

  test('19-20. every attendance record produced in this suite has exactly one target — never both, never neither', async () => {
    const [ceBoth, ceNeither, amBoth, amNeither, tsBoth, tsNeither] = await Promise.all([
      prisma.clockEvent.count({ where: { agencyId: { in: [agencyA.id, agencyB.id] }, houseId: { not: null }, locationId: { not: null } } }),
      prisma.clockEvent.count({ where: { agencyId: { in: [agencyA.id, agencyB.id] }, houseId: null, locationId: null } }),
      prisma.attendanceMonitor.count({ where: { agencyId: { in: [agencyA.id, agencyB.id] }, houseId: { not: null }, locationId: { not: null } } }),
      prisma.attendanceMonitor.count({ where: { agencyId: { in: [agencyA.id, agencyB.id] }, houseId: null, locationId: null } }),
      prisma.timesheet.count({ where: { agencyId: { in: [agencyA.id, agencyB.id] }, houseId: { not: null }, locationId: { not: null } } }),
      prisma.timesheet.count({ where: { agencyId: { in: [agencyA.id, agencyB.id] }, houseId: null, locationId: null } }),
    ]);
    expect({ ceBoth, ceNeither, amBoth, amNeither, tsBoth, tsNeither }).toEqual({
      ceBoth: 0, ceNeither: 0, amBoth: 0, amNeither: 0, tsBoth: 0, tsNeither: 0,
    });
  });
});

describe('attendanceJob processes ROTA and FIXED, never FLEXIBLE', () => {
  test('21. attendanceJob processes a ROTA (House) monitor — prompts once the shift has ended', async () => {
    const now = Date.now();
    // Clock in DURING the shift window (default start=now-1h, end=now+1h), then
    // advance the job's own clock past endTime — the job takes `now` as a
    // parameter precisely so this doesn't need real elapsed time.
    const shift = await mkRotaShift(workerA1);
    const inRes = await as(workerA1).post('/clock/in', { houseId: houseA.id, shiftId: shift.id, latitude: LAT, longitude: LNG, accuracy: 10 });
    expect(inRes.status).toBe(200);

    await attendanceJob(new Date(now + 2 * HOUR));

    const monitor = await prisma.attendanceMonitor.findUnique({ where: { shiftId: shift.id } });
    expect(monitor.shiftEndPromptedAt).not.toBeNull();
  });

  test('22. attendanceJob processes a FIXED (Location) monitor — prompts once the shift has ended', async () => {
    const now = Date.now();
    const shift = await mkFixedShift(workerA1);
    const inRes = await as(workerA1).post('/clock/in', { shiftId: shift.id, latitude: LAT, longitude: LNG, accuracy: 10 });
    expect(inRes.status).toBe(200);

    await attendanceJob(new Date(now + 2 * HOUR));

    const monitor = await prisma.attendanceMonitor.findUnique({ where: { shiftId: shift.id } });
    expect(monitor.shiftEndPromptedAt).not.toBeNull();
  });

  test('23. attendanceJob ignores a FLEXIBLE shift (forced directly — FLEXIBLE cannot be created via the API)', async () => {
    const now = Date.now();
    const flexShift = await prisma.shift.create({
      data: {
        agencyId: agencyA.id, kind: 'FLEXIBLE', locationId: locationA.id, houseId: null,
        workerId: workerA2.id, createdById: managerA.id, status: 'IN_PROGRESS',
        date: new Date(now), startTime: new Date(now - 2 * HOUR), endTime: new Date(now - HOUR),
      },
    });
    const monitor = await prisma.attendanceMonitor.create({
      data: { agencyId: agencyA.id, shiftId: flexShift.id, workerId: workerA2.id, locationId: locationA.id, closedAt: null, shiftEndPromptedAt: null },
    });

    await expect(attendanceJob(new Date(now))).resolves.not.toThrow();

    const fresh = await prisma.attendanceMonitor.findUnique({ where: { id: monitor.id } });
    expect(fresh.shiftEndPromptedAt).toBeNull(); // untouched
  });
});

describe('missedClockInJob processes ROTA and FIXED, never FLEXIBLE', () => {
  test('24. missedClockInJob alerts for a missed ROTA shift', async () => {
    const startedAgo = Date.now() - 9 * MIN;
    const shift = await prisma.shift.create({
      data: {
        agencyId: agencyA.id, houseId: houseA.id, kind: 'ROTA', workerId: workerA1.id, createdById: managerA.id,
        date: new Date(startedAgo), startTime: new Date(startedAgo), endTime: new Date(startedAgo + 4 * HOUR), status: 'SCHEDULED',
      },
    });
    await missedClockInJob();
    const alert = await prisma.notification.findFirst({ where: { type: 'MISSED_CLOCK_IN', userId: workerA1.id, data: { path: ['shiftId'], equals: shift.id } } });
    expect(alert).toBeTruthy();
    expect(alert.body).toContain(houseA.name);
  });

  test('25. missedClockInJob alerts for a missed FIXED shift, using the Location name', async () => {
    const startedAgo = Date.now() - 9 * MIN;
    const shift = await prisma.shift.create({
      data: {
        agencyId: agencyA.id, locationId: locationA.id, houseId: null, kind: 'FIXED', workerId: workerA2.id, createdById: managerA.id,
        date: new Date(startedAgo), startTime: new Date(startedAgo), endTime: new Date(startedAgo + 4 * HOUR), status: 'SCHEDULED',
      },
    });
    await missedClockInJob();
    const alert = await prisma.notification.findFirst({ where: { type: 'MISSED_CLOCK_IN', userId: workerA2.id, data: { path: ['shiftId'], equals: shift.id } } });
    expect(alert).toBeTruthy();
    expect(alert.body).toContain(locationA.name);
  });

  test('26. missedClockInJob ignores a FLEXIBLE shift (forced directly)', async () => {
    const startedAgo = Date.now() - 9 * MIN;
    const worker3 = await prisma.user.create({
      data: { agencyId: agencyA.id, role: 'WORKER', name: 'LAR Wkr3', email: `lar-wkr3-${suffix}@t.test`, passwordHash: 'x' },
    });
    const shift = await prisma.shift.create({
      data: {
        agencyId: agencyA.id, locationId: locationA.id, houseId: null, kind: 'FLEXIBLE', workerId: worker3.id, createdById: managerA.id,
        date: new Date(startedAgo), startTime: new Date(startedAgo), endTime: new Date(startedAgo + 4 * HOUR), status: 'SCHEDULED',
      },
    });
    await missedClockInJob();
    const alert = await prisma.notification.findFirst({ where: { type: 'MISSED_CLOCK_IN', userId: worker3.id, data: { path: ['shiftId'], equals: shift.id } } });
    expect(alert).toBeNull();
  });
});
