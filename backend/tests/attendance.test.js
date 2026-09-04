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

// House sits at (51.5, -0.12), radius 50 m.
const HOUSE_LAT = 51.5;
const HOUSE_LNG = -0.12;
const OUTSIDE_LAT = 51.51; // ~1.1 km north — well outside
const OUTSIDE_LNG = -0.12;

let agencyA, agencyB, managerA, workerA, houseA, workerB, houseB;

async function mkAgencyWorld(tag) {
  const agency = await prisma.agency.create({ data: { name: `Att ${tag} ${suffix}` } });
  const manager = await prisma.user.create({
    data: { agencyId: agency.id, role: 'MANAGER', name: `Mgr ${tag}`, email: `att-mgr-${tag}-${suffix}@t.test`, passwordHash: 'x' },
  });
  const worker = await prisma.user.create({
    data: { agencyId: agency.id, role: 'WORKER', name: `Wkr ${tag}`, email: `att-wkr-${tag}-${suffix}@t.test`, passwordHash: 'x' },
  });
  const house = await prisma.house.create({
    data: { agencyId: agency.id, name: `House ${tag} ${suffix}`, address: '1 Test St', latitude: HOUSE_LAT, longitude: HOUSE_LNG, geofenceRadius: 50, managerId: manager.id },
  });
  return { agency, manager, worker, house };
}

/** Shift whose window currently contains `now` (unless overridden). */
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
  return request(app)
    .post('/clock/in')
    .set('Authorization', `Bearer ${tokenFor(worker)}`)
    .send({ houseId: house.id, shiftId: shift.id, latitude: HOUSE_LAT, longitude: HOUSE_LNG, accuracy: 10, ...over });
}

async function report(worker, shift, over = {}) {
  return request(app)
    .post('/clock/location')
    .set('Authorization', `Bearer ${tokenFor(worker)}`)
    .send({ shiftId: shift.id, latitude: HOUSE_LAT, longitude: HOUSE_LNG, accuracy: 10, ...over });
}

