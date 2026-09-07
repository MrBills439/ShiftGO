process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-access-secret';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test-refresh-secret';
process.env.RATE_LIMIT_DISABLED = 'true';

const request = require('supertest');
const { PrismaClient } = require('@prisma/client');
const app = require('../src/app');
const { signAccess } = require('../src/utils/jwt');
const { agencyWeekRange, agencyWeekRangeForDate, ymdInZone } = require('../src/lib/agencyTime');

const prisma = new PrismaClient();
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const tokenFor = (u) => signAccess({ id: u.id, agencyId: u.agencyId, role: u.role, status: u.status, name: u.name, email: u.email });
const HOUR = 3_600_000;

let agencyA;
let agencyB;
let hrA;
let managerA;
let tlA;
let wA1;
let wA2;
let houseA1;
let houseA2;
let hrB;
let wB;
let houseB;

// Anchor everything to Monday ~10:00 in the agency A timezone (Europe/London),
// well inside the current agency week and DST-safe.
const weekA = agencyWeekRange('Europe/London', new Date());
const MON10 = new Date(weekA.start.getTime() + 10 * HOUR);
const weekParam = (() => {
  const { year, month, day } = ymdInZone('Europe/London', new Date(weekA.start.getTime() + 12 * HOUR));
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
})();

async function mkUser(agencyId, role, tag, contractedHours = null) {
  return prisma.user.create({
    data: { agencyId, role, name: `Alloc ${tag}`, email: `alloc-${tag}-${suffix}@shiftgo.test`, passwordHash: 'x', contractedHours },
  });
}
async function mkHouse(agencyId, tag, managerId = null) {
  return prisma.house.create({ data: { agencyId, name: `Alloc House ${tag} ${suffix}`, address: '1 St', latitude: 51.5, longitude: -0.12, managerId } });
}
async function mkShift({ agencyId, houseId, workerId = null, startMs, hours, status = 'SCHEDULED' }) {
  const start = new Date(startMs);
  const end = new Date(startMs + hours * HOUR);
  return prisma.shift.create({
    data: { agencyId, houseId, workerId, createdById: hrA.id, startTime: start, endTime: end, date: start, status },
  });
}
const alloc = (user, qs = '') => request(app).get(`/staff/allocation?week=${weekParam}${qs}`).set('Authorization', `Bearer ${tokenFor(user)}`);
const patchShift = (user, id, body) => request(app).patch(`/shifts/${id}`).set('Authorization', `Bearer ${tokenFor(user)}`).send(body);
const claim = (user, id, body) => request(app).post(`/shifts/${id}/claim`).set('Authorization', `Bearer ${tokenFor(user)}`).send(body || {});

beforeAll(async () => {
  agencyA = await prisma.agency.create({ data: { name: `Alloc A ${suffix}`, timezone: 'Europe/London', maxWeeklyScheduledHours: 60 } });
  agencyB = await prisma.agency.create({ data: { name: `Alloc B ${suffix}`, timezone: 'Pacific/Auckland' } });
  hrA = await mkUser(agencyA.id, 'HR', 'hrA');
  managerA = await mkUser(agencyA.id, 'MANAGER', 'mgrA');
  tlA = await mkUser(agencyA.id, 'TEAM_LEADER', 'tlA');
  wA1 = await mkUser(agencyA.id, 'WORKER', 'wA1', 37.5);
  wA2 = await mkUser(agencyA.id, 'WORKER', 'wA2', 37.5);
  hrB = await mkUser(agencyB.id, 'HR', 'hrB');
  wB = await mkUser(agencyB.id, 'WORKER', 'wB', 40);
  houseA1 = await mkHouse(agencyA.id, 'A1', managerA.id);
  houseA2 = await mkHouse(agencyA.id, 'A2');
  houseB = await mkHouse(agencyB.id, 'B');
  await prisma.houseTeamLeader.create({ data: { houseId: houseA2.id, teamLeaderId: tlA.id } });
  await prisma.houseWorker.create({ data: { houseId: houseA2.id, workerId: wA2.id } });
});

