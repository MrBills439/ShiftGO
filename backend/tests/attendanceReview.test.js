process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-access-secret';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test-refresh-secret';
process.env.RATE_LIMIT_DISABLED = 'true';

const request = require('supertest');
const { PrismaClient } = require('@prisma/client');
const app = require('../src/app');
const { signAccess } = require('../src/utils/jwt');
const { attendanceJob } = require('../src/jobs/attendanceJob');
const { ATTENDANCE_DEFAULTS } = require('../src/config/attendance');

const prisma = new PrismaClient();
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const tokenFor = (u) => signAccess({ id: u.id, role: u.role, name: u.name, email: u.email });

const HOUSE_LAT = 51.5;
const HOUSE_LNG = -0.12;
const OUTSIDE_LAT = 51.51; // ~1.1 km north — well outside a 50 m fence
const OUTSIDE_LNG = -0.12;

let agencyA, agencyB, managerA, hrA, workerA, houseA, managerB, workerB, houseB;

async function mkAgencyWorld(tag) {
  const agency = await prisma.agency.create({ data: { name: `Review ${tag} ${suffix}` } });
  const mk = (role, sub) => prisma.user.create({
    data: { agencyId: agency.id, role, name: `${sub} ${tag}`, email: `rev-${sub}-${tag}-${suffix}@t.test`, passwordHash: 'x' },
  });
  const manager = await mk('MANAGER', 'mgr');
  const hr = await mk('HR', 'hr');
  const worker = await mk('WORKER', 'wkr');
  const house = await prisma.house.create({
    data: { agencyId: agency.id, name: `House ${tag} ${suffix}`, address: '1 Test St', latitude: HOUSE_LAT, longitude: HOUSE_LNG, geofenceRadius: 50, managerId: manager.id },
  });
  return { agency, manager, hr, worker, house };
}

async function mkShift({ agency, house, worker, manager, startTime, endTime } = {}) {
  const now = Date.now();
  return prisma.shift.create({
    data: {
      agencyId: agency.id, houseId: house.id, workerId: worker.id, createdById: manager.id,
      date: new Date(now),
      startTime: startTime ?? new Date(now - 3_600_000),
      endTime: endTime ?? new Date(now + 3_600_000),
      status: 'SCHEDULED',
    },
  });
}

async function clockIn(worker, house, shift, over = {}) {
  return request(app).post('/clock/in').set('Authorization', `Bearer ${tokenFor(worker)}`)
    .send({ houseId: house.id, shiftId: shift.id, latitude: HOUSE_LAT, longitude: HOUSE_LNG, accuracy: 10, ...over });
}

async function report(worker, shift, over = {}) {
  return request(app).post('/clock/location').set('Authorization', `Bearer ${tokenFor(worker)}`)
    .send({ shiftId: shift.id, latitude: HOUSE_LAT, longitude: HOUSE_LNG, accuracy: 10, ...over });
}

/** Produces an OPEN attendance record flagged needsReview=true (the "uncertain
 *  evidence, grace elapsed" outcome from attendanceJob) for workerA/houseA. */
async function flaggedOpenAttendance() {
  const shift = await mkShift({ agency: agencyA, house: houseA, worker: workerA, manager: managerA });
  const ci = await clockIn(workerA, houseA, shift, { accuracy: 10 });
  expect(ci.status).toBe(200);
  await prisma.shift.update({ where: { id: shift.id }, data: { endTime: new Date(Date.now() - 3_600_000) } });
  for (let i = 0; i < 3; i++) await report(workerA, shift, { latitude: OUTSIDE_LAT, longitude: OUTSIDE_LNG, accuracy: 8 });
  await prisma.attendanceMonitor.update({
    where: { shiftId: shift.id },
    data: { lastReadingAt: new Date(Date.now() - ATTENDANCE_DEFAULTS.autoClockOutMaxEvidenceAgeMs - 60_000) },
  });
  await attendanceJob(new Date(Date.now() + ATTENDANCE_DEFAULTS.autoClockOutGraceMs + 5_000));

  const ts = await prisma.timesheet.findUnique({ where: { shiftId: shift.id } });
  expect(ts.needsReview).toBe(true);
  expect(ts.clockOutAt).toBeNull();
  const mon = await prisma.attendanceMonitor.findUnique({ where: { shiftId: shift.id } });
  expect(mon.closedAt).toBeNull();
  expect(mon.lastLatitude).not.toBeNull(); // live coords present before resolution
  return { shift, timesheet: ts };
}

