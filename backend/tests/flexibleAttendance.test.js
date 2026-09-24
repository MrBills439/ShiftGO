process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-access-secret';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test-refresh-secret';
process.env.RATE_LIMIT_DISABLED = 'true';

// FLEXIBLE Staff Attendance V1 — a FLEXIBLE employee (User.workPatternType)
// clocks in to an active Location of their agency with NO pre-created Shift.
// The clock-in creates the Shift (kind FLEXIBLE, locationId, houseId null,
// endTime null while open) plus ClockEvent / Timesheet / AttendanceMonitor in
// one transaction; clock-out closes the same shift and stamps its real endTime.
// ROTA/FIXED attendance must be untouched.

const request = require('supertest');
const { PrismaClient } = require('@prisma/client');
const app = require('../src/app');
const { signAccess } = require('../src/utils/jwt');
const clockService = require('../src/services/clockService');
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
const MIN = 60_000;
const LAT = 51.5;
const LNG = -0.12;
const OUTSIDE_LAT = 51.51; // ~1.1 km north — well outside a 50 m radius

let agencyA, agencyB;
let managerA, flex1, flex2, flex3, flexDeactivated, rotaWorker, fixedWorker, flexB;
let houseA, locA, locA2, locInactive, locNoCoords, locB;

const inside = (over = {}) => ({ locationId: locA.id, latitude: LAT, longitude: LNG, accuracy: 10, ...over });
const flexShifts = (workerId) => prisma.shift.findMany({ where: { workerId, kind: 'FLEXIBLE' } });

async function mkWorker(agencyId, tag, over = {}) {
  return prisma.user.create({
    data: { agencyId, role: 'WORKER', name: `FA ${tag}`, email: `fa-${tag}-${suffix}@t.test`, passwordHash: 'x', ...over },
  });
}

// Clock a worker out so the next test can start a fresh session.
async function closeSession(worker, shiftId) {
  const res = await as(worker).post('/clock/out', { shiftId, latitude: LAT, longitude: LNG, accuracy: 10 });
  expect(res.status).toBe(200);
}

beforeAll(async () => {
  agencyA = await prisma.agency.create({ data: { name: `FA A ${suffix}` } });
  agencyB = await prisma.agency.create({ data: { name: `FA B ${suffix}` } });

  managerA = await prisma.user.create({
    data: { agencyId: agencyA.id, role: 'MANAGER', name: 'FA Mgr', email: `fa-mgr-${suffix}@t.test`, passwordHash: 'x' },
  });
  flex1 = await mkWorker(agencyA.id, 'flex1', { workPatternType: 'FLEXIBLE' });
  flex2 = await mkWorker(agencyA.id, 'flex2', { workPatternType: 'FLEXIBLE' });
  flex3 = await mkWorker(agencyA.id, 'flex3', { workPatternType: 'FLEXIBLE' });
  flexDeactivated = await mkWorker(agencyA.id, 'flexdead', { workPatternType: 'FLEXIBLE', status: 'DEACTIVATED' });
  rotaWorker = await mkWorker(agencyA.id, 'rota'); // default ROTA
  fixedWorker = await mkWorker(agencyA.id, 'fixed', { workPatternType: 'FIXED' });
  flexB = await mkWorker(agencyB.id, 'flexb', { workPatternType: 'FLEXIBLE' });

  houseA = await prisma.house.create({
    data: {
      agencyId: agencyA.id, name: `FA House ${suffix}`, address: '1 Test St',
      latitude: LAT, longitude: LNG, geofenceRadius: 50, managerId: managerA.id,
    },
  });
  const loc = (agencyId, name, over = {}) => prisma.location.create({
    data: { agencyId, name: `FA ${name} ${suffix}`, type: 'OFFICE', latitude: LAT, longitude: LNG, geofenceRadius: 50, active: true, ...over },
  });
  locA = await loc(agencyA.id, 'Head Office');
  locA2 = await loc(agencyA.id, 'Annex');
  locInactive = await loc(agencyA.id, 'Closed Office', { active: false });
  locNoCoords = await loc(agencyA.id, 'No Coords', { latitude: null, longitude: null });
  locB = await loc(agencyB.id, 'Other Agency Office');
});