afterEach(async () => {
  await prisma.auditLog.deleteMany({ where: { agencyId: { in: [agencyA.id, agencyB.id] } } });
  await prisma.leaveRequest.deleteMany({ where: { agencyId: { in: [agencyA.id, agencyB.id] } } });
  await prisma.shiftClaim.deleteMany({ where: { shift: { agencyId: { in: [agencyA.id, agencyB.id] } } } });
  await prisma.shift.deleteMany({ where: { agencyId: { in: [agencyA.id, agencyB.id] } } });
});

afterAll(async () => {
  await prisma.houseTeamLeader.deleteMany({ where: { teamLeaderId: tlA.id } });
  await prisma.houseWorker.deleteMany({ where: { workerId: wA2.id } });
  await prisma.house.deleteMany({ where: { agencyId: { in: [agencyA.id, agencyB.id] } } });
  await prisma.user.deleteMany({ where: { agencyId: { in: [agencyA.id, agencyB.id] } } });
  await prisma.agency.deleteMany({ where: { id: { in: [agencyA.id, agencyB.id] } } });
  await prisma.$disconnect();
});

const rowFor = (res, id) => res.body.data.workers.find((w) => w.id === id);

describe('agency week boundary', () => {
  test('Monday 00:00 -> next Monday 00:00 in the agency timezone', () => {
    const r = agencyWeekRange('Europe/London', new Date('2025-07-16T12:00:00Z')); // a Wednesday in BST
    expect(r.start.toISOString()).toBe('2025-07-13T23:00:00.000Z'); // Mon 14 Jul 00:00 BST
    expect(r.end.toISOString()).toBe('2025-07-20T23:00:00.000Z');   // Mon 21 Jul 00:00 BST
    expect(r.end - r.start).toBe(7 * 24 * HOUR);

    const w = agencyWeekRange('Europe/London', new Date('2025-01-15T12:00:00Z')); // Wed in GMT
    expect(w.start.toISOString()).toBe('2025-01-13T00:00:00.000Z');

    expect(agencyWeekRangeForDate('Europe/London', '2025-07-16').start.toISOString())
      .toBe('2025-07-13T23:00:00.000Z');
  });
});

describe('GET /staff/allocation — hours status', () => {
  test('contracted 37.5, scheduled 30 -> SAFE', async () => {
    await mkShift({ agencyId: agencyA.id, houseId: houseA1.id, workerId: wA1.id, startMs: MON10.getTime(), hours: 10 });
    await mkShift({ agencyId: agencyA.id, houseId: houseA1.id, workerId: wA1.id, startMs: MON10.getTime() + 24 * HOUR, hours: 10 });
    await mkShift({ agencyId: agencyA.id, houseId: houseA1.id, workerId: wA1.id, startMs: MON10.getTime() + 48 * HOUR, hours: 10 });

    const row = rowFor(await alloc(hrA), wA1.id);
    expect(row.scheduledHours).toBe(30);
    expect(row.remainingContractedHours).toBe(7.5);
    expect(row.hoursStatus).toBe('SAFE');
    expect(row.maxWeeklyScheduledHours).toBe(60);
  });

  test('contracted 37.5, projected 42 with a proposed 12h shift -> OVER_CONTRACT, and assignment proceeds', async () => {
    await mkShift({ agencyId: agencyA.id, houseId: houseA1.id, workerId: wA1.id, startMs: MON10.getTime(), hours: 10 });
    await mkShift({ agencyId: agencyA.id, houseId: houseA1.id, workerId: wA1.id, startMs: MON10.getTime() + 24 * HOUR, hours: 10 });
    await mkShift({ agencyId: agencyA.id, houseId: houseA1.id, workerId: wA1.id, startMs: MON10.getTime() + 48 * HOUR, hours: 10 });
    const openShift = await mkShift({ agencyId: agencyA.id, houseId: houseA1.id, startMs: MON10.getTime() + 72 * HOUR, hours: 12, status: 'OPEN' });

    const row = rowFor(await alloc(hrA, `&proposedShiftId=${openShift.id}`), wA1.id);
    expect(row.projectedHours).toBe(42);
    expect(row.hoursStatus).toBe('OVER_CONTRACT');

    const res = await patchShift(managerA, openShift.id, { workerId: wA1.id });
    expect(res.status).toBe(200);
    expect(res.body.data.workerId).toBe(wA1.id);
  });

  test('projected 59 -> NEAR_LIMIT and assignment still proceeds', async () => {
    await mkShift({ agencyId: agencyA.id, houseId: houseA1.id, workerId: wA2.id, startMs: MON10.getTime(), hours: 51 }); // long block
    const openShift = await mkShift({ agencyId: agencyA.id, houseId: houseA1.id, startMs: MON10.getTime() + 96 * HOUR, hours: 8, status: 'OPEN' });

    const row = rowFor(await alloc(hrA, `&proposedShiftId=${openShift.id}`), wA2.id);
    expect(row.projectedHours).toBe(59);
    expect(row.hoursStatus).toBe('NEAR_LIMIT');

    const res = await patchShift(managerA, openShift.id, { workerId: wA2.id });
    expect(res.status).toBe(200);
  });
});