/** Produces an ALREADY-CLOSED timesheet flagged needsReview=true (mock-location
 *  suspicion at clock-in survives a normal clock-out). */
async function flaggedClosedAttendance() {
  const shift = await mkShift({ agency: agencyA, house: houseA, worker: workerA, manager: managerA });
  const ci = await clockIn(workerA, houseA, shift, { mockLocationSuspected: true });
  expect(ci.status).toBe(200);
  const co = await request(app).post('/clock/out').set('Authorization', `Bearer ${tokenFor(workerA)}`)
    .send({ houseId: houseA.id, shiftId: shift.id, latitude: HOUSE_LAT, longitude: HOUSE_LNG, accuracy: 10 });
  expect(co.status).toBe(200);
  const ts = await prisma.timesheet.findUnique({ where: { shiftId: shift.id } });
  expect(ts.needsReview).toBe(true);
  expect(ts.clockOutAt).toBeTruthy();
  const originalClockOutAt = ts.clockOutAt;
  return { shift, timesheet: ts, originalClockOutAt };
}

beforeAll(async () => {
  ({ agency: agencyA, manager: managerA, hr: hrA, worker: workerA, house: houseA } = await mkAgencyWorld('A'));
  ({ agency: agencyB, manager: managerB, worker: workerB, house: houseB } = await mkAgencyWorld('B'));
});

afterAll(async () => {
  const agencies = [agencyA.id, agencyB.id];
  await prisma.auditLog.deleteMany({ where: { agencyId: { in: agencies } } });
  await prisma.attendanceMonitor.deleteMany({ where: { agencyId: { in: agencies } } });
  await prisma.clockEvent.deleteMany({ where: { agencyId: { in: agencies } } });
  await prisma.timesheet.deleteMany({ where: { agencyId: { in: agencies } } });
  await prisma.shift.deleteMany({ where: { agencyId: { in: agencies } } });
  await prisma.house.deleteMany({ where: { agencyId: { in: agencies } } });
  await prisma.user.deleteMany({ where: { agencyId: { in: agencies } } });
  await prisma.agency.deleteMany({ where: { id: { in: agencies } } });
  await prisma.$disconnect();
});

describe('GET /timesheets/needs-review', () => {
  it('lists flagged attendance agency-wide for a manager', async () => {
    const { timesheet } = await flaggedOpenAttendance();
    const res = await request(app).get('/timesheets/needs-review').set('Authorization', `Bearer ${tokenFor(managerA)}`);
    expect(res.status).toBe(200);
    expect(res.body.data.map((t) => t.id)).toContain(timesheet.id);
    expect(res.body.data.every((t) => t.agencyId === agencyA.id)).toBe(true);
  });

  it('rejects a worker', async () => {
    const res = await request(app).get('/timesheets/needs-review').set('Authorization', `Bearer ${tokenFor(workerA)}`);
    expect(res.status).toBe(403);
  });
});

