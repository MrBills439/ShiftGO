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

// Recurring Fixed Work Patterns V1 — Phase 1 (data model + pattern CRUD only;
// no generation, no cron, no Shift creation from a pattern). Every effective
// date used below is far in the future/spread apart so unrelated test cases
// (and their workers' ACTIVE patterns) never overlap each other.

function tokenFor(user) {
  return signAccess({ id: user.id, agencyId: user.agencyId, role: user.role, name: user.name, email: user.email });
}

const MON_FRI_9_5 = [1, 2, 3, 4, 5].map((weekday) => ({ weekday, startTime: '09:00', endTime: '17:00' })); // 40h/wk
const ALL_WEEK_10H = [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, startTime: '08:00', endTime: '18:00' })); // 70h/wk

describe('Recurring Fixed Work Patterns V1 (Phase 1)', () => {
  let agencyA;
  let agencyB;
  let hr;
  let manager;
  let teamLeader;
  let worker;
  let deactivatedWorker;
  let workerB;
  let locationA;
  let inactiveLocationA;
  let locationB;

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

  beforeAll(async () => {
    agencyA = await prisma.agency.create({ data: { name: `FWP Agency A ${suffix}` } });
    agencyB = await prisma.agency.create({ data: { name: `FWP Agency B ${suffix}` } });

    hr = await makeUser(agencyA.id, 'HR', 'FWP HR');
    manager = await makeUser(agencyA.id, 'MANAGER', 'FWP Manager');
    teamLeader = await makeUser(agencyA.id, 'TEAM_LEADER', 'FWP TeamLeader');
    worker = await makeUser(agencyA.id, 'WORKER', 'FWP Worker');
    deactivatedWorker = await makeUser(agencyA.id, 'WORKER', 'FWP Deactivated Worker', 'DEACTIVATED');
    workerB = await makeUser(agencyB.id, 'WORKER', 'FWP Worker B');

    locationA = await prisma.location.create({
      data: { agencyId: agencyA.id, name: `FWP Head Office ${suffix}`, type: 'OFFICE', active: true },
    });
    inactiveLocationA = await prisma.location.create({
      data: { agencyId: agencyA.id, name: `FWP Closed Office ${suffix}`, type: 'OFFICE', active: false },
    });
    locationB = await prisma.location.create({
      data: { agencyId: agencyB.id, name: `FWP Agency B Office ${suffix}`, type: 'OFFICE', active: true },
    });
  });

  afterAll(async () => {
    await prisma.fixedWorkPatternDay.deleteMany({ where: { pattern: { agencyId: { in: [agencyA.id, agencyB.id] } } } });
    await prisma.fixedWorkPattern.deleteMany({ where: { agencyId: { in: [agencyA.id, agencyB.id] } } });
    await prisma.auditLog.deleteMany({ where: { agencyId: { in: [agencyA.id, agencyB.id] } } });
    await prisma.timesheet.deleteMany({ where: { agencyId: { in: [agencyA.id, agencyB.id] } } });
    await prisma.clockEvent.deleteMany({ where: { agencyId: { in: [agencyA.id, agencyB.id] } } });
    await prisma.attendanceMonitor.deleteMany({ where: { agencyId: { in: [agencyA.id, agencyB.id] } } });
    await prisma.shift.deleteMany({ where: { agencyId: { in: [agencyA.id, agencyB.id] } } });
    await prisma.location.deleteMany({ where: { agencyId: { in: [agencyA.id, agencyB.id] } } });
    await prisma.user.deleteMany({ where: { agencyId: { in: [agencyA.id, agencyB.id] } } });
    await prisma.agency.deleteMany({ where: { id: { in: [agencyA.id, agencyB.id] } } });
    await prisma.$disconnect();
  });

  function createBody(overrides = {}) {
    return {
      workerId: worker.id,
      locationId: locationA.id,
      effectiveFrom: '2031-01-06', // a Monday, far from every other test's range
      days: MON_FRI_9_5,
      ...overrides,
    };
  }

  // ── 1-4: who can create ────────────────────────────────────────────────
  it('1. HR creates a pattern', async () => {
    const w = await makeUser(agencyA.id, 'WORKER', 'FWP Create HR');
    const res = await request(app).post('/fixed-work-patterns').set('Authorization', `Bearer ${tokenFor(hr)}`)
      .send(createBody({ workerId: w.id, effectiveFrom: '2031-02-03' }));
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('ACTIVE');
    expect(res.body.data.days).toHaveLength(5);
  });

  it('2. MANAGER creates a pattern', async () => {
    const w = await makeUser(agencyA.id, 'WORKER', 'FWP Create Manager');
    const res = await request(app).post('/fixed-work-patterns').set('Authorization', `Bearer ${tokenFor(manager)}`)
      .send(createBody({ workerId: w.id, effectiveFrom: '2031-02-10' }));
    expect(res.status).toBe(201);
  });

  it('3. TEAM_LEADER cannot create a pattern', async () => {
    const res = await request(app).post('/fixed-work-patterns').set('Authorization', `Bearer ${tokenFor(teamLeader)}`)
      .send(createBody({ effectiveFrom: '2031-02-17' }));
    expect(res.status).toBe(403);
  });

  it('4. WORKER cannot create a pattern', async () => {
    const res = await request(app).post('/fixed-work-patterns').set('Authorization', `Bearer ${tokenFor(worker)}`)
      .send(createBody({ effectiveFrom: '2031-02-24' }));
    expect(res.status).toBe(403);
  });

  // ── 5-8: agency/status scoping on the two targets ──────────────────────
  it('5. other-agency employee rejected', async () => {
    const res = await request(app).post('/fixed-work-patterns').set('Authorization', `Bearer ${tokenFor(hr)}`)
      .send(createBody({ workerId: workerB.id, effectiveFrom: '2031-03-03' }));
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('WORKER_NOT_IN_AGENCY');
  });

  it('6. DEACTIVATED employee rejected', async () => {
    const res = await request(app).post('/fixed-work-patterns').set('Authorization', `Bearer ${tokenFor(hr)}`)
      .send(createBody({ workerId: deactivatedWorker.id, effectiveFrom: '2031-03-10' }));
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('WORKER_NOT_ACTIVE');
  });

  it('7. other-agency Location rejected', async () => {
    const w = await makeUser(agencyA.id, 'WORKER', 'FWP Loc OtherAgency');
    const res = await request(app).post('/fixed-work-patterns').set('Authorization', `Bearer ${tokenFor(hr)}`)
      .send(createBody({ workerId: w.id, locationId: locationB.id, effectiveFrom: '2031-03-17' }));
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('LOCATION_NOT_IN_AGENCY');
  });

  it('8. inactive Location rejected', async () => {
    const w = await makeUser(agencyA.id, 'WORKER', 'FWP Loc Inactive');
    const res = await request(app).post('/fixed-work-patterns').set('Authorization', `Bearer ${tokenFor(hr)}`)
      .send(createBody({ workerId: w.id, locationId: inactiveLocationA.id, effectiveFrom: '2031-03-24' }));
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('LOCATION_INACTIVE');
  });

  // ── 9-13: day/time/range shape rules ───────────────────────────────────
  it('9. duplicate weekday rejected', async () => {
    const w = await makeUser(agencyA.id, 'WORKER', 'FWP Dup Weekday');
    const res = await request(app).post('/fixed-work-patterns').set('Authorization', `Bearer ${tokenFor(hr)}`)
      .send(createBody({
        workerId: w.id,
        effectiveFrom: '2031-03-31',
        days: [{ weekday: 1, startTime: '09:00', endTime: '17:00' }, { weekday: 1, startTime: '10:00', endTime: '18:00' }],
      }));
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('DUPLICATE_WEEKDAY');
  });

  it('10. no working days rejected', async () => {
    const w = await makeUser(agencyA.id, 'WORKER', 'FWP No Days');
    const res = await request(app).post('/fixed-work-patterns').set('Authorization', `Bearer ${tokenFor(hr)}`)
      .send(createBody({ workerId: w.id, effectiveFrom: '2031-04-07', days: [] }));
    expect(res.status).toBe(400);
  });

  it('11. invalid time rejected', async () => {
    const w = await makeUser(agencyA.id, 'WORKER', 'FWP Bad Time');
    const res = await request(app).post('/fixed-work-patterns').set('Authorization', `Bearer ${tokenFor(hr)}`)
      .send(createBody({ workerId: w.id, effectiveFrom: '2031-04-14', days: [{ weekday: 1, startTime: '9:00', endTime: '25:00' }] }));
    expect(res.status).toBe(400);
  });

  it('12. overnight pattern rejected in V1', async () => {
    const w = await makeUser(agencyA.id, 'WORKER', 'FWP Overnight');
    const res = await request(app).post('/fixed-work-patterns').set('Authorization', `Bearer ${tokenFor(hr)}`)
      .send(createBody({ workerId: w.id, effectiveFrom: '2031-04-21', days: [{ weekday: 1, startTime: '22:00', endTime: '06:00' }] }));
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('OVERNIGHT_NOT_SUPPORTED');
  });

  it('13. invalid effective range rejected (effectiveTo before effectiveFrom)', async () => {
    const w = await makeUser(agencyA.id, 'WORKER', 'FWP Bad Range');
    const res = await request(app).post('/fixed-work-patterns').set('Authorization', `Bearer ${tokenFor(hr)}`)
      .send(createBody({ workerId: w.id, effectiveFrom: '2031-05-01', effectiveTo: '2031-04-01' }));
    expect(res.status).toBe(400);
  });

  // ── 14: effective-period conflict ──────────────────────────────────────
  it('14. conflicting active/effective pattern rejected', async () => {
    const w = await makeUser(agencyA.id, 'WORKER', 'FWP Conflict');
    const first = await request(app).post('/fixed-work-patterns').set('Authorization', `Bearer ${tokenFor(hr)}`)
      .send(createBody({ workerId: w.id, effectiveFrom: '2032-01-04' })); // open-ended
    expect(first.status).toBe(201);

    const second = await request(app).post('/fixed-work-patterns').set('Authorization', `Bearer ${tokenFor(hr)}`)
      .send(createBody({ workerId: w.id, effectiveFrom: '2032-02-01' })); // overlaps the open-ended first one
    expect(second.status).toBe(409);
    expect(second.body.code).toBe('FIXED_WORK_PATTERN_CONFLICT');
  });

  // ── 15-19: weekly hours ─────────────────────────────────────────────────
  it('15. weekly hours within limit succeeds', async () => {
    const w = await makeUser(agencyA.id, 'WORKER', 'FWP Hours OK');
    const res = await request(app).post('/fixed-work-patterns').set('Authorization', `Bearer ${tokenFor(hr)}`)
      .send(createBody({ workerId: w.id, effectiveFrom: '2032-03-01' })); // Mon-Fri 9-5 = 40h
    expect(res.status).toBe(201);
    expect(res.body.data.overrideWeeklyLimit).toBe(false);
  });

  it('16. weekly hours above limit without override rejected', async () => {
    const w = await makeUser(agencyA.id, 'WORKER', 'FWP Hours Over NoOverride');
    const res = await request(app).post('/fixed-work-patterns').set('Authorization', `Bearer ${tokenFor(hr)}`)
      .send(createBody({ workerId: w.id, effectiveFrom: '2032-03-08', days: ALL_WEEK_10H })); // 70h > default 60h max
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('APPROVAL_REQUIRED');
  });

  let overrideWorker;
  let overridePatternId;
  it('17. authorised override + reason succeeds', async () => {
    overrideWorker = await makeUser(agencyA.id, 'WORKER', 'FWP Hours Override OK');
    const res = await request(app).post('/fixed-work-patterns').set('Authorization', `Bearer ${tokenFor(hr)}`)
      .send(createBody({
        workerId: overrideWorker.id, effectiveFrom: '2032-03-15', days: ALL_WEEK_10H,
        overrideWeeklyLimit: true, overrideReason: 'Agreed temporary cover arrangement',
      }));
    expect(res.status).toBe(201);
    expect(res.body.data.overrideWeeklyLimit).toBe(true);
    expect(res.body.data.overrideReason).toBe('Agreed temporary cover arrangement');
    overridePatternId = res.body.data.id;
  });

  it('18. override without reason rejected', async () => {
    const w = await makeUser(agencyA.id, 'WORKER', 'FWP Hours Override NoReason');
    const res = await request(app).post('/fixed-work-patterns').set('Authorization', `Bearer ${tokenFor(hr)}`)
      .send(createBody({ workerId: w.id, effectiveFrom: '2032-03-22', days: ALL_WEEK_10H, overrideWeeklyLimit: true }));
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('OVERRIDE_REASON_REQUIRED');
  });

  it('19. override is audited', async () => {
    const logs = await prisma.auditLog.findMany({
      where: { agencyId: agencyA.id, action: 'FIXED_WORK_PATTERN_WEEKLY_HOURS_OVERRIDE', entityId: overridePatternId },
    });
    expect(logs.length).toBeGreaterThanOrEqual(1);
    expect(logs[0].newValue.reason).toBe('Agreed temporary cover arrangement');
  });

  // ── 20-23: supersede ────────────────────────────────────────────────────
  let supersedeWorker;
  let oldPatternId;
  beforeAll(async () => {
    supersedeWorker = await makeUser(agencyA.id, 'WORKER', 'FWP Supersede Subject');
  });

  it('sets up the pattern to supersede', async () => {
    const res = await request(app).post('/fixed-work-patterns').set('Authorization', `Bearer ${tokenFor(hr)}`)
      .send(createBody({ workerId: supersedeWorker.id, effectiveFrom: '2033-01-03' }));
    expect(res.status).toBe(201);
    oldPatternId = res.body.data.id;
  });

  it('20. supersede creates a new version', async () => {
    const res = await request(app).post(`/fixed-work-patterns/${oldPatternId}/supersede`).set('Authorization', `Bearer ${tokenFor(hr)}`)
      .send({ locationId: locationA.id, effectiveFrom: '2033-06-06', days: [{ weekday: 1, startTime: '10:00', endTime: '18:00' }] });
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('ACTIVE');
    expect(res.body.data.supersedes.id).toBe(oldPatternId);
    expect(res.body.data.workerId).toBe(supersedeWorker.id);
  });

  it('21. supersede preserves old pattern days', async () => {
    const res = await request(app).get(`/fixed-work-patterns/${oldPatternId}`).set('Authorization', `Bearer ${tokenFor(hr)}`);
    expect(res.status).toBe(200);
    expect(res.body.data.days).toHaveLength(5);
    expect(res.body.data.days.map((d) => d.weekday)).toEqual([1, 2, 3, 4, 5]);
  });

  it('22. supersede closes the old effective range', async () => {
    const res = await request(app).get(`/fixed-work-patterns/${oldPatternId}`).set('Authorization', `Bearer ${tokenFor(hr)}`);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('SUPERSEDED');
    expect(new Date(res.body.data.effectiveTo).toISOString().slice(0, 10)).toBe('2033-06-05');
  });

  it('23. a failed supersede leaves no partial state', async () => {
    const w2 = await makeUser(agencyA.id, 'WORKER', 'FWP Supersede Subject 2');
    const setup = await request(app).post('/fixed-work-patterns').set('Authorization', `Bearer ${tokenFor(hr)}`)
      .send(createBody({ workerId: w2.id, effectiveFrom: '2034-01-02' }));
    expect(setup.status).toBe(201);
    const patternId = setup.body.data.id;

    const failed = await request(app).post(`/fixed-work-patterns/${patternId}/supersede`).set('Authorization', `Bearer ${tokenFor(hr)}`)
      .send({ locationId: locationB.id, effectiveFrom: '2034-06-01', days: MON_FRI_9_5 }); // other-agency location
    expect(failed.status).toBe(403);

    const stillOld = await request(app).get(`/fixed-work-patterns/${patternId}`).set('Authorization', `Bearer ${tokenFor(hr)}`);
    expect(stillOld.body.data.status).toBe('ACTIVE');
    expect(stillOld.body.data.effectiveTo).toBeNull();
    expect(stillOld.body.data.supersededBy).toBeNull();
  });

  // ── 24-25: end ──────────────────────────────────────────────────────────
  let endPatternId;
  it('24. end pattern works', async () => {
    const w = await makeUser(agencyA.id, 'WORKER', 'FWP End Subject');
    const setup = await request(app).post('/fixed-work-patterns').set('Authorization', `Bearer ${tokenFor(hr)}`)
      .send(createBody({ workerId: w.id, effectiveFrom: '2035-01-01' }));
    endPatternId = setup.body.data.id;

    const res = await request(app).post(`/fixed-work-patterns/${endPatternId}/end`).set('Authorization', `Bearer ${tokenFor(hr)}`)
      .send({ effectiveTo: '2035-06-30' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('ENDED');
    expect(new Date(res.body.data.effectiveTo).toISOString().slice(0, 10)).toBe('2035-06-30');
  });

  it('25. end pattern does not delete it', async () => {
    const res = await request(app).get(`/fixed-work-patterns/${endPatternId}`).set('Authorization', `Bearer ${tokenFor(hr)}`);
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(endPatternId);
  });

  // ── 26-27: history safety ──────────────────────────────────────────────
  it('26-27. pattern operations never modify Shift/attendance history', async () => {
    const shiftWorker = await makeUser(agencyA.id, 'WORKER', 'FWP Shift History Subject');
    const shift = await prisma.shift.create({
      data: {
        agencyId: agencyA.id,
        workerId: shiftWorker.id,
        createdById: hr.id,
        kind: 'FIXED',
        locationId: locationA.id,
        startTime: new Date('2036-01-06T09:00:00.000Z'),
        endTime: new Date('2036-01-06T17:00:00.000Z'),
        date: new Date('2036-01-06T00:00:00.000Z'),
      },
    });
    const before = await prisma.shift.findUnique({ where: { id: shift.id } });
    const [clockEventsBefore, timesheetsBefore, monitorsBefore] = await Promise.all([
      prisma.clockEvent.count({ where: { shiftId: shift.id } }),
      prisma.timesheet.count({ where: { shiftId: shift.id } }),
      prisma.attendanceMonitor.count({ where: { shiftId: shift.id } }),
    ]);

    // Run a full create -> supersede -> end cycle, unrelated to this shift.
    const w = await makeUser(agencyA.id, 'WORKER', 'FWP History Noise');
    const created = await request(app).post('/fixed-work-patterns').set('Authorization', `Bearer ${tokenFor(hr)}`)
      .send(createBody({ workerId: w.id, effectiveFrom: '2036-02-02' }));
    await request(app).post(`/fixed-work-patterns/${created.body.data.id}/supersede`).set('Authorization', `Bearer ${tokenFor(hr)}`)
      .send({ locationId: locationA.id, effectiveFrom: '2036-08-03', days: MON_FRI_9_5 });

    const after = await prisma.shift.findUnique({ where: { id: shift.id } });
    expect(after).toEqual(before);
    expect(after.fixedWorkPatternId).toBeNull();

    const [clockEventsAfter, timesheetsAfter, monitorsAfter] = await Promise.all([
      prisma.clockEvent.count({ where: { shiftId: shift.id } }),
      prisma.timesheet.count({ where: { shiftId: shift.id } }),
      prisma.attendanceMonitor.count({ where: { shiftId: shift.id } }),
    ]);
    expect(clockEventsAfter).toBe(clockEventsBefore);
    expect(timesheetsAfter).toBe(timesheetsBefore);
    expect(monitorsAfter).toBe(monitorsBefore);
  });

  // ── 28: agency scoping on reads ─────────────────────────────────────────
  it('28. agency scoping on reads', async () => {
    const wB = await makeUser(agencyB.id, 'WORKER', 'FWP Agency B Read Subject');
    const locB = await prisma.location.create({ data: { agencyId: agencyB.id, name: `FWP B Read Office ${suffix}`, type: 'OFFICE', active: true } });
    const hrB = await makeUser(agencyB.id, 'HR', 'FWP Agency B HR');
    const createdInB = await request(app).post('/fixed-work-patterns').set('Authorization', `Bearer ${tokenFor(hrB)}`)
      .send({ workerId: wB.id, locationId: locB.id, effectiveFrom: '2037-01-04', days: MON_FRI_9_5 });
    expect(createdInB.status).toBe(201);

    const listAsA = await request(app).get('/fixed-work-patterns').set('Authorization', `Bearer ${tokenFor(hr)}`);
    expect(listAsA.status).toBe(200);
    expect(listAsA.body.data.map((p) => p.id)).not.toContain(createdInB.body.data.id);

    const getAsA = await request(app).get(`/fixed-work-patterns/${createdInB.body.data.id}`).set('Authorization', `Bearer ${tokenFor(hr)}`);
    expect(getAsA.status).toBe(404);
  });

  // ── 29: Shift.fixedWorkPatternId stays nullable ────────────────────────
  it('29. Shift.fixedWorkPatternId remains nullable — every plain shift still has it null', async () => {
    const w = await makeUser(agencyA.id, 'WORKER', 'FWP Nullable Check');
    const shift = await prisma.shift.create({
      data: {
        agencyId: agencyA.id,
        workerId: w.id,
        createdById: hr.id,
        kind: 'FIXED',
        locationId: locationA.id,
        startTime: new Date('2038-01-04T09:00:00.000Z'),
        endTime: new Date('2038-01-04T17:00:00.000Z'),
        date: new Date('2038-01-04T00:00:00.000Z'),
      },
    });
    expect(shift.fixedWorkPatternId).toBeNull();
  });
});