describe('assignment / override rule', () => {
  test('projected 61 (> max 60) with no override -> 409 APPROVAL_REQUIRED, shift not assigned', async () => {
    await mkShift({ agencyId: agencyA.id, houseId: houseA1.id, workerId: wA2.id, startMs: MON10.getTime(), hours: 53 });
    const openShift = await mkShift({ agencyId: agencyA.id, houseId: houseA1.id, startMs: MON10.getTime() + 100 * HOUR, hours: 8, status: 'OPEN' });

    const res = await patchShift(managerA, openShift.id, { workerId: wA2.id });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('APPROVAL_REQUIRED');
    expect(res.body.details.projectedHours).toBe(61);
    expect(res.body.details.maxWeeklyScheduledHours).toBe(60);

    const after = await prisma.shift.findUnique({ where: { id: openShift.id } });
    expect(after.workerId).toBeNull();
    expect(after.status).toBe('OPEN');
  });

  test('authorised override (HR) succeeds and is audited', async () => {
    await mkShift({ agencyId: agencyA.id, houseId: houseA1.id, workerId: wA2.id, startMs: MON10.getTime(), hours: 53 });
    const openShift = await mkShift({ agencyId: agencyA.id, houseId: houseA1.id, startMs: MON10.getTime() + 100 * HOUR, hours: 8, status: 'OPEN' });

    const res = await patchShift(hrA, openShift.id, {
      workerId: wA2.id,
      overrideWeeklyLimit: true,
      overrideReason: 'Emergency cover — no other eligible worker available',
    });
    expect(res.status).toBe(200);
    expect(res.body.data.workerId).toBe(wA2.id);

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'WEEKLY_HOURS_LIMIT_OVERRIDE', entityId: openShift.id },
    });
    expect(audit).toBeTruthy();
    expect(audit.actorId).toBe(hrA.id);
    expect(audit.newValue).toMatchObject({
      workerId: wA2.id,
      projectedHours: 61,
      maxWeeklyScheduledHours: 60,
      reason: 'Emergency cover — no other eligible worker available',
      approvedById: hrA.id,
    });
  });

  test('unauthorised override (Team Leader) is rejected and shift not assigned', async () => {
    await mkShift({ agencyId: agencyA.id, houseId: houseA1.id, workerId: wA2.id, startMs: MON10.getTime(), hours: 53 });
    const openShift = await mkShift({ agencyId: agencyA.id, houseId: houseA1.id, startMs: MON10.getTime() + 100 * HOUR, hours: 8, status: 'OPEN' });

    const res = await patchShift(tlA, openShift.id, {
      workerId: wA2.id, overrideWeeklyLimit: true, overrideReason: 'we really need cover',
    });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('OVERRIDE_NOT_PERMITTED');

    const after = await prisma.shift.findUnique({ where: { id: openShift.id } });
    expect(after.workerId).toBeNull();
    expect(await prisma.auditLog.count({ where: { action: 'WEEKLY_HOURS_LIMIT_OVERRIDE' } })).toBe(0);
  });

  test('overlap is still blocked and cannot be overridden by the weekly-hours override', async () => {
    await mkShift({ agencyId: agencyA.id, houseId: houseA1.id, workerId: wA1.id, startMs: MON10.getTime(), hours: 8 });
    const openShift = await mkShift({ agencyId: agencyA.id, houseId: houseA1.id, startMs: MON10.getTime() + 4 * HOUR, hours: 8, status: 'OPEN' });

    const res = await patchShift(hrA, openShift.id, {
      workerId: wA1.id, overrideWeeklyLimit: true, overrideReason: 'trying to force an overlap',
    });
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/overlapping/i);
    expect(res.body.code).toBeUndefined();
  });
});