afterAll(async () => {
  const agencyIds = [agencyA.id, agencyB.id];
  await prisma.notification.deleteMany({ where: { agencyId: { in: agencyIds } } });
  await prisma.leaveRequest.deleteMany({ where: { agencyId: { in: agencyIds } } });
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

describe('flexible clock-in — request contract', () => {
  test('2. neither shiftId nor locationId is rejected', async () => {
    const res = await as(flex1).post('/clock/in', { latitude: LAT, longitude: LNG, accuracy: 10 });
    expect(res.status).toBe(400);
  });

  test('3. a House-only request cannot start a flexible session', async () => {
    const houseOnly = await as(flex1).post('/clock/in', { houseId: houseA.id, latitude: LAT, longitude: LNG, accuracy: 10 });
    expect(houseOnly.status).toBe(400);

    // A House id smuggled in as the locationId is not a Location of this agency.
    const smuggled = await as(flex1).post('/clock/in', inside({ locationId: houseA.id }));
    expect(smuggled.status).toBe(422);
    expect(smuggled.body.code).toBe('LOCATION_NOT_AVAILABLE');
    expect(await flexShifts(flex1.id)).toHaveLength(0);
  });

  test('4. a Location of another agency is rejected and creates nothing', async () => {
    const res = await as(flex1).post('/clock/in', inside({ locationId: locB.id }));
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('LOCATION_NOT_AVAILABLE');
    expect(await flexShifts(flex1.id)).toHaveLength(0);
  });

  test('5. an inactive Location is rejected', async () => {
    const res = await as(flex1).post('/clock/in', inside({ locationId: locInactive.id }));
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('LOCATION_NOT_AVAILABLE');
  });

  test('a Location with no map position cannot be clocked into', async () => {
    const res = await as(flex1).post('/clock/in', inside({ locationId: locNoCoords.id }));
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('LOCATION_NOT_CONFIGURED');
    expect(await flexShifts(flex1.id)).toHaveLength(0);
  });

  test('6. a ROTA or FIXED employee cannot use the location-only path', async () => {
    for (const w of [rotaWorker, fixedWorker]) {
      const res = await as(w).post('/clock/in', inside());
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FLEXIBLE_NOT_ENABLED');
      expect(await flexShifts(w.id)).toHaveLength(0);
    }
  });

  test('the client cannot make itself FLEXIBLE with a kind field', async () => {
    const res = await as(rotaWorker).post('/clock/in', inside({ kind: 'FLEXIBLE', workPatternType: 'FLEXIBLE' }));
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FLEXIBLE_NOT_ENABLED');
  });

  test('34. a deactivated employee is rejected (auth and service)', async () => {
    const res = await as(flexDeactivated).post('/clock/in', inside());
    expect(res.status).toBe(401);
    const direct = await clockService.clockInFlexible(flexDeactivated.id, 'MANUAL', { agencyId: agencyA.id, ...inside() });
    expect(direct.rejected).toBe('FORBIDDEN');
    expect(await flexShifts(flexDeactivated.id)).toHaveLength(0);
  });
});

describe('flexible clock-in — GPS / geofence (same standard as ROTA/FIXED)', () => {
  test('8. outside the geofence is rejected and leaves no orphan records', async () => {
    const res = await as(flex1).post('/clock/in', inside({ latitude: OUTSIDE_LAT }));
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('OUTSIDE_GEOFENCE');
    expect(await flexShifts(flex1.id)).toHaveLength(0);
    expect(await prisma.clockEvent.count({ where: { workerId: flex1.id } })).toBe(0);
    expect(await prisma.attendanceMonitor.count({ where: { workerId: flex1.id } })).toBe(0);
    expect(await prisma.timesheet.count({ where: { workerId: flex1.id } })).toBe(0);
  });

  test('9. poor accuracy, missing / invalid / stale location follow the existing rules', async () => {
    const poor = await as(flex1).post('/clock/in', inside({ accuracy: 500 }));
    expect(poor.status).toBe(422);
    expect(poor.body.code).toBe('GPS_ACCURACY_INSUFFICIENT');

    const missing = await as(flex1).post('/clock/in', { locationId: locA.id });
    expect(missing.status).toBe(422);
    expect(missing.body.code).toBe('LOCATION_REQUIRED');

    const nullIsland = await as(flex1).post('/clock/in', inside({ latitude: 0, longitude: 0 }));
    expect(nullIsland.status).toBe(422);
    expect(nullIsland.body.code).toBe('INVALID_COORDINATES');

    const stale = await as(flex1).post('/clock/in', inside({ capturedAt: new Date(Date.now() - 10 * MIN).toISOString() }));
    expect(stale.status).toBe(422);
    expect(stale.body.code).toBe('STALE_LOCATION');

    expect(await flexShifts(flex1.id)).toHaveLength(0);
  });

  test('a device clock far from server time cannot backdate a session', async () => {
    const res = await as(flex1).post('/clock/in', inside({ timestamp: new Date(Date.now() - 3 * HOUR).toISOString() }));
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('CLOCK_TIME_OUT_OF_RANGE');
    expect(await flexShifts(flex1.id)).toHaveLength(0);
  });
});

describe('flexible session lifecycle (clock-in → active → clock-out)', () => {
  let shiftId;
  let clockInBody;
  const startedAt = Date.now() - 20 * MIN; // inside the ±30 min server-time tolerance

  test('1/7. a FLEXIBLE employee clocks in without a shiftId', async () => {
    const res = await as(flex1).post('/clock/in', inside({ timestamp: new Date(startedAt).toISOString() }));
    expect(res.status).toBe(200);
    clockInBody = res.body.data;
    shiftId = clockInBody.shiftId;
    expect(shiftId).toBeTruthy();
  });

  test('16/19. the response carries what the app needs to keep the session', () => {
    expect(clockInBody).toMatchObject({
      kind: 'FLEXIBLE', status: 'IN_PROGRESS', monitorStarted: true,
      location: { id: locA.id, name: locA.name },
    });
    expect(new Date(clockInBody.clockInAt).getTime()).toBe(startedAt);
  });

  test('10/11/12. a real FLEXIBLE Shift was created (location-backed, no house, no scheduled end)', async () => {
    const shift = await prisma.shift.findUnique({ where: { id: shiftId } });
    expect(shift).toMatchObject({
      kind: 'FLEXIBLE', locationId: locA.id, houseId: null, workerId: flex1.id,
      createdById: flex1.id, status: 'IN_PROGRESS', endTime: null, agencyId: agencyA.id,
    });
    expect(shift.startTime.getTime()).toBe(startedAt);
    expect(shift.date.getUTCHours()).toBe(0); // calendar date at UTC midnight, like generated shifts
    expect(await flexShifts(flex1.id)).toHaveLength(1);
  });

  test('15. a ClockEvent(IN) was written against the Location', async () => {
    const events = await prisma.clockEvent.findMany({ where: { shiftId } });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'IN', workerId: flex1.id, locationId: locA.id, houseId: null,
      withinGeofence: true, locationStatusResult: 'ONSITE', verification: 'CLOCK_IN_GEOFENCE_VERIFIED',
    });
  });

  test('14. an open AttendanceMonitor was created', async () => {
    const monitors = await prisma.attendanceMonitor.findMany({ where: { shiftId } });
    expect(monitors).toHaveLength(1);
    expect(monitors[0]).toMatchObject({ workerId: flex1.id, locationId: locA.id, houseId: null, closedAt: null, locationStatus: 'ONSITE' });
  });

  test('an open Timesheet exists against the Location', async () => {
    const ts = await prisma.timesheet.findUnique({ where: { shiftId } });
    expect(ts).toMatchObject({ workerId: flex1.id, locationId: locA.id, houseId: null, clockOutAt: null, status: 'PENDING' });
    expect(ts.clockInAt.getTime()).toBe(startedAt);
  });

  test('13. no assignment / shift notification was created for the self-started session', async () => {
    expect(await prisma.notification.count({ where: { userId: flex1.id } })).toBe(0);
    expect(await prisma.notification.count({ where: { agencyId: agencyA.id, type: { in: ['SHIFT_ASSIGNED', 'SHIFT_OPEN'] } } })).toBe(0);
  });

  test('16. the active session can be rediscovered (app restart)', async () => {
    const res = await as(flex1).get('/clock/active-session');
    expect(res.status).toBe(200);
    expect(res.body.data.session).toMatchObject({ shiftId, kind: 'FLEXIBLE', status: 'IN_PROGRESS', location: { id: locA.id } });
    const none = await as(flex2).get('/clock/active-session');
    expect(none.body.data.session).toBeNull();
  });

  test('the open session is not a scheduled shift: it stays off the schedule listings', async () => {
    const mine = await as(flex1).get('/shifts');
    expect(mine.status).toBe(200);
    expect(mine.body.data.some((s) => s.id === shiftId)).toBe(false);
    const mgr = await as(managerA).get('/shifts');
    expect(mgr.body.data.some((s) => s.id === shiftId)).toBe(false);
  });

  test('24/25. missed-clock-in and the attendance job never touch the FLEXIBLE session', async () => {
    await expect(missedClockInJob()).resolves.not.toThrow();
    await expect(attendanceJob(new Date(Date.now() + 12 * HOUR))).resolves.not.toThrow();
    expect(await prisma.notification.count({ where: { userId: flex1.id, type: 'MISSED_CLOCK_IN' } })).toBe(0);
    const monitor = await prisma.attendanceMonitor.findUnique({ where: { shiftId } });
    expect(monitor).toMatchObject({ closedAt: null, shiftEndPromptedAt: null, autoClockOutGraceStartedAt: null });
    const shift = await prisma.shift.findUnique({ where: { id: shiftId } });
    expect(shift).toMatchObject({ status: 'IN_PROGRESS', endTime: null });
  });

  test('a location report while clocked in works with no scheduled end', async () => {
    const res = await as(flex1).post('/clock/location', { shiftId, latitude: LAT, longitude: LNG, accuracy: 10 });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ active: true, accepted: true, locationStatus: 'ONSITE', prompt: null });
    const still = await as(flex1).post('/clock/still-working', { shiftId });
    expect(still.status).toBe(200);
    expect(still.body.data.shiftEndedAcknowledged).toBe(false);
  });

  test('17. a second clock-in while a session is open is refused (same or different Location)', async () => {
    const same = await as(flex1).post('/clock/in', inside());
    expect(same.status).toBe(409);
    expect(same.body.code).toBe('ACTIVE_SESSION_EXISTS');
    expect(same.body.activeShiftId).toBe(shiftId);
    const other = await as(flex1).post('/clock/in', inside({ locationId: locA2.id }));
    expect(other.status).toBe(409);
    expect(await flexShifts(flex1.id)).toHaveLength(1);
  });

  test('a FLEXIBLE shift cannot be "clocked into" by id', async () => {
    const res = await as(flex1).post('/clock/in', { shiftId, latitude: LAT, longitude: LNG, accuracy: 10 });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('UNSUPPORTED_SHIFT_KIND');
  });

  test('33. another employee cannot clock out this session', async () => {
    const res = await as(flex2).post('/clock/out', { shiftId, latitude: LAT, longitude: LNG, accuracy: 10 });
    expect(res.status).toBe(403);
    expect(await prisma.clockEvent.count({ where: { shiftId, type: 'OUT' } })).toBe(0);
  });

  test('clock-out still requires a shiftId', async () => {
    const res = await as(flex1).post('/clock/out', { latitude: LAT, longitude: LNG, accuracy: 10 });
    expect(res.status).toBe(400);
  });

  test('19/20. clock-out closes the same session', async () => {
    const res = await as(flex1).post('/clock/out', { shiftId, latitude: LAT, longitude: LNG, accuracy: 10 });
    expect(res.status).toBe(200);
    expect(res.body.data.locationStatus).toBe('ONSITE');

    const out = await prisma.clockEvent.findMany({ where: { shiftId, type: 'OUT' } });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ workerId: flex1.id, locationId: locA.id, houseId: null, locationStatusResult: 'ONSITE' });
  });

  test('21. the Timesheet completes with the worked duration', async () => {
    const ts = await prisma.timesheet.findUnique({ where: { shiftId } });
    expect(ts.clockOutAt).toBeTruthy();
    expect(ts.totalHours).toBeGreaterThan(0.3); // ~20 minutes + test time
    expect(ts.totalHours).toBeLessThan(0.4);
    expect(ts).toMatchObject({ clockOutLocationStatus: 'ONSITE', clockOutMethod: 'MANUAL', needsReview: false, locationId: locA.id, houseId: null });
  });

  test('22. the Shift completes and its endTime is the real clock-out', async () => {
    const shift = await prisma.shift.findUnique({ where: { id: shiftId } });
    const out = await prisma.clockEvent.findFirst({ where: { shiftId, type: 'OUT' } });
    expect(shift.status).toBe('COMPLETED');
    expect(shift.endTime.getTime()).toBe(out.timestamp.getTime());
    const monitor = await prisma.attendanceMonitor.findUnique({ where: { shiftId } });
    expect(monitor.closedAt).toBeTruthy();
  });

  test('23. a repeated clock-out is refused and writes nothing', async () => {
    const res = await as(flex1).post('/clock/out', { shiftId, latitude: LAT, longitude: LNG, accuracy: 10 });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('ALREADY_CLOCKED_OUT');
    expect(await prisma.clockEvent.count({ where: { shiftId, type: 'OUT' } })).toBe(1);
    expect(await prisma.timesheet.count({ where: { shiftId } })).toBe(1);
  });

  test('32. completed flexible hours never count as scheduled weekly hours', async () => {
    const week = { start: new Date(Date.now() - 7 * 24 * HOUR), end: new Date(Date.now() + 7 * 24 * HOUR) };
    expect(await weeklyScheduledHours(flex1.id, agencyA.id, week.start, week.end)).toBe(0);
  });

  test('after clock-out the employee can start a new session', async () => {
    const res = await as(flex1).post('/clock/in', inside({ locationId: locA2.id }));
    expect(res.status).toBe(200);
    expect(res.body.data.location.id).toBe(locA2.id);
    await closeSession(flex1, res.body.data.shiftId);
    expect(await flexShifts(flex1.id)).toHaveLength(2);
  });
});