describe('POST /timesheets/:id/resolve-review — open attendance', () => {
  it('lets a manager confirm the clock-out time and resolves the review', async () => {
    const { shift, timesheet } = await flaggedOpenAttendance();
    const clockOutTime = new Date().toISOString();
    const res = await request(app).post(`/timesheets/${timesheet.id}/resolve-review`)
      .set('Authorization', `Bearer ${tokenFor(managerA)}`)
      .send({ clockOutTime, reason: 'Checked with worker by phone — confirmed they left at this time.' });

    expect(res.status).toBe(200);
    expect(res.body.data.needsReview).toBe(false);
    expect(new Date(res.body.data.clockOutAt).toISOString()).toBe(clockOutTime);
    expect(res.body.data.clockOutMethod).toBe('MANUAL');
    expect(res.body.data.totalHours).toBeGreaterThan(0);

    const shiftAfter = await prisma.shift.findUnique({ where: { id: shift.id } });
    expect(shiftAfter.status).toBe('COMPLETED');
  });

  it('lets HR (admin-equivalent) resolve it too', async () => {
    const { timesheet } = await flaggedOpenAttendance();
    const res = await request(app).post(`/timesheets/${timesheet.id}/resolve-review`)
      .set('Authorization', `Bearer ${tokenFor(hrA)}`)
      .send({ clockOutTime: new Date().toISOString() });
    expect(res.status).toBe(200);
    expect(res.body.data.needsReview).toBe(false);
  });

  it('rejects a WORKER', async () => {
    const { timesheet } = await flaggedOpenAttendance();
    const res = await request(app).post(`/timesheets/${timesheet.id}/resolve-review`)
      .set('Authorization', `Bearer ${tokenFor(workerA)}`)
      .send({ clockOutTime: new Date().toISOString() });
    expect(res.status).toBe(403);
    const ts = await prisma.timesheet.findUnique({ where: { id: timesheet.id } });
    expect(ts.needsReview).toBe(true);
  });

  it('rejects a manager from another agency (agency scoping)', async () => {
    const { timesheet } = await flaggedOpenAttendance();
    const res = await request(app).post(`/timesheets/${timesheet.id}/resolve-review`)
      .set('Authorization', `Bearer ${tokenFor(managerB)}`)
      .send({ clockOutTime: new Date().toISOString() });
    expect(res.status).toBe(404);
    const ts = await prisma.timesheet.findUnique({ where: { id: timesheet.id } });
    expect(ts.needsReview).toBe(true);
  });

  it('requires a clockOutTime for an open record', async () => {
    const { timesheet } = await flaggedOpenAttendance();
    const res = await request(app).post(`/timesheets/${timesheet.id}/resolve-review`)
      .set('Authorization', `Bearer ${tokenFor(managerA)}`)
      .send({});
    expect(res.status).toBe(400);
  });

  it('rejects a clock-out time before the recorded clock-in', async () => {
    const { timesheet } = await flaggedOpenAttendance();
    const res = await request(app).post(`/timesheets/${timesheet.id}/resolve-review`)
      .set('Authorization', `Bearer ${tokenFor(managerA)}`)
      .send({ clockOutTime: new Date(Date.now() - 999 * 3_600_000).toISOString() });
    expect(res.status).toBe(400);
  });

  it('creates a ClockEvent OUT with no fabricated GPS and a manager-resolution verification', async () => {
    const { shift, timesheet } = await flaggedOpenAttendance();
    await request(app).post(`/timesheets/${timesheet.id}/resolve-review`)
      .set('Authorization', `Bearer ${tokenFor(managerA)}`)
      .send({ clockOutTime: new Date().toISOString() });

    const outEvt = await prisma.clockEvent.findFirst({ where: { shiftId: shift.id, type: 'OUT' } });
    expect(outEvt).toBeTruthy();
    expect(outEvt.verification).toBe('MANAGER_RESOLVED_CLOCK_OUT');
    expect(outEvt.method).toBe('MANUAL');
    expect(outEvt.latitude).toBeNull();
    expect(outEvt.longitude).toBeNull();
    expect(outEvt.accuracy).toBeNull();
    expect(outEvt.distanceMeters).toBeNull();
    expect(outEvt.withinGeofence).toBeNull();
    expect(outEvt.mockLocationSuspected).toBe(false);
  });

  it('closes the AttendanceMonitor and clears its live GPS fields', async () => {
    const { shift, timesheet } = await flaggedOpenAttendance();
    await request(app).post(`/timesheets/${timesheet.id}/resolve-review`)
      .set('Authorization', `Bearer ${tokenFor(managerA)}`)
      .send({ clockOutTime: new Date().toISOString() });

    const mon = await prisma.attendanceMonitor.findUnique({ where: { shiftId: shift.id } });
    expect(mon.closedAt).toBeTruthy();
    expect(mon.lastLatitude).toBeNull();
    expect(mon.lastLongitude).toBeNull();
    expect(mon.lastAccuracy).toBeNull();
    expect(mon.lastDistanceMeters).toBeNull();
  });

  it('writes an audit log with who resolved it, the previous reason, chosen time and resolution reason', async () => {
    const { timesheet } = await flaggedOpenAttendance();
    const originalReason = timesheet.reviewReason;
    const clockOutTime = new Date().toISOString();
    await request(app).post(`/timesheets/${timesheet.id}/resolve-review`)
      .set('Authorization', `Bearer ${tokenFor(managerA)}`)
      .send({ clockOutTime, reason: 'Confirmed by phone.' });

    const audit = await prisma.auditLog.findFirst({
      where: { entityType: 'Timesheet', entityId: timesheet.id, action: 'ATTENDANCE_REVIEW_RESOLVED' },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit).toBeTruthy();
    expect(audit.actorId).toBe(managerA.id);
    expect(audit.newValue).toEqual(expect.objectContaining({
      mode: 'CLOCKED_OUT',
      previousReviewReason: originalReason,
      resolutionReason: 'Confirmed by phone.',
    }));
    expect(new Date(audit.newValue.resolvedClockOutAt).toISOString()).toBe(clockOutTime);
  });

  it('is safe under duplicate / concurrent resolution attempts', async () => {
    const { shift, timesheet } = await flaggedOpenAttendance();
    const clockOutTime = new Date().toISOString();
    const attempts = await Promise.all(
      Array.from({ length: 5 }, () =>
        request(app).post(`/timesheets/${timesheet.id}/resolve-review`)
          .set('Authorization', `Bearer ${tokenFor(managerA)}`)
          .send({ clockOutTime })),
    );
    const statuses = attempts.map((r) => r.status).sort();
    expect(statuses.filter((s) => s === 200)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(4);

    expect(await prisma.clockEvent.count({ where: { shiftId: shift.id, type: 'OUT' } })).toBe(1);
    const ts = await prisma.timesheet.findUnique({ where: { id: timesheet.id } });
    expect(ts.needsReview).toBe(false);
  });

  it('a genuine race with the worker\'s own clock-out resolves cleanly with no duplicate event', async () => {
    const { shift, timesheet } = await flaggedOpenAttendance();
    const [managerResolve, workerClockOut] = await Promise.all([
      request(app).post(`/timesheets/${timesheet.id}/resolve-review`)
        .set('Authorization', `Bearer ${tokenFor(managerA)}`)
        .send({ clockOutTime: new Date().toISOString() }),
      request(app).post('/clock/out').set('Authorization', `Bearer ${tokenFor(workerA)}`)
        .send({ houseId: houseA.id, shiftId: shift.id, latitude: OUTSIDE_LAT, longitude: OUTSIDE_LNG, accuracy: 10 }),
    ]);
    // Exactly one of the two actually closed it; the other is told it's already resolved/closed.
    const ok = [managerResolve.status, workerClockOut.status].filter((s) => s === 200);
    expect(ok.length).toBeGreaterThanOrEqual(1);
    expect(await prisma.clockEvent.count({ where: { shiftId: shift.id, type: 'OUT' } })).toBe(1);
    const ts = await prisma.timesheet.findUnique({ where: { id: timesheet.id } });
    expect(ts.needsReview).toBe(false);
    expect(ts.clockOutAt).toBeTruthy();
  });
});

describe('POST /timesheets/:id/resolve-review — already-closed attendance', () => {
  it('clears review without changing the recorded clock-out time', async () => {
    const { timesheet, originalClockOutAt } = await flaggedClosedAttendance();
    const res = await request(app).post(`/timesheets/${timesheet.id}/resolve-review`)
      .set('Authorization', `Bearer ${tokenFor(managerA)}`)
      .send({ reason: 'Reviewed — mock-location flag was a false positive, times look correct.' });

    expect(res.status).toBe(200);
    expect(res.body.data.needsReview).toBe(false);
    expect(new Date(res.body.data.clockOutAt).toISOString()).toBe(new Date(originalClockOutAt).toISOString());

    const audit = await prisma.auditLog.findFirst({
      where: { entityType: 'Timesheet', entityId: timesheet.id, action: 'ATTENDANCE_REVIEW_RESOLVED' },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit.newValue.mode).toBe('REVIEW_CLEARED');
  });

  it('ignores a submitted clockOutTime rather than applying it', async () => {
    const { timesheet, originalClockOutAt } = await flaggedClosedAttendance();
    const attemptedTime = new Date(Date.now() - 999_000).toISOString();
    const res = await request(app).post(`/timesheets/${timesheet.id}/resolve-review`)
      .set('Authorization', `Bearer ${tokenFor(managerA)}`)
      .send({ clockOutTime: attemptedTime });

    expect(res.status).toBe(200);
    expect(new Date(res.body.data.clockOutAt).toISOString()).toBe(new Date(originalClockOutAt).toISOString());
    expect(new Date(res.body.data.clockOutAt).toISOString()).not.toBe(attemptedTime);
  });

  it('rejects a second resolution of an already-cleared record', async () => {
    const { timesheet } = await flaggedClosedAttendance();
    const first = await request(app).post(`/timesheets/${timesheet.id}/resolve-review`)
      .set('Authorization', `Bearer ${tokenFor(managerA)}`).send({});
    expect(first.status).toBe(200);
    const second = await request(app).post(`/timesheets/${timesheet.id}/resolve-review`)
      .set('Authorization', `Bearer ${tokenFor(managerA)}`).send({});
    expect(second.status).toBe(409);
  });
});