describe('hours calculation correctness', () => {
  test('cancelled shifts are not counted', async () => {
    await mkShift({ agencyId: agencyA.id, houseId: houseA1.id, workerId: wA1.id, startMs: MON10.getTime(), hours: 30 });
    await mkShift({ agencyId: agencyA.id, houseId: houseA1.id, workerId: wA1.id, startMs: MON10.getTime() + 96 * HOUR, hours: 20, status: 'CANCELLED' });

    expect(rowFor(await alloc(hrA), wA1.id).scheduledHours).toBe(30);
  });

  test('overnight shift duration is correct and not double-counted', async () => {
    // Tue 22:00 -> Wed 06:00 = 8h, entirely inside the week.
    await mkShift({ agencyId: agencyA.id, houseId: houseA1.id, workerId: wA1.id, startMs: MON10.getTime() + 24 * HOUR + 12 * HOUR, hours: 8 });
    await mkShift({ agencyId: agencyA.id, houseId: houseA1.id, workerId: wA1.id, startMs: MON10.getTime() + 72 * HOUR, hours: 9 });

    expect(rowFor(await alloc(hrA), wA1.id).scheduledHours).toBe(17);
  });

  test('a shift one minute before the week start does not count; one at the week start does', async () => {
    await mkShift({ agencyId: agencyA.id, houseId: houseA1.id, workerId: wA1.id, startMs: weekA.start.getTime() - 60_000 - 4 * HOUR, hours: 4 }); // ends 1 min before week
    await mkShift({ agencyId: agencyA.id, houseId: houseA1.id, workerId: wA1.id, startMs: weekA.start.getTime(), hours: 6 }); // starts exactly at week start

    expect(rowFor(await alloc(hrA), wA1.id).scheduledHours).toBe(6);
  });
});

describe('scoping & isolation', () => {
  test('Manager sees the whole agency candidate pool', async () => {
    const res = await alloc(managerA);
    const ids = res.body.data.workers.map((w) => w.id);
    expect(ids).toEqual(expect.arrayContaining([wA1.id, wA2.id]));
  });

  test('Team Leader only sees workers in their led house', async () => {
    const res = await alloc(tlA);
    const ids = res.body.data.workers.map((w) => w.id);
    expect(ids).toEqual([wA2.id]);
  });

  test('cross-agency isolation — no other agency workers or shifts leak', async () => {
    await mkShift({ agencyId: agencyB.id, houseId: houseB.id, workerId: wB.id, startMs: Date.now(), hours: 8 });
    const res = await alloc(hrA);
    expect(res.body.data.workers.some((w) => w.id === wB.id)).toBe(false);

    const resB = await request(app).get('/staff/allocation').set('Authorization', `Bearer ${tokenFor(hrB)}`);
    expect(resB.status).toBe(200);
    expect(resB.body.data.workers.some((w) => w.id === wA1.id)).toBe(false);
    expect(resB.body.data.timezone).toBe('Pacific/Auckland');
  });

  test('a WORKER cannot access the allocation view', async () => {
    const res = await request(app).get('/staff/allocation').set('Authorization', `Bearer ${tokenFor(wA1)}`);
    expect(res.status).toBe(403);
  });
});