beforeAll(async () => {
  ({ agency: agencyA, manager: managerA, worker: workerA, house: houseA } = await mkAgencyWorld('A'));
  ({ agency: agencyB, worker: workerB, house: houseB } = await mkAgencyWorld('B'));
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

// ── 1. CLOCK-IN GEOFENCE ENFORCEMENT ─────────────────────────────────────────
describe('clock-in geofence enforcement', () => {
  it('accepts an onsite clock-in and records full evidence', async () => {
    const shift = await mkShift({ agency: agencyA, house: houseA, worker: workerA, manager: managerA });
    const res = await clockIn(workerA, houseA, shift, { accuracy: 8, capturedAt: new Date().toISOString() });
    expect(res.status).toBe(200);

    const evt = await prisma.clockEvent.findFirst({ where: { shiftId: shift.id, type: 'IN' } });
    expect(evt).toEqual(expect.objectContaining({
      type: 'IN', latitude: HOUSE_LAT, longitude: HOUSE_LNG,
      withinGeofence: true, geofenceRadius: 50, verification: 'CLOCK_IN_GEOFENCE_VERIFIED',
      locationStatusResult: 'ONSITE', mockLocationSuspected: false,
    }));
    expect(evt.distanceMeters).toBeLessThan(5);

    const mon = await prisma.attendanceMonitor.findUnique({ where: { shiftId: shift.id } });
    expect(mon).toEqual(expect.objectContaining({ locationStatus: 'ONSITE', closedAt: null }));

    const ts = await prisma.timesheet.findUnique({ where: { shiftId: shift.id } });
    expect(ts.clockInLocationStatus).toBe('ONSITE');
    expect(ts.needsReview).toBe(false);
  });

  it('rejects a clock-in outside the geofence and creates no attendance', async () => {
    const shift = await mkShift({ agency: agencyA, house: houseA, worker: workerA, manager: managerA });
    const res = await clockIn(workerA, houseA, shift, { latitude: OUTSIDE_LAT, longitude: OUTSIDE_LNG, accuracy: 10 });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('OUTSIDE_GEOFENCE');
    expect(res.body.details.distanceMeters).toBeGreaterThan(50);
    expect(res.body.details.geofenceRadius).toBe(50);

    expect(await prisma.clockEvent.count({ where: { shiftId: shift.id } })).toBe(0);
    expect(await prisma.attendanceMonitor.count({ where: { shiftId: shift.id } })).toBe(0);
  });

  it('rejects a clock-in with insufficient GPS accuracy', async () => {
    const shift = await mkShift({ agency: agencyA, house: houseA, worker: workerA, manager: managerA });
    const res = await clockIn(workerA, houseA, shift, { accuracy: 200 });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('GPS_ACCURACY_INSUFFICIENT');
    expect(await prisma.clockEvent.count({ where: { shiftId: shift.id } })).toBe(0);
  });

  it('rejects a stale location reading', async () => {
    const shift = await mkShift({ agency: agencyA, house: houseA, worker: workerA, manager: managerA });
    const staleAt = new Date(Date.now() - ATTENDANCE_DEFAULTS.maxLocationAgeMs - 30_000).toISOString();
    const res = await clockIn(workerA, houseA, shift, { capturedAt: staleAt });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('STALE_LOCATION');
  });

  it('rejects null-island (0,0) coordinates', async () => {
    const shift = await mkShift({ agency: agencyA, house: houseA, worker: workerA, manager: managerA });
    const res = await clockIn(workerA, houseA, shift, { latitude: 0, longitude: 0 });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('INVALID_COORDINATES');
  });

  it('rejects a clock-in with no location at all', async () => {
    const shift = await mkShift({ agency: agencyA, house: houseA, worker: workerA, manager: managerA });
    const res = await request(app)
      .post('/clock/in')
      .set('Authorization', `Bearer ${tokenFor(workerA)}`)
      .send({ houseId: houseA.id, shiftId: shift.id });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('LOCATION_REQUIRED');
  });

  it('flags the timesheet for review when a mock location is suspected', async () => {
    const shift = await mkShift({ agency: agencyA, house: houseA, worker: workerA, manager: managerA });
    const res = await clockIn(workerA, houseA, shift, { mockLocationSuspected: true });
    expect(res.status).toBe(200);
    const ts = await prisma.timesheet.findUnique({ where: { shiftId: shift.id } });
    expect(ts.needsReview).toBe(true);
    expect(ts.reviewReason).toMatch(/mock location/i);
  });
});

// ── 2. CLOCK-OUT ────────────────────────────────────────────────────────────
describe('clock-out', () => {
  it('records an onsite clock-out and does not flag it', async () => {
    const shift = await mkShift({ agency: agencyA, house: houseA, worker: workerA, manager: managerA });
    await clockIn(workerA, houseA, shift);
    const res = await request(app).post('/clock/out')
      .set('Authorization', `Bearer ${tokenFor(workerA)}`)
      .send({ houseId: houseA.id, shiftId: shift.id, latitude: HOUSE_LAT, longitude: HOUSE_LNG, accuracy: 10 });
    expect(res.status).toBe(200);
    const ts = await prisma.timesheet.findUnique({ where: { shiftId: shift.id } });
    expect(ts.clockOutLocationStatus).toBe('ONSITE');
    expect(ts.clockOutMethod).toBe('MANUAL');
    expect(ts.needsReview).toBe(false);
  });

  it('allows an OFF-SITE clock-out, records it as offsite, and keeps it auditable', async () => {
    const shift = await mkShift({ agency: agencyA, house: houseA, worker: workerA, manager: managerA });
    await clockIn(workerA, houseA, shift);
    const res = await request(app).post('/clock/out')
      .set('Authorization', `Bearer ${tokenFor(workerA)}`)
      .send({ houseId: houseA.id, shiftId: shift.id, latitude: OUTSIDE_LAT, longitude: OUTSIDE_LNG, accuracy: 10 });
    expect(res.status).toBe(200); // NOT blocked
    const ts = await prisma.timesheet.findUnique({ where: { shiftId: shift.id } });
    expect(ts.clockOutLocationStatus).toBe('OFFSITE');
    expect(ts.needsReview).toBe(true);
    const evt = await prisma.clockEvent.findFirst({ where: { shiftId: shift.id, type: 'OUT' } });
    expect(evt.verification).toBe('MANUAL_OFFSITE_CLOCK_OUT');
    const audit = await prisma.auditLog.findFirst({ where: { entityId: evt.id, action: 'MANUAL_OFFSITE_CLOCK_OUT' } });
    expect(audit).toBeTruthy();
  });

  it('stops attendance monitoring after clock-out', async () => {
    const shift = await mkShift({ agency: agencyA, house: houseA, worker: workerA, manager: managerA });
    await clockIn(workerA, houseA, shift);
    await request(app).post('/clock/out').set('Authorization', `Bearer ${tokenFor(workerA)}`)
      .send({ houseId: houseA.id, shiftId: shift.id, latitude: HOUSE_LAT, longitude: HOUSE_LNG, accuracy: 10 });
    const mon = await prisma.attendanceMonitor.findUnique({ where: { shiftId: shift.id } });
    expect(mon.closedAt).toBeTruthy();
    const res = await report(workerA, shift, { latitude: OUTSIDE_LAT, longitude: OUTSIDE_LNG });
    expect(res.body.data.active).toBe(false);
  });
});

// ── 8. RACE CONDITIONS / DUPLICATES ─────────────────────────────────────────
describe('races and duplicates', () => {
  it('never creates two IN events under concurrent clock-in', async () => {
    const shift = await mkShift({ agency: agencyA, house: houseA, worker: workerA, manager: managerA });
    const results = await Promise.all(Array.from({ length: 6 }, () => clockIn(workerA, houseA, shift)));
    const statuses = results.map((r) => r.status).sort();
    expect(statuses.filter((s) => s === 200 || s === 409)).toHaveLength(6);
    expect(await prisma.clockEvent.count({ where: { shiftId: shift.id, type: 'IN' } })).toBe(1);
    expect(await prisma.attendanceMonitor.count({ where: { shiftId: shift.id } })).toBe(1);
  });

  it('rejects a duplicate clock-in with 409', async () => {
    const shift = await mkShift({ agency: agencyA, house: houseA, worker: workerA, manager: managerA });
    expect((await clockIn(workerA, houseA, shift)).status).toBe(200);
    const dup = await clockIn(workerA, houseA, shift);
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe('ALREADY_CLOCKED_IN');
  });

  it('rejects a duplicate clock-out with 409 and keeps one OUT event', async () => {
    const shift = await mkShift({ agency: agencyA, house: houseA, worker: workerA, manager: managerA });
    await clockIn(workerA, houseA, shift);
    const out = () => request(app).post('/clock/out').set('Authorization', `Bearer ${tokenFor(workerA)}`)
      .send({ houseId: houseA.id, shiftId: shift.id, latitude: HOUSE_LAT, longitude: HOUSE_LNG, accuracy: 10 });
    expect((await out()).status).toBe(200);
    expect((await out()).status).toBe(409);
    expect(await prisma.clockEvent.count({ where: { shiftId: shift.id, type: 'OUT' } })).toBe(1);
  });
});

// ── 4. GEOFENCE EXIT STATE (debounce) ───────────────────────────────────────
describe('geofence exit while clocked in', () => {
  it('does not confirm an exit from one noisy outside reading', async () => {
    const shift = await mkShift({ agency: agencyA, house: houseA, worker: workerA, manager: managerA });
    await clockIn(workerA, houseA, shift);
    const res = await report(workerA, shift, { latitude: OUTSIDE_LAT, longitude: OUTSIDE_LNG });
    expect(res.body.data.prompt).toBeNull();
    const mon = await prisma.attendanceMonitor.findUnique({ where: { shiftId: shift.id } });
    expect(mon.geofenceExitConfirmedAt).toBeNull();
    expect(mon.consecutiveOutsideCount).toBe(1);
  });

  it('confirms an exit after the debounce threshold and prompts "still working?"', async () => {
    const shift = await mkShift({ agency: agencyA, house: houseA, worker: workerA, manager: managerA });
    await clockIn(workerA, houseA, shift);
    let res;
    for (let i = 0; i < ATTENDANCE_DEFAULTS.exitConfirmReadings; i++) {
      res = await report(workerA, shift, { latitude: OUTSIDE_LAT, longitude: OUTSIDE_LNG });
    }
    expect(res.body.data.prompt).toBe('LEFT_GEOFENCE_STILL_WORKING');
    const mon = await prisma.attendanceMonitor.findUnique({ where: { shiftId: shift.id } });
    expect(mon.geofenceExitConfirmedAt).toBeTruthy();
    expect(mon.locationStatus).toBe('OFFSITE');
    // Still clocked in — no OUT event.
    expect(await prisma.clockEvent.count({ where: { shiftId: shift.id, type: 'OUT' } })).toBe(0);
    const audit = await prisma.auditLog.findFirst({ where: { entityId: shift.id, action: 'GEOFENCE_EXIT_CONFIRMED' } });
    expect(audit).toBeTruthy();
  });

  it('"still working" suppresses further exit prompts and stops any auto clock-out', async () => {
    const shift = await mkShift({ agency: agencyA, house: houseA, worker: workerA, manager: managerA });
    await clockIn(workerA, houseA, shift);
    for (let i = 0; i < 3; i++) await report(workerA, shift, { latitude: OUTSIDE_LAT, longitude: OUTSIDE_LNG });
    const ack = await request(app).post('/clock/still-working')
      .set('Authorization', `Bearer ${tokenFor(workerA)}`).send({ shiftId: shift.id });
    expect(ack.status).toBe(200);
    const mon = await prisma.attendanceMonitor.findUnique({ where: { shiftId: shift.id } });
    expect(mon.stillWorkingConfirmedAt).toBeTruthy();
    expect(mon.exitPromptSnoozedUntil.getTime()).toBeGreaterThan(Date.now());
    const res = await report(workerA, shift, { latitude: OUTSIDE_LAT, longitude: OUTSIDE_LNG });
    expect(res.body.data.prompt).toBeNull();
    const audit = await prisma.auditLog.findFirst({ where: { entityId: shift.id, action: 'WORKER_CONFIRMED_STILL_WORKING' } });
    expect(audit).toBeTruthy();
  });

  it('detects a return onsite and clears the exit state', async () => {
    const shift = await mkShift({ agency: agencyA, house: houseA, worker: workerA, manager: managerA });
    await clockIn(workerA, houseA, shift);
    for (let i = 0; i < 3; i++) await report(workerA, shift, { latitude: OUTSIDE_LAT, longitude: OUTSIDE_LNG });
    const back = await report(workerA, shift); // back at house coords
    expect(back.body.data.locationStatus).toBe('ONSITE');
    const mon = await prisma.attendanceMonitor.findUnique({ where: { shiftId: shift.id } });
    expect(mon.geofenceExitConfirmedAt).toBeNull();
    const audit = await prisma.auditLog.findFirst({ where: { entityId: shift.id, action: 'WORKER_RETURNED_ONSITE' } });
    expect(audit).toBeTruthy();
  });
});

// ── 5 & 6. SHIFT END + AUTO CLOCK-OUT GRACE MACHINE ─────────────────────────
describe('shift end and auto clock-out', () => {
  // Worker clocks in normally, THEN the scheduled end passes while still clocked in.
  async function endedShiftClockedIn() {
    const shift = await mkShift({ agency: agencyA, house: houseA, worker: workerA, manager: managerA });
    const res = await clockIn(workerA, houseA, shift, { accuracy: 10 });
    expect(res.status).toBe(200);
    await prisma.shift.update({ where: { id: shift.id }, data: { endTime: new Date(Date.now() - 3_600_000) } });
    return prisma.shift.findUnique({ where: { id: shift.id } });
  }

  it('scheduled end while still onsite does NOT clock out — it only prompts', async () => {
    const shift = await endedShiftClockedIn();
    await attendanceJob(new Date());
    expect(await prisma.clockEvent.count({ where: { shiftId: shift.id, type: 'OUT' } })).toBe(0);
    const mon = await prisma.attendanceMonitor.findUnique({ where: { shiftId: shift.id } });
    expect(mon.shiftEndPromptedAt).toBeTruthy();
    expect(mon.closedAt).toBeNull();
    const audit = await prisma.auditLog.findFirst({ where: { entityId: shift.id, action: 'SHIFT_END_REACHED' } });
    expect(audit).toBeTruthy();
  });

  it('leaving after scheduled end prompts SHIFT_ENDED_AND_LEFT and starts the grace clock', async () => {
    const shift = await endedShiftClockedIn();
    let res;
    for (let i = 0; i < 3; i++) res = await report(workerA, shift, { latitude: OUTSIDE_LAT, longitude: OUTSIDE_LNG });
    expect(res.body.data.prompt).toBe('SHIFT_ENDED_AND_LEFT');
    const mon = await prisma.attendanceMonitor.findUnique({ where: { shiftId: shift.id } });
    expect(mon.geofenceExitConfirmedAt).toBeTruthy();
    expect(mon.autoClockOutGraceStartedAt).toBeTruthy();
    expect(await prisma.clockEvent.count({ where: { shiftId: shift.id, type: 'OUT' } })).toBe(0);
  });

  it('sends a reminder before the grace period elapses, and does not clock out yet', async () => {
    const shift = await endedShiftClockedIn();
    for (let i = 0; i < 3; i++) await report(workerA, shift, { latitude: OUTSIDE_LAT, longitude: OUTSIDE_LNG });
    // grace started ~now; run job just past the reminder mark
    const t = new Date(Date.now() + ATTENDANCE_DEFAULTS.autoClockOutReminderMs + 5_000);
    await attendanceJob(t);
    const mon = await prisma.attendanceMonitor.findUnique({ where: { shiftId: shift.id } });
    expect(mon.autoClockOutReminderSentAt).toBeTruthy();
    expect(await prisma.clockEvent.count({ where: { shiftId: shift.id, type: 'OUT' } })).toBe(0);
  });

  it('auto clock-out ONLY after grace, with strong evidence — records reason + review flag', async () => {
    const shift = await endedShiftClockedIn();
    for (let i = 0; i < 3; i++) await report(workerA, shift, { latitude: OUTSIDE_LAT, longitude: OUTSIDE_LNG });
    const t = new Date(Date.now() + ATTENDANCE_DEFAULTS.autoClockOutGraceMs + 5_000);
    await attendanceJob(t);
    const out = await prisma.clockEvent.findFirst({ where: { shiftId: shift.id, type: 'OUT' } });
    expect(out).toBeTruthy();
    expect(out.method).toBe('AUTO');
    expect(out.verification).toBe('AUTO_CLOCK_OUT_AFTER_SHIFT_EXIT');
    const ts = await prisma.timesheet.findUnique({ where: { shiftId: shift.id } });
    expect(ts.needsReview).toBe(true);
    expect(ts.clockOutMethod).toBe('AUTO');
    const mon = await prisma.attendanceMonitor.findUnique({ where: { shiftId: shift.id } });
    expect(mon.closedAt).toBeTruthy();
    const audit = await prisma.auditLog.findFirst({ where: { action: 'AUTO_CLOCK_OUT_AFTER_SHIFT_EXIT', entityId: out.id } });
    expect(audit).toBeTruthy();
    expect(audit.newValue).toEqual(expect.objectContaining({ stillWorkingConfirmed: false }));
  });

  it('does NOT auto clock-out when the worker confirmed they are still working', async () => {
    const shift = await endedShiftClockedIn();
    for (let i = 0; i < 3; i++) await report(workerA, shift, { latitude: OUTSIDE_LAT, longitude: OUTSIDE_LNG });
    await request(app).post('/clock/still-working').set('Authorization', `Bearer ${tokenFor(workerA)}`).send({ shiftId: shift.id });
    const t = new Date(Date.now() + ATTENDANCE_DEFAULTS.autoClockOutGraceMs + 60_000);
    await attendanceJob(t);
    expect(await prisma.clockEvent.count({ where: { shiftId: shift.id, type: 'OUT' } })).toBe(0);
  });

  async function staleUncertainMonitor() {
    const shift = await endedShiftClockedIn();
    for (let i = 0; i < 3; i++) await report(workerA, shift, { latitude: OUTSIDE_LAT, longitude: OUTSIDE_LNG });
    // Make the latest reading older than the evidence-age ceiling.
    await prisma.attendanceMonitor.update({
      where: { shiftId: shift.id },
      data: { lastReadingAt: new Date(Date.now() - ATTENDANCE_DEFAULTS.autoClockOutMaxEvidenceAgeMs - 60_000) },
    });
    return shift;
  }

  it('does NOT clock out or close the monitor when GPS evidence is stale/inconclusive', async () => {
    const shift = await staleUncertainMonitor();
    const t = new Date(Date.now() + ATTENDANCE_DEFAULTS.autoClockOutGraceMs + 5_000);
    await attendanceJob(t);

    // No clock-out, worker still clocked in.
    expect(await prisma.clockEvent.count({ where: { shiftId: shift.id, type: 'OUT' } })).toBe(0);
    const ts = await prisma.timesheet.findUnique({ where: { shiftId: shift.id } });
    expect(ts.clockOutAt).toBeNull();
    expect(ts.needsReview).toBe(true);
    expect(ts.reviewReason).toMatch(/manager review/i);

    // Monitor stays OPEN and keeps accepting reports.
    const mon = await prisma.attendanceMonitor.findUnique({ where: { shiftId: shift.id } });
    expect(mon.closedAt).toBeNull();
    expect(mon.flaggedForReviewAt).toBeTruthy();

    const audit = await prisma.auditLog.findMany({ where: { entityId: shift.id, action: 'ATTENDANCE_FLAGGED_FOR_REVIEW' } });
    expect(audit).toHaveLength(1);
  });

  it('does not spam duplicate review audit records on repeated cron runs', async () => {
    const shift = await staleUncertainMonitor();
    for (let i = 0; i < 4; i++) {
      await attendanceJob(new Date(Date.now() + ATTENDANCE_DEFAULTS.autoClockOutGraceMs + i * 60_000 + 5_000));
    }
    const audits = await prisma.auditLog.findMany({ where: { entityId: shift.id, action: 'ATTENDANCE_FLAGGED_FOR_REVIEW' } });
    expect(audits).toHaveLength(1);
    expect(await prisma.clockEvent.count({ where: { shiftId: shift.id, type: 'OUT' } })).toBe(0);
  });

  it('resumes the state machine and auto-clocks-out once later GPS evidence is strong again', async () => {
    const shift = await staleUncertainMonitor();
    await attendanceJob(new Date(Date.now() + ATTENDANCE_DEFAULTS.autoClockOutGraceMs + 5_000)); // flags, stays open
    let mon = await prisma.attendanceMonitor.findUnique({ where: { shiftId: shift.id } });
    expect(mon.closedAt).toBeNull();

    // A fresh, valid outside reading arrives.
    const res = await report(workerA, shift, { latitude: OUTSIDE_LAT, longitude: OUTSIDE_LNG, accuracy: 8 });
    expect(res.body.data.active).toBe(true);

    await attendanceJob(new Date(Date.now() + ATTENDANCE_DEFAULTS.autoClockOutGraceMs + 90_000));
    const out = await prisma.clockEvent.findFirst({ where: { shiftId: shift.id, type: 'OUT' } });
    expect(out).toBeTruthy();
    expect(out.verification).toBe('AUTO_CLOCK_OUT_AFTER_SHIFT_EXIT');
    mon = await prisma.attendanceMonitor.findUnique({ where: { shiftId: shift.id } });
    expect(mon.closedAt).toBeTruthy();
  });

  it('a manual clock-out still closes an uncertain/flagged attendance normally', async () => {
    const shift = await staleUncertainMonitor();
    await attendanceJob(new Date(Date.now() + ATTENDANCE_DEFAULTS.autoClockOutGraceMs + 5_000));
    const res = await request(app).post('/clock/out')
      .set('Authorization', `Bearer ${tokenFor(workerA)}`)
      .send({ houseId: houseA.id, shiftId: shift.id, latitude: OUTSIDE_LAT, longitude: OUTSIDE_LNG, accuracy: 10 });
    expect(res.status).toBe(200);
    const ts = await prisma.timesheet.findUnique({ where: { shiftId: shift.id } });
    expect(ts.clockOutAt).toBeTruthy();
    const mon = await prisma.attendanceMonitor.findUnique({ where: { shiftId: shift.id } });
    expect(mon.closedAt).toBeTruthy();
  });
});

// ── 3 & security. LIFECYCLE / RECONCILIATION / CROSS-AGENCY ─────────────────
describe('lifecycle & cross-agency', () => {
  it('reconciles a monitor when the shift is cancelled', async () => {
    const shift = await mkShift({ agency: agencyA, house: houseA, worker: workerA, manager: managerA });
    await clockIn(workerA, houseA, shift);
    await prisma.shift.update({ where: { id: shift.id }, data: { status: 'CANCELLED' } });
    const res = await report(workerA, shift);
    expect(res.body.data.active).toBe(false);
    expect(res.body.data.reason).toBe('SHIFT_CANCELLED');
    const mon = await prisma.attendanceMonitor.findUnique({ where: { shiftId: shift.id } });
    expect(mon.closedAt).toBeTruthy();
  });

  it('reconciles a monitor when the shift was closed by another device/admin', async () => {
    const shift = await mkShift({ agency: agencyA, house: houseA, worker: workerA, manager: managerA });
    await clockIn(workerA, houseA, shift);
    await prisma.timesheet.update({ where: { shiftId: shift.id }, data: { clockOutAt: new Date() } });
    const res = await report(workerA, shift);
    expect(res.body.data.active).toBe(false);
    expect(res.body.data.reason).toBe('ALREADY_CLOSED');
  });

  it('blocks clocking into a shift from another agency', async () => {
    const shift = await mkShift({ agency: agencyA, house: houseA, worker: workerA, manager: managerA });
    const res = await request(app).post('/clock/in')
      .set('Authorization', `Bearer ${tokenFor(workerB)}`)
      .send({ houseId: houseA.id, shiftId: shift.id, latitude: HOUSE_LAT, longitude: HOUSE_LNG, accuracy: 10 });
    expect(res.status).toBe(403);
  });

  it('does not report location into another agency\'s shift', async () => {
    const shift = await mkShift({ agency: agencyA, house: houseA, worker: workerA, manager: managerA });
    await clockIn(workerA, houseA, shift);
    const res = await report(workerB, shift);
    expect(res.body.data.active).toBe(false);
  });
});

// ── 10. LIVE-LOCATION RETENTION ─────────────────────────────────────────────
describe('closed monitors retain no live coordinates', () => {
  const NO_LIVE_COORDS = { lastLatitude: null, lastLongitude: null, lastAccuracy: null, lastDistanceMeters: null };

  async function clockedInWithLiveCoords() {
    const shift = await mkShift({ agency: agencyA, house: houseA, worker: workerA, manager: managerA });
    await clockIn(workerA, houseA, shift);
    await report(workerA, shift, { latitude: HOUSE_LAT, longitude: HOUSE_LNG, accuracy: 9 });
    const before = await prisma.attendanceMonitor.findUnique({ where: { shiftId: shift.id } });
    expect(before.lastLatitude).not.toBeNull(); // sanity: coords were held while active
    return shift;
  }

  it('clears live coordinates on a manual clock-out', async () => {
    const shift = await clockedInWithLiveCoords();
    await request(app).post('/clock/out').set('Authorization', `Bearer ${tokenFor(workerA)}`)
      .send({ houseId: houseA.id, shiftId: shift.id, latitude: HOUSE_LAT, longitude: HOUSE_LNG, accuracy: 9 });
    const mon = await prisma.attendanceMonitor.findUnique({ where: { shiftId: shift.id } });
    expect(mon).toEqual(expect.objectContaining({ closedAt: expect.anything(), ...NO_LIVE_COORDS }));
  });

  it('clears live coordinates on an automatic clock-out', async () => {
    const shift = await mkShift({ agency: agencyA, house: houseA, worker: workerA, manager: managerA });
    await clockIn(workerA, houseA, shift);
    await prisma.shift.update({ where: { id: shift.id }, data: { endTime: new Date(Date.now() - 3_600_000) } });
    for (let i = 0; i < 3; i++) await report(workerA, shift, { latitude: OUTSIDE_LAT, longitude: OUTSIDE_LNG, accuracy: 8 });
    await attendanceJob(new Date(Date.now() + ATTENDANCE_DEFAULTS.autoClockOutGraceMs + 5_000));
    const mon = await prisma.attendanceMonitor.findUnique({ where: { shiftId: shift.id } });
    expect(mon.closedAt).toBeTruthy();
    expect(mon).toEqual(expect.objectContaining(NO_LIVE_COORDS));
  });

  it('clears live coordinates when reconciled after a shift cancellation', async () => {
    const shift = await clockedInWithLiveCoords();
    await prisma.shift.update({ where: { id: shift.id }, data: { status: 'CANCELLED' } });
    await report(workerA, shift); // triggers reconcile → closeMonitor
    const mon = await prisma.attendanceMonitor.findUnique({ where: { shiftId: shift.id } });
    expect(mon.closedAt).toBeTruthy();
    expect(mon).toEqual(expect.objectContaining(NO_LIVE_COORDS));
  });

  it('clears live coordinates when the shift was closed by another device/admin', async () => {
    const shift = await clockedInWithLiveCoords();
    await prisma.timesheet.update({ where: { shiftId: shift.id }, data: { clockOutAt: new Date() } });
    await report(workerA, shift); // reconcile
    const mon = await prisma.attendanceMonitor.findUnique({ where: { shiftId: shift.id } });
    expect(mon.closedAt).toBeTruthy();
    expect(mon).toEqual(expect.objectContaining(NO_LIVE_COORDS));
  });

  it('keeps the discrete ClockEvent clock-in evidence intact after closure', async () => {
    const shift = await clockedInWithLiveCoords();
    await request(app).post('/clock/out').set('Authorization', `Bearer ${tokenFor(workerA)}`)
      .send({ houseId: houseA.id, shiftId: shift.id, latitude: HOUSE_LAT, longitude: HOUSE_LNG, accuracy: 9 });
    const inEvt = await prisma.clockEvent.findFirst({ where: { shiftId: shift.id, type: 'IN' } });
    expect(inEvt.latitude).toBe(HOUSE_LAT);
    expect(inEvt.longitude).toBe(HOUSE_LNG);
    expect(inEvt.distanceMeters).not.toBeNull();
    const outEvt = await prisma.clockEvent.findFirst({ where: { shiftId: shift.id, type: 'OUT' } });
    expect(outEvt.latitude).toBe(HOUSE_LAT);
  });
});