describe('18/25. concurrency — exactly one active session', () => {
  test('simultaneous flexible clock-ins create exactly one session', async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, () => as(flex2).post('/clock/in', inside())),
    );
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([200, 409, 409, 409, 409]);
    for (const r of results.filter((x) => x.status === 409)) {
      expect(r.body.code).toBe('ACTIVE_SESSION_EXISTS');
    }

    const shifts = await flexShifts(flex2.id);
    expect(shifts).toHaveLength(1);
    const shiftId = shifts[0].id;
    expect(await prisma.clockEvent.count({ where: { shiftId, type: 'IN' } })).toBe(1);
    expect(await prisma.attendanceMonitor.count({ where: { shiftId } })).toBe(1);
    expect(await prisma.timesheet.count({ where: { shiftId } })).toBe(1);

    // Two simultaneous clock-outs complete it once.
    const outs = await Promise.all(
      [0, 1].map(() => as(flex2).post('/clock/out', { shiftId, latitude: LAT, longitude: LNG, accuracy: 10 })),
    );
    expect(outs.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await prisma.clockEvent.count({ where: { shiftId, type: 'OUT' } })).toBe(1);
  });
});

describe('policy: leave and weekly hours do not block flexible clock-in', () => {
  test('31. approved leave today does not block clock-in (existing clock-in never consults leave)', async () => {
    await prisma.leaveRequest.create({
      data: {
        agencyId: agencyA.id, workerId: flex3.id, status: 'APPROVED',
        startDate: new Date(Date.now() - 24 * HOUR), endDate: new Date(Date.now() + 24 * HOUR), reason: 'test',
      },
    });
    const res = await as(flex3).post('/clock/in', inside());
    expect(res.status).toBe(200);
    await closeSession(flex3, res.body.data.shiftId);
  });

  test('32. a tiny agency weekly scheduled-hours ceiling does not block flexible clock-in', async () => {
    await prisma.agency.update({ where: { id: agencyA.id }, data: { maxWeeklyScheduledHours: 1 } });
    const res = await as(flex3).post('/clock/in', inside());
    expect(res.status).toBe(200);
    await closeSession(flex3, res.body.data.shiftId);
  });
});