describe('worker self-claim respects the weekly limit (no self-override)', () => {
  test('claim within the max proceeds', async () => {
    await mkShift({ agencyId: agencyA.id, houseId: houseA1.id, workerId: wA1.id, startMs: MON10.getTime(), hours: 40 });
    const openShift = await mkShift({ agencyId: agencyA.id, houseId: houseA1.id, startMs: MON10.getTime() + 96 * HOUR, hours: 8, status: 'OPEN' });

    const res = await claim(wA1, openShift.id);
    expect(res.status).toBe(201);
    const after = await prisma.shift.findUnique({ where: { id: openShift.id } });
    expect(after.status).toBe('CLAIMED');
    expect(after.workerId).toBe(wA1.id);
  });

  test('claim that would exceed the max is blocked (WEEKLY_HOURS_LIMIT); shift stays OPEN', async () => {
    await mkShift({ agencyId: agencyA.id, houseId: houseA1.id, workerId: wA1.id, startMs: MON10.getTime(), hours: 55 });
    const openShift = await mkShift({ agencyId: agencyA.id, houseId: houseA1.id, startMs: MON10.getTime() + 120 * HOUR, hours: 8, status: 'OPEN' });

    const res = await claim(wA1, openShift.id);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('WEEKLY_HOURS_LIMIT');
    expect(res.body.details.projectedHours).toBe(63);

    const after = await prisma.shift.findUnique({ where: { id: openShift.id } });
    expect(after.status).toBe('OPEN');
    expect(after.workerId).toBeNull();
  });

  test('overrideWeeklyLimit in the claim body is ignored — still blocked', async () => {
    await mkShift({ agencyId: agencyA.id, houseId: houseA1.id, workerId: wA1.id, startMs: MON10.getTime(), hours: 55 });
    const openShift = await mkShift({ agencyId: agencyA.id, houseId: houseA1.id, startMs: MON10.getTime() + 120 * HOUR, hours: 8, status: 'OPEN' });

    const res = await claim(wA1, openShift.id, { overrideWeeklyLimit: true, overrideReason: 'let me in' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('WEEKLY_HOURS_LIMIT');
    expect((await prisma.shift.findUnique({ where: { id: openShift.id } })).status).toBe('OPEN');
  });

  test('an overlapping claim is still blocked before the hours check', async () => {
    await mkShift({ agencyId: agencyA.id, houseId: houseA1.id, workerId: wA1.id, startMs: MON10.getTime(), hours: 8 });
    const openShift = await mkShift({ agencyId: agencyA.id, houseId: houseA1.id, startMs: MON10.getTime() + 4 * HOUR, hours: 8, status: 'OPEN' });

    const res = await claim(wA1, openShift.id);
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/overlapping/i);
  });
});

describe('retiming an assigned shift respects the weekly limit', () => {
  test('increasing duration past the max is blocked; the shift is unchanged', async () => {
    const other = await mkShift({ agencyId: agencyA.id, houseId: houseA1.id, workerId: wA1.id, startMs: MON10.getTime(), hours: 54 });
    const shift = await mkShift({ agencyId: agencyA.id, houseId: houseA1.id, workerId: wA1.id, startMs: MON10.getTime() + 120 * HOUR, hours: 4 });

    const newEnd = new Date(MON10.getTime() + 120 * HOUR + 10 * HOUR).toISOString(); // 4h -> 10h => 54 + 10 = 64
    const res = await patchShift(managerA, shift.id, { endTime: newEnd });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('APPROVAL_REQUIRED');
    expect(res.body.details.projectedHours).toBe(64);

    const after = await prisma.shift.findUnique({ where: { id: shift.id } });
    expect(after.endTime.toISOString()).toBe(new Date(MON10.getTime() + 120 * HOUR + 4 * HOUR).toISOString());
    void other;
  });

  test('authorised override on a retime succeeds and is audited', async () => {
    await mkShift({ agencyId: agencyA.id, houseId: houseA1.id, workerId: wA1.id, startMs: MON10.getTime(), hours: 54 });
    const shift = await mkShift({ agencyId: agencyA.id, houseId: houseA1.id, workerId: wA1.id, startMs: MON10.getTime() + 120 * HOUR, hours: 4 });
    const newEnd = new Date(MON10.getTime() + 120 * HOUR + 10 * HOUR).toISOString();

    const res = await patchShift(hrA, shift.id, {
      endTime: newEnd, overrideWeeklyLimit: true, overrideReason: 'Client needs continuous cover to 08:00',
    });
    expect(res.status).toBe(200);
    const audit = await prisma.auditLog.findFirst({ where: { action: 'WEEKLY_HOURS_LIMIT_OVERRIDE', entityId: shift.id } });
    expect(audit).toBeTruthy();
    expect(audit.newValue.projectedHours).toBe(64);
  });

  test('the current shift is not double-counted when it is retimed', async () => {
    await mkShift({ agencyId: agencyA.id, houseId: houseA1.id, workerId: wA1.id, startMs: MON10.getTime(), hours: 10 });
    const shift = await mkShift({ agencyId: agencyA.id, houseId: houseA1.id, workerId: wA1.id, startMs: MON10.getTime() + 96 * HOUR, hours: 40 });

    // 40h -> 45h. Correct: 10 (other) + 45 = 55 (<= 60) -> OK.
    // If double-counted: 10 + 40 + 45 = 95 -> would be blocked.
    const newEnd = new Date(MON10.getTime() + 96 * HOUR + 45 * HOUR).toISOString();
    const res = await patchShift(managerA, shift.id, { endTime: newEnd });
    expect(res.status).toBe(200);

    const row = rowFor(await alloc(hrA), wA1.id);
    expect(row.scheduledHours).toBe(55);
  });

  test('moving a shift into another agency week is evaluated against the destination week', async () => {
    // 52h already sitting in NEXT week.
    await mkShift({ agencyId: agencyA.id, houseId: houseA1.id, workerId: wA1.id, startMs: MON10.getTime() + 7 * 24 * HOUR, hours: 52 });
    // A 10h shift THIS week that we will move into next week (52 + 10 = 62 > 60).
    const shift = await mkShift({ agencyId: agencyA.id, houseId: houseA1.id, workerId: wA1.id, startMs: MON10.getTime() + 24 * HOUR, hours: 10 });

    const movedStart = new Date(MON10.getTime() + 7 * 24 * HOUR + 3 * 24 * HOUR).toISOString();
    const movedEnd = new Date(MON10.getTime() + 7 * 24 * HOUR + 3 * 24 * HOUR + 10 * HOUR).toISOString();
    const res = await patchShift(managerA, shift.id, { startTime: movedStart, endTime: movedEnd, date: movedStart });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('APPROVAL_REQUIRED');
    expect(res.body.details.projectedHours).toBe(62);
  });

  test('changing only an unrelated field does not run the hours check', async () => {
    await mkShift({ agencyId: agencyA.id, houseId: houseA1.id, workerId: wA1.id, startMs: MON10.getTime(), hours: 58 });
    const shift = await mkShift({ agencyId: agencyA.id, houseId: houseA1.id, workerId: wA1.id, startMs: MON10.getTime() + 120 * HOUR, hours: 5 }); // 63h total already

    // No worker/time change — just shiftType. Must not be blocked by the (already-exceeded) weekly total.
    const res = await patchShift(managerA, shift.id, { shiftType: 'WAKE_NIGHT' });
    expect(res.status).toBe(200);
    expect(res.body.data.shiftType).toBe('WAKE_NIGHT');
  });
});

describe('status / availability semantics', () => {
  test('without a proposed shift, currentStatus is ON/OFF only and availability is null', async () => {
    await mkShift({ agencyId: agencyA.id, houseId: houseA1.id, workerId: wA1.id, startMs: Date.now() - HOUR, hours: 4 }); // on shift now
    const res = await alloc(hrA);
    const on = rowFor(res, wA1.id);
    const off = rowFor(res, wA2.id);
    expect(on.currentStatus).toBe('ON_SHIFT');
    expect(off.currentStatus).toBe('OFF_SHIFT');
    expect(on.availabilityForSelectedShift).toBeNull();
    expect(off.availabilityForSelectedShift).toBeNull();
  });

  test('with a proposed shift: AVAILABLE / CONFLICT / ON_LEAVE reflect real data', async () => {
    const openShift = await mkShift({ agencyId: agencyA.id, houseId: houseA1.id, startMs: MON10.getTime() + 24 * HOUR, hours: 8, status: 'OPEN' });
    // wA1 overlaps the proposed window.
    await mkShift({ agencyId: agencyA.id, houseId: houseA2.id, workerId: wA1.id, startMs: MON10.getTime() + 24 * HOUR + 2 * HOUR, hours: 6 });
    // wA2 is on approved leave covering it.
    await prisma.leaveRequest.create({
      data: {
        agencyId: agencyA.id, workerId: wA2.id, status: 'APPROVED', totalHours: 8,
        startDate: new Date(MON10.getTime() + 20 * HOUR), endDate: new Date(MON10.getTime() + 40 * HOUR),
      },
    });

    const res = await alloc(hrA, `&proposedShiftId=${openShift.id}`);
    expect(rowFor(res, wA1.id).availabilityForSelectedShift).toBe('CONFLICT');
    expect(rowFor(res, wA2.id).availabilityForSelectedShift).toBe('ON_LEAVE');
    expect(rowFor(res, wA2.id).currentStatus).toBe('OFF_SHIFT'); // not on a shift now
  });
});