describe('30. manager review stays compatible', () => {
  test('an off-site clock-out flags the FLEXIBLE timesheet for review, visible with its Location', async () => {
    const inRes = await as(flex1).post('/clock/in', inside());
    expect(inRes.status).toBe(200);
    const { shiftId } = inRes.body.data;
    const out = await as(flex1).post('/clock/out', { shiftId, latitude: OUTSIDE_LAT, longitude: LNG, accuracy: 10 });
    expect(out.status).toBe(200);
    expect(out.body.data.locationStatus).toBe('OFFSITE');

    const ts = await prisma.timesheet.findUnique({ where: { shiftId } });
    expect(ts.needsReview).toBe(true);

    const review = await as(managerA).get('/timesheets/needs-review');
    expect(review.status).toBe(200);
    const row = review.body.data.find((t) => t.shiftId === shiftId);
    expect(row).toMatchObject({ location: { id: locA.id }, house: null, shift: { kind: 'FLEXIBLE', status: 'COMPLETED' } });
    expect(row.shift.endTime).toBeTruthy();
  });

  test('a manager can resolve an OPEN flexible session; the resolved clock-out becomes its endTime', async () => {
    const inRes = await as(flex2).post('/clock/in', inside({ mockLocationSuspected: true }));
    expect(inRes.status).toBe(200);
    const { shiftId } = inRes.body.data;
    const ts = await prisma.timesheet.findUnique({ where: { shiftId } });
    expect(ts.needsReview).toBe(true);

    const clockOutTime = new Date(Date.now() + MIN).toISOString();
    const res = await as(managerA).post(`/timesheets/${ts.id}/resolve-review`, { clockOutTime, reason: 'Forgot to clock out' });
    expect(res.status).toBe(200);

    const shift = await prisma.shift.findUnique({ where: { id: shiftId } });
    expect(shift.status).toBe('COMPLETED');
    expect(shift.endTime.toISOString()).toBe(clockOutTime);
    const out = await prisma.clockEvent.findFirst({ where: { shiftId, type: 'OUT' } });
    expect(out).toMatchObject({ locationId: locA.id, houseId: null, verification: 'MANAGER_RESOLVED_CLOCK_OUT' });
    const monitor = await prisma.attendanceMonitor.findUnique({ where: { shiftId } });
    expect(monitor.closedAt).toBeTruthy();
  });
});

describe('33. tenant isolation', () => {
  test('an agency B employee clocks into their own Location but never agency A\'s', async () => {
    const cross = await as(flexB).post('/clock/in', inside({ locationId: locA.id }));
    expect(cross.status).toBe(422);
    expect(cross.body.code).toBe('LOCATION_NOT_AVAILABLE');

    const own = await as(flexB).post('/clock/in', inside({ locationId: locB.id }));
    expect(own.status).toBe(200);
    const shift = await prisma.shift.findUnique({ where: { id: own.body.data.shiftId } });
    expect(shift.agencyId).toBe(agencyB.id);

    // Agency A sees nothing of it.
    const seen = await as(flex1).get('/clock/active-session');
    expect(seen.body.data.session).toBeNull();
    await closeSession(flexB, own.body.data.shiftId);
  });
});

describe('26-29. ROTA and FIXED attendance are unchanged', () => {
  test('a ROTA shift clocks in and out by shiftId exactly as before', async () => {
    const now = Date.now();
    const shift = await prisma.shift.create({
      data: {
        agencyId: agencyA.id, houseId: houseA.id, kind: 'ROTA', workerId: rotaWorker.id, createdById: managerA.id,
        date: new Date(now), startTime: new Date(now - HOUR), endTime: new Date(now + HOUR), status: 'SCHEDULED',
      },
    });
    const inRes = await as(rotaWorker).post('/clock/in', { houseId: houseA.id, shiftId: shift.id, latitude: LAT, longitude: LNG, accuracy: 10 });
    expect(inRes.status).toBe(200);
    const outside = await as(rotaWorker).post('/clock/in', { houseId: houseA.id, shiftId: shift.id, latitude: OUTSIDE_LAT, longitude: LNG, accuracy: 10 });
    expect(outside.status).toBe(409); // already clocked in — idempotency untouched
    const outRes = await as(rotaWorker).post('/clock/out', { houseId: houseA.id, shiftId: shift.id, latitude: LAT, longitude: LNG, accuracy: 10 });
    expect(outRes.status).toBe(200);
    const after = await prisma.shift.findUnique({ where: { id: shift.id } });
    expect(after.status).toBe('COMPLETED');
    expect(after.endTime.getTime()).toBe(now + HOUR); // scheduled end is NOT overwritten for ROTA
  });

  test('a FIXED shift clocks in (geofence enforced) and out by shiftId exactly as before', async () => {
    const now = Date.now();
    const shift = await prisma.shift.create({
      data: {
        agencyId: agencyA.id, locationId: locA.id, houseId: null, kind: 'FIXED', workerId: fixedWorker.id, createdById: managerA.id,
        date: new Date(now), startTime: new Date(now - HOUR), endTime: new Date(now + HOUR), status: 'SCHEDULED',
      },
    });
    const outsideIn = await as(fixedWorker).post('/clock/in', { shiftId: shift.id, latitude: OUTSIDE_LAT, longitude: LNG, accuracy: 10 });
    expect(outsideIn.status).toBe(422);
    expect(outsideIn.body.code).toBe('OUTSIDE_GEOFENCE');

    const inRes = await as(fixedWorker).post('/clock/in', { shiftId: shift.id, latitude: LAT, longitude: LNG, accuracy: 10 });
    expect(inRes.status).toBe(200);
    const outRes = await as(fixedWorker).post('/clock/out', { shiftId: shift.id, latitude: LAT, longitude: LNG, accuracy: 10 });
    expect(outRes.status).toBe(200);
    const after = await prisma.shift.findUnique({ where: { id: shift.id } });
    expect(after.endTime.getTime()).toBe(now + HOUR);
  });
});
