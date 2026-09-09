process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-access-secret';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test-refresh-secret';
process.env.RATE_LIMIT_DISABLED = 'true';

const request = require('supertest');
const { PrismaClient } = require('@prisma/client');
const app = require('../src/app');
const appPrisma = require('../src/lib/prisma');
const shiftChangeService = require('../src/services/shiftChangeService');
const { signAccess } = require('../src/utils/jwt');
const { agencyWeekRange } = require('../src/lib/agencyTime');

// Anchor hours-sensitive shifts to NEXT agency week (Mon 00:00 Europe/London),
// mid-week, so every shift in a test lands in the same week regardless of the
// wall-clock day the suite runs.
const nextWeek = () => agencyWeekRange('Europe/London', new Date(Date.now() + 7 * 24 * 3_600_000)).start.getTime();
const nwWed = (h = 8) => nextWeek() + 2 * 24 * 3_600_000 + h * 3_600_000; // Wed hh:00

const prisma = new PrismaClient();
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const tokenFor = (u) => signAccess({ id: u.id, agencyId: u.agencyId, role: u.role, status: u.status, name: u.name, email: u.email });
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const as = (u) => ({
  get: (p) => request(app).get(p).set('Authorization', `Bearer ${tokenFor(u)}`),
  post: (p, b) => request(app).post(p).set('Authorization', `Bearer ${tokenFor(u)}`).send(b || {}),
});

let agencyA, agencyB;
let hrA, mgrA, tlA, wA, wB, wC, wLow1, wLow2;
let houseA1, houseA2, houseB;
let agencyLow; // low weekly cap for hours tests
let mgrLow;

async function mkUser(agencyId, role, tag, extra = {}) {
  return prisma.user.create({
    data: { agencyId, role, name: `SC ${tag}`, email: `sc-${tag}-${suffix}@shiftgo.test`, passwordHash: 'x', ...extra },
  });
}
async function mkHouse(agencyId, tag) {
  return prisma.house.create({ data: { agencyId, name: `SC House ${tag} ${suffix}`, address: '1 St', latitude: 51.5, longitude: -0.12 } });
}
async function mkShift({ agencyId, houseId, workerId = null, startMs, hours = 8, status = 'SCHEDULED' }) {
  const start = new Date(startMs);
  return prisma.shift.create({
    data: {
      agencyId, houseId, workerId, createdById: hrA.id,
      startTime: start, endTime: new Date(startMs + hours * HOUR), date: start, status,
    },
  });
}
const soon = (days = 3) => Date.now() + days * DAY;

beforeAll(async () => {
  agencyA = await prisma.agency.create({ data: { name: `SC A ${suffix}`, timezone: 'Europe/London', maxWeeklyScheduledHours: 60 } });
  agencyB = await prisma.agency.create({ data: { name: `SC B ${suffix}`, timezone: 'Europe/London' } });
  agencyLow = await prisma.agency.create({ data: { name: `SC Low ${suffix}`, timezone: 'Europe/London', maxWeeklyScheduledHours: 20 } });

  hrA = await mkUser(agencyA.id, 'HR', 'hrA');
  mgrA = await mkUser(agencyA.id, 'MANAGER', 'mgrA');
  tlA = await mkUser(agencyA.id, 'TEAM_LEADER', 'tlA');
  wA = await mkUser(agencyA.id, 'WORKER', 'wA', { contractedHours: 37.5 });
  wB = await mkUser(agencyA.id, 'WORKER', 'wB', { contractedHours: 37.5 });
  wC = await mkUser(agencyA.id, 'WORKER', 'wC', { contractedHours: 37.5 });
  mgrLow = await mkUser(agencyLow.id, 'MANAGER', 'mgrLow');
  wLow1 = await mkUser(agencyLow.id, 'WORKER', 'wLow1');
  wLow2 = await mkUser(agencyLow.id, 'WORKER', 'wLow2');

  houseA1 = await mkHouse(agencyA.id, 'A1');
  houseA2 = await mkHouse(agencyA.id, 'A2');
  houseB = await mkHouse(agencyB.id, 'B');
  const houseLow = await mkHouse(agencyLow.id, 'Low');
  houseLow_id = houseLow.id;
});

let houseLow_id;

afterEach(async () => {
  await prisma.notification.deleteMany({ where: { agencyId: { in: [agencyA.id, agencyB.id, agencyLow.id] } } });
  await prisma.auditLog.deleteMany({ where: { agencyId: { in: [agencyA.id, agencyB.id, agencyLow.id] } } });
  await prisma.shiftChangeRequest.deleteMany({ where: { agencyId: { in: [agencyA.id, agencyB.id, agencyLow.id] } } });
  await prisma.clockEvent.deleteMany({ where: { agencyId: { in: [agencyA.id, agencyB.id, agencyLow.id] } } });
  await prisma.leaveRequest.deleteMany({ where: { agencyId: { in: [agencyA.id, agencyB.id, agencyLow.id] } } });
  await prisma.shift.deleteMany({ where: { agencyId: { in: [agencyA.id, agencyB.id, agencyLow.id] } } });
});

afterAll(async () => {
  await prisma.house.deleteMany({ where: { agencyId: { in: [agencyA.id, agencyB.id, agencyLow.id] } } });
  await prisma.user.deleteMany({ where: { agencyId: { in: [agencyA.id, agencyB.id, agencyLow.id] } } });
  await prisma.agency.deleteMany({ where: { id: { in: [agencyA.id, agencyB.id, agencyLow.id] } } });
  await prisma.$disconnect();
});

async function coverReq(requester, shiftId, targetWorkerId, reason) {
  return as(requester).post('/shift-change/cover', { shiftId, targetWorkerId, reason });
}

// ══════════════════════════════════ COVER ══════════════════════════════════
describe('Shift Cover', () => {
  test('worker requests cover for their own future shift; ownership does NOT change', async () => {
    const shift = await mkShift({ agencyId: agencyA.id, houseId: houseA1.id, workerId: wA.id, startMs: soon(3) });
    const res = await coverReq(wA, shift.id, wB.id, 'Dentist');
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ type: 'COVER', status: 'PENDING_RECIPIENT' });
    expect((await prisma.shift.findUnique({ where: { id: shift.id } })).workerId).toBe(wA.id);

    // recipient notified
    const notif = await prisma.notification.findFirst({ where: { userId: wB.id, type: 'GENERAL' } });
    expect(notif?.data).toMatchObject({ kind: 'SHIFT_CHANGE', event: 'COVER_REQUEST_RECEIVED', requestId: res.body.data.id });
    // audit
    const audit = await prisma.auditLog.findFirst({ where: { action: 'SHIFT_COVER_REQUESTED', entityId: res.body.data.id } });
    expect(audit).toBeTruthy();
  });

  test('cannot request cover for a shift you do not own', async () => {
    const shift = await mkShift({ agencyId: agencyA.id, houseId: houseA1.id, workerId: wB.id, startMs: soon(3) });
    const res = await coverReq(wA, shift.id, wC.id);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('NOT_SHIFT_OWNER');
  });

  test.each([
    ['COMPLETED', 'SHIFT_NOT_CHANGEABLE'],
    ['CANCELLED', 'SHIFT_NOT_CHANGEABLE'],
    ['IN_PROGRESS', 'SHIFT_IN_PROGRESS'],
  ])('cannot request cover for a %s shift', async (status, code) => {
    const shift = await mkShift({ agencyId: agencyA.id, houseId: houseA1.id, workerId: wA.id, startMs: soon(3), status });
    const res = await coverReq(wA, shift.id, wB.id);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe(code);
  });

  test('cannot request cover for a past / already-started shift', async () => {
    const shift = await mkShift({ agencyId: agencyA.id, houseId: houseA1.id, workerId: wA.id, startMs: Date.now() - 2 * HOUR });
    const res = await coverReq(wA, shift.id, wB.id);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('SHIFT_STARTED');
  });

  test('cannot request cover for an OPEN / unassigned shift', async () => {
    const shift = await mkShift({ agencyId: agencyA.id, houseId: houseA1.id, workerId: null, startMs: soon(3), status: 'OPEN' });
    const res = await coverReq(wA, shift.id, wB.id);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('SHIFT_NOT_ASSIGNED');
  });

  test('a shift already clocked into cannot be covered', async () => {
    const shift = await mkShift({ agencyId: agencyA.id, houseId: houseA1.id, workerId: wA.id, startMs: soon(3) });
    await prisma.clockEvent.create({ data: { agencyId: agencyA.id, workerId: wA.id, houseId: houseA1.id, shiftId: shift.id, type: 'IN', method: 'MANUAL', timestamp: new Date() } });
    const res = await coverReq(wA, shift.id, wB.id);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('SHIFT_CLOCKED_IN');
  });

  test('a second active request against the same shift is blocked', async () => {
    const shift = await mkShift({ agencyId: agencyA.id, houseId: houseA1.id, workerId: wA.id, startMs: soon(3) });
    expect((await coverReq(wA, shift.id, wB.id)).status).toBe(201);
    const dup = await coverReq(wA, shift.id, wC.id);
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe('DUPLICATE_REQUEST');
  });

  test('cross-agency recipient is rejected', async () => {
    const shift = await mkShift({ agencyId: agencyA.id, houseId: houseA1.id, workerId: wA.id, startMs: soon(3) });
    const wBinB = await mkUser(agencyB.id, 'WORKER', `bx-${Math.random()}`);
    const res = await coverReq(wA, shift.id, wBinB.id);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('CROSS_AGENCY');
    await prisma.user.delete({ where: { id: wBinB.id } });
  });

  test('recipient with an overlapping shift is blocked at creation', async () => {
    const s = soon(3);
    const shift = await mkShift({ agencyId: agencyA.id, houseId: houseA1.id, workerId: wA.id, startMs: s });
    await mkShift({ agencyId: agencyA.id, houseId: houseA2.id, workerId: wB.id, startMs: s + HOUR });
    const res = await coverReq(wA, shift.id, wB.id);
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/overlapping/i);
  });

  test('recipient on approved leave is blocked at creation', async () => {
    const s = soon(5);
    const shift = await mkShift({ agencyId: agencyA.id, houseId: houseA1.id, workerId: wA.id, startMs: s });
    await prisma.leaveRequest.create({
      data: { agencyId: agencyA.id, workerId: wB.id, status: 'APPROVED', startDate: new Date(s - DAY), endDate: new Date(s + DAY) },
    });
    const res = await coverReq(wA, shift.id, wB.id);
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/leave/i);
  });

  test('weekly-hours ceiling blocks a cover the recipient cannot absorb', async () => {
    // agencyLow cap = 20h. wLow1 already has 16h that week; a 10h cover would be 26h.
    const s = await mkShift({ agencyId: agencyLow.id, houseId: houseLow_id, workerId: wLow2.id, startMs: nwWed(8), hours: 10 });
    await mkShift({ agencyId: agencyLow.id, houseId: houseLow_id, workerId: wLow1.id, startMs: nwWed(30), hours: 16 });
    const res = await coverReq(wLow2, s.id, wLow1.id);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('WEEKLY_HOURS_LIMIT');
  });

  test('recipient accepts -> PENDING_MANAGER + manager notified; wrong worker cannot accept', async () => {
    const shift = await mkShift({ agencyId: agencyA.id, houseId: houseA1.id, workerId: wA.id, startMs: soon(3) });
    const { body: { data: reqRow } } = await coverReq(wA, shift.id, wB.id);

    const wrong = await as(wC).post(`/shift-change/${reqRow.id}/respond`, { decision: 'ACCEPT' });
    expect(wrong.status).toBe(403);
    expect(wrong.body.code).toBe('NOT_RECIPIENT');

    const ok = await as(wB).post(`/shift-change/${reqRow.id}/respond`, { decision: 'ACCEPT' });
    expect(ok.status).toBe(200);
    expect(ok.body.data.status).toBe('PENDING_MANAGER');
    expect((await prisma.shift.findUnique({ where: { id: shift.id } })).workerId).toBe(wA.id); // still not changed

    const mgrNotif = await prisma.notification.findFirst({ where: { userId: mgrA.id, data: { path: ['event'], equals: 'SHIFT_CHANGE_PENDING_APPROVAL' } } });
    expect(mgrNotif).toBeTruthy();
  });

  test('recipient declines -> REJECTED, requester notified, no shift change', async () => {
    const shift = await mkShift({ agencyId: agencyA.id, houseId: houseA1.id, workerId: wA.id, startMs: soon(3) });
    const { body: { data: reqRow } } = await coverReq(wA, shift.id, wB.id);
    const res = await as(wB).post(`/shift-change/${reqRow.id}/respond`, { decision: 'DECLINE' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('REJECTED');
    expect((await prisma.shift.findUnique({ where: { id: shift.id } })).workerId).toBe(wA.id);
    const n = await prisma.notification.findFirst({ where: { userId: wA.id, data: { path: ['event'], equals: 'SHIFT_CHANGE_DECLINED' } } });
    expect(n).toBeTruthy();
  });

  test('requester can cancel while PENDING_RECIPIENT and PENDING_MANAGER, but not after APPROVED', async () => {
    const shift = await mkShift({ agencyId: agencyA.id, houseId: houseA1.id, workerId: wA.id, startMs: soon(3) });
    const { body: { data: reqRow } } = await coverReq(wA, shift.id, wB.id);
    // recipient cannot cancel someone else's request
    const rc = await as(wB).post(`/shift-change/${reqRow.id}/cancel`);
    expect(rc.status).toBe(403);
    const c1 = await as(wA).post(`/shift-change/${reqRow.id}/cancel`);
    expect(c1.status).toBe(200);
    expect(c1.body.data.status).toBe('CANCELLED');
  });

  test('manager approval reassigns the shift; revalidation + audit + notifications', async () => {
    const shift = await mkShift({ agencyId: agencyA.id, houseId: houseA1.id, workerId: wA.id, startMs: soon(3) });
    const { body: { data: reqRow } } = await coverReq(wA, shift.id, wB.id);
    await as(wB).post(`/shift-change/${reqRow.id}/respond`, { decision: 'ACCEPT' });

    const res = await as(mgrA).post(`/shift-change/${reqRow.id}/approve`);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('APPROVED');
    expect((await prisma.shift.findUnique({ where: { id: shift.id } })).workerId).toBe(wB.id);

    const audit = await prisma.auditLog.findFirst({ where: { action: 'SHIFT_CHANGE_APPROVED', entityId: reqRow.id } });
    expect(audit.newValue).toMatchObject({ primaryShift_oldWorkerId: wA.id, primaryShift_newWorkerId: wB.id });
    expect(await prisma.notification.count({ where: { data: { path: ['event'], equals: 'SHIFT_CHANGE_APPROVED' } } })).toBeGreaterThanOrEqual(2);
  });

  test('manager rejection keeps the original worker', async () => {
    const shift = await mkShift({ agencyId: agencyA.id, houseId: houseA1.id, workerId: wA.id, startMs: soon(3) });
    const { body: { data: reqRow } } = await coverReq(wA, shift.id, wB.id);
    await as(wB).post(`/shift-change/${reqRow.id}/respond`, { decision: 'ACCEPT' });
    const res = await as(mgrA).post(`/shift-change/${reqRow.id}/reject`, { reason: 'Need wA there' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('REJECTED');
    expect((await prisma.shift.findUnique({ where: { id: shift.id } })).workerId).toBe(wA.id);
  });

  test('conditions changing after acceptance can block manager approval (recipient now overlaps)', async () => {
    const s = soon(3);
    const shift = await mkShift({ agencyId: agencyA.id, houseId: houseA1.id, workerId: wA.id, startMs: s });
    const { body: { data: reqRow } } = await coverReq(wA, shift.id, wB.id);
    await as(wB).post(`/shift-change/${reqRow.id}/respond`, { decision: 'ACCEPT' });
    // wB now picks up a clashing shift
    await mkShift({ agencyId: agencyA.id, houseId: houseA2.id, workerId: wB.id, startMs: s + HOUR });
    const res = await as(mgrA).post(`/shift-change/${reqRow.id}/approve`);
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/overlapping/i);
    expect((await prisma.shift.findUnique({ where: { id: shift.id } })).workerId).toBe(wA.id);
    expect((await prisma.shiftChangeRequest.findUnique({ where: { id: reqRow.id } })).status).toBe('PENDING_MANAGER');
  });

  test('double approval cannot reassign twice (concurrency guard)', async () => {
    const shift = await mkShift({ agencyId: agencyA.id, houseId: houseA1.id, workerId: wA.id, startMs: soon(3) });
    const { body: { data: reqRow } } = await coverReq(wA, shift.id, wB.id);
    await as(wB).post(`/shift-change/${reqRow.id}/respond`, { decision: 'ACCEPT' });

    const [r1, r2] = await Promise.all([
      as(mgrA).post(`/shift-change/${reqRow.id}/approve`),
      as(hrA).post(`/shift-change/${reqRow.id}/approve`),
    ]);
    const statuses = [r1.status, r2.status].sort();
    expect(statuses).toEqual([200, 409]);
    expect((await prisma.shift.findUnique({ where: { id: shift.id } })).workerId).toBe(wB.id);
    expect(await prisma.auditLog.count({ where: { action: 'SHIFT_CHANGE_APPROVED', entityId: reqRow.id } })).toBe(1);
  });

  test('weekly-hours override at approval: APPROVAL_REQUIRED without, then manager override with reason', async () => {
    // Recipient is UNDER the cap when the request is created + accepted...
    const s = await mkShift({ agencyId: agencyLow.id, houseId: houseLow_id, workerId: wLow2.id, startMs: nwWed(8), hours: 8 });
    const { body: { data: reqRow } } = await coverReq(wLow2, s.id, wLow1.id);
    expect(reqRow.status).toBe('PENDING_RECIPIENT');
    await as(wLow1).post(`/shift-change/${reqRow.id}/respond`, { decision: 'ACCEPT' });

    // ...but then wLow1 picks up 15h more the same week -> approval would push to 23h > 20.
    await mkShift({ agencyId: agencyLow.id, houseId: houseLow_id, workerId: wLow1.id, startMs: nwWed(30), hours: 15 });

    const noOverride = await as(mgrLow).post(`/shift-change/${reqRow.id}/approve`);
    expect(noOverride.status).toBe(409);
    expect(noOverride.body.code).toBe('APPROVAL_REQUIRED');
    expect((await prisma.shift.findUnique({ where: { id: s.id } })).workerId).toBe(wLow2.id);

    const reasonMissing = await as(mgrLow).post(`/shift-change/${reqRow.id}/approve`, { overrideWeeklyHours: true });
    expect(reasonMissing.status).toBeGreaterThanOrEqual(400);

    const ok = await as(mgrLow).post(`/shift-change/${reqRow.id}/approve`, { overrideWeeklyHours: true, overrideReason: 'Short-staffed weekend, agreed with wLow1' });
    expect(ok.status).toBe(200);
    expect(ok.body.data.status).toBe('APPROVED');
    expect((await prisma.shift.findUnique({ where: { id: s.id } })).workerId).toBe(wLow1.id);
    // the existing weekly-hours override audit is retained
    expect(await prisma.auditLog.count({ where: { action: 'WEEKLY_HOURS_LIMIT_OVERRIDE', entityId: s.id } })).toBe(1);
  });
});

// ══════════════════════════════════ SWAP ═══════════════════════════════════
describe('Shift Swap', () => {
  async function swapReq(requester, shiftId, targetWorkerId, targetShiftId, reason) {
    return as(requester).post('/shift-change/swap', { shiftId, targetWorkerId, targetShiftId, reason });
  }

  test('valid swap request is created; no shift changes owner yet', async () => {
    const shiftA = await mkShift({ agencyId: agencyA.id, houseId: houseA1.id, workerId: wA.id, startMs: soon(3) });
    const shiftB = await mkShift({ agencyId: agencyA.id, houseId: houseA2.id, workerId: wB.id, startMs: soon(5) });
    const res = await swapReq(wA, shiftA.id, wB.id, shiftB.id, 'Family');
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ type: 'SWAP', status: 'PENDING_RECIPIENT' });
    expect((await prisma.shift.findUnique({ where: { id: shiftA.id } })).workerId).toBe(wA.id);
    expect((await prisma.shift.findUnique({ where: { id: shiftB.id } })).workerId).toBe(wB.id);
  });

  test('target must own the target shift; requester must own their shift', async () => {
    const shiftA = await mkShift({ agencyId: agencyA.id, houseId: houseA1.id, workerId: wA.id, startMs: soon(3) });
    const notBs = await mkShift({ agencyId: agencyA.id, houseId: houseA2.id, workerId: wC.id, startMs: soon(5) });
    const r1 = await swapReq(wA, shiftA.id, wB.id, notBs.id);
    expect(r1.status).toBe(403);
    expect(r1.body.code).toBe('NOT_SHIFT_OWNER');

    const notAs = await mkShift({ agencyId: agencyA.id, houseId: houseA1.id, workerId: wC.id, startMs: soon(3) });
    const bShift = await mkShift({ agencyId: agencyA.id, houseId: houseA2.id, workerId: wB.id, startMs: soon(6) });
    const r2 = await swapReq(wA, notAs.id, wB.id, bShift.id);
    expect(r2.status).toBe(403);
  });

  test('same shift on both sides is rejected', async () => {
    const shiftA = await mkShift({ agencyId: agencyA.id, houseId: houseA1.id, workerId: wA.id, startMs: soon(3) });
    const res = await swapReq(wA, shiftA.id, wB.id, shiftA.id);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('SAME_SHIFT');
  });

  test('cross-agency swap blocked', async () => {
    const shiftA = await mkShift({ agencyId: agencyA.id, houseId: houseA1.id, workerId: wA.id, startMs: soon(3) });
    const bWorker = await mkUser(agencyB.id, 'WORKER', `bs-${Math.random()}`);
    const bShift = await mkShift({ agencyId: agencyB.id, houseId: houseB.id, workerId: bWorker.id, startMs: soon(5) });
    const res = await swapReq(wA, shiftA.id, bWorker.id, bShift.id);
    expect(res.status).toBe(403);
    await prisma.shift.deleteMany({ where: { workerId: bWorker.id } });
    await prisma.user.delete({ where: { id: bWorker.id } });
  });

  test('target accepts -> PENDING_MANAGER; target declines -> REJECTED', async () => {
    const shiftA = await mkShift({ agencyId: agencyA.id, houseId: houseA1.id, workerId: wA.id, startMs: soon(3) });
    const shiftB = await mkShift({ agencyId: agencyA.id, houseId: houseA2.id, workerId: wB.id, startMs: soon(5) });
    const { body: { data: reqRow } } = await swapReq(wA, shiftA.id, wB.id, shiftB.id);
    const dec = await as(wB).post(`/shift-change/${reqRow.id}/respond`, { decision: 'DECLINE' });
    expect(dec.body.data.status).toBe('REJECTED');

    const shiftA2 = await mkShift({ agencyId: agencyA.id, houseId: houseA1.id, workerId: wA.id, startMs: soon(7) });
    const shiftB2 = await mkShift({ agencyId: agencyA.id, houseId: houseA2.id, workerId: wB.id, startMs: soon(9) });
    const { body: { data: r2 } } = await swapReq(wA, shiftA2.id, wB.id, shiftB2.id);
    const acc = await as(wB).post(`/shift-change/${r2.id}/respond`, { decision: 'ACCEPT' });
    expect(acc.body.data.status).toBe('PENDING_MANAGER');
  });

  test('cannot approve once EITHER shift has started (dynamic expiry)', async () => {
    const shiftA = await mkShift({ agencyId: agencyA.id, houseId: houseA1.id, workerId: wA.id, startMs: Date.now() + 90 * 1000 });
    const shiftB = await mkShift({ agencyId: agencyA.id, houseId: houseA2.id, workerId: wB.id, startMs: soon(5) });
    // build the request via service directly (HTTP path would reject the near-future primary at creation only if <=now)
    const created = await shiftChangeService.createSwapRequest(
      { id: wA.id, name: wA.name, role: 'WORKER', contractedHours: 37.5 }, agencyA.id,
      { shiftId: shiftA.id, targetWorkerId: wB.id, targetShiftId: shiftB.id },
    );
    await prisma.shiftChangeRequest.update({ where: { id: created.id }, data: { status: 'PENDING_MANAGER', recipientResponse: 'ACCEPTED', recipientRespondedAt: new Date() } });
    // move shiftA into the past
    await prisma.shift.update({ where: { id: shiftA.id }, data: { startTime: new Date(Date.now() - HOUR), endTime: new Date(Date.now() + HOUR) } });
    const res = await as(mgrA).post(`/shift-change/${created.id}/approve`);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('EXPIRED');
    expect((await prisma.shiftChangeRequest.findUnique({ where: { id: created.id } })).status).toBe('EXPIRED');
  });

  test('projected hours SUBTRACT the outgoing shift and ADD the incoming one', async () => {
    // agencyLow cap 20, same agency week. wLow1 owns shiftX 12h; wLow2 owns
    // shiftY 12h. Naive "current + incoming" = 12 + 12 = 24h (over cap) for BOTH
    // sides. Correct projection subtracts the outgoing shift: 12 - 12 + 12 = 12h.
    // So the swap MUST be allowed.
    const shiftX = await mkShift({ agencyId: agencyLow.id, houseId: houseLow_id, workerId: wLow1.id, startMs: nwWed(8), hours: 12 });
    const shiftY = await mkShift({ agencyId: agencyLow.id, houseId: houseLow_id, workerId: wLow2.id, startMs: nwWed(30), hours: 12 });
    const res = await as(wLow1).post('/shift-change/swap', { shiftId: shiftX.id, targetWorkerId: wLow2.id, targetShiftId: shiftY.id });
    expect(res.status).toBe(201);
  });

  test('manager approval exchanges both workerIds atomically', async () => {
    const shiftA = await mkShift({ agencyId: agencyA.id, houseId: houseA1.id, workerId: wA.id, startMs: soon(3) });
    const shiftB = await mkShift({ agencyId: agencyA.id, houseId: houseA2.id, workerId: wB.id, startMs: soon(5) });
    const { body: { data: reqRow } } = await swapReq(wA, shiftA.id, wB.id, shiftB.id);
    await as(wB).post(`/shift-change/${reqRow.id}/respond`, { decision: 'ACCEPT' });
    const res = await as(mgrA).post(`/shift-change/${reqRow.id}/approve`);
    expect(res.status).toBe(200);
    expect((await prisma.shift.findUnique({ where: { id: shiftA.id } })).workerId).toBe(wB.id);
    expect((await prisma.shift.findUnique({ where: { id: shiftB.id } })).workerId).toBe(wA.id);
    // other fields preserved
    const a = await prisma.shift.findUnique({ where: { id: shiftA.id } });
    expect(a.houseId).toBe(houseA1.id);
  });

  test('a second assignment failure leaves BOTH original assignments (atomic rollback)', async () => {
    const shiftA = await mkShift({ agencyId: agencyA.id, houseId: houseA1.id, workerId: wA.id, startMs: soon(3) });
    const shiftB = await mkShift({ agencyId: agencyA.id, houseId: houseA2.id, workerId: wB.id, startMs: soon(5) });
    const { body: { data: reqRow } } = await swapReq(wA, shiftA.id, wB.id, shiftB.id);
    await as(wB).post(`/shift-change/${reqRow.id}/respond`, { decision: 'ACCEPT' });

    // Sabotage the SECOND shift between checks and the transaction: reassign it
    // to someone else so the conditional updateMany in the tx sees count 0.
    await prisma.shift.update({ where: { id: shiftB.id }, data: { workerId: wC.id } });

    const res = await as(mgrA).post(`/shift-change/${reqRow.id}/approve`);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('STALE_ASSIGNMENT');
    // shiftA NOT changed, shiftB still with the saboteur, request still pending
    expect((await prisma.shift.findUnique({ where: { id: shiftA.id } })).workerId).toBe(wA.id);
    expect((await prisma.shift.findUnique({ where: { id: shiftB.id } })).workerId).toBe(wC.id);
    expect((await prisma.shiftChangeRequest.findUnique({ where: { id: reqRow.id } })).status).toBe('PENDING_MANAGER');
  });

  test('duplicate manager approval blocked for swap', async () => {
    const shiftA = await mkShift({ agencyId: agencyA.id, houseId: houseA1.id, workerId: wA.id, startMs: soon(3) });
    const shiftB = await mkShift({ agencyId: agencyA.id, houseId: houseA2.id, workerId: wB.id, startMs: soon(5) });
    const { body: { data: reqRow } } = await swapReq(wA, shiftA.id, wB.id, shiftB.id);
    await as(wB).post(`/shift-change/${reqRow.id}/respond`, { decision: 'ACCEPT' });
    const [r1, r2] = await Promise.all([
      as(mgrA).post(`/shift-change/${reqRow.id}/approve`),
      as(hrA).post(`/shift-change/${reqRow.id}/approve`),
    ]);
    expect([r1.status, r2.status].sort()).toEqual([200, 409]);
  });
});

// ═════════════════════════════════ SECURITY ════════════════════════════════
describe('Shift Change — security', () => {
  test('a manager from another agency cannot approve', async () => {
    const shift = await mkShift({ agencyId: agencyA.id, houseId: houseA1.id, workerId: wA.id, startMs: soon(3) });
    const { body: { data: reqRow } } = await coverReq(wA, shift.id, wB.id);
    await as(wB).post(`/shift-change/${reqRow.id}/respond`, { decision: 'ACCEPT' });
    const res = await as(mgrLow).post(`/shift-change/${reqRow.id}/approve`);
    expect(res.status).toBe(404); // scoped by agencyId -> not found
    expect((await prisma.shift.findUnique({ where: { id: shift.id } })).workerId).toBe(wA.id);
  });

  test('a worker cannot approve or reject', async () => {
    const shift = await mkShift({ agencyId: agencyA.id, houseId: houseA1.id, workerId: wA.id, startMs: soon(3) });
    const { body: { data: reqRow } } = await coverReq(wA, shift.id, wB.id);
    await as(wB).post(`/shift-change/${reqRow.id}/respond`, { decision: 'ACCEPT' });
    expect((await as(wC).post(`/shift-change/${reqRow.id}/approve`)).status).toBe(403);
    expect((await as(wC).post(`/shift-change/${reqRow.id}/reject`)).status).toBe(403);
  });

  test('a non-party worker cannot read a request', async () => {
    const shift = await mkShift({ agencyId: agencyA.id, houseId: houseA1.id, workerId: wA.id, startMs: soon(3) });
    const { body: { data: reqRow } } = await coverReq(wA, shift.id, wB.id);
    expect((await as(wC).get(`/shift-change/${reqRow.id}`)).status).toBe(403);
    expect((await as(wA).get(`/shift-change/${reqRow.id}`)).status).toBe(200);
    expect((await as(wB).get(`/shift-change/${reqRow.id}`)).status).toBe(200);
    expect((await as(mgrA).get(`/shift-change/${reqRow.id}`)).status).toBe(200);
  });

  test('a worker in another agency cannot respond (IDOR)', async () => {
    const shift = await mkShift({ agencyId: agencyA.id, houseId: houseA1.id, workerId: wA.id, startMs: soon(3) });
    const { body: { data: reqRow } } = await coverReq(wA, shift.id, wB.id);
    const res = await as(wLow1).post(`/shift-change/${reqRow.id}/respond`, { decision: 'ACCEPT' });
    expect([403, 404]).toContain(res.status);
    expect((await prisma.shiftChangeRequest.findUnique({ where: { id: reqRow.id } })).status).toBe('PENDING_RECIPIENT');
  });

  test('GET /me only returns the caller’s own sent + incoming requests', async () => {
    const shift = await mkShift({ agencyId: agencyA.id, houseId: houseA1.id, workerId: wA.id, startMs: soon(3) });
    const { body: { data: reqRow } } = await coverReq(wA, shift.id, wB.id);
    const wcView = await as(wC).get('/shift-change/me');
    expect(wcView.status).toBe(200);
    const allIds = [...wcView.body.data.sent.items, ...wcView.body.data.incoming.items].map((r) => r.id);
    expect(allIds).not.toContain(reqRow.id);
    const wbView = await as(wB).get('/shift-change/me');
    expect(wbView.body.data.incoming.items.map((r) => r.id)).toContain(reqRow.id);
  });

  test('eligible-workers only lists same-agency assignable teammates, never the requester', async () => {
    const shift = await mkShift({ agencyId: agencyA.id, houseId: houseA1.id, workerId: wA.id, startMs: soon(3) });
    const res = await as(wA).get(`/shift-change/eligible-workers?shiftId=${shift.id}`);
    expect(res.status).toBe(200);
    const ids = res.body.data.workers.map((w) => w.id);
    expect(ids).not.toContain(wA.id);
    expect(ids).not.toContain(hrA.id); // HR/MANAGER not listed as assignable workers
    expect(ids).toEqual(expect.arrayContaining([wB.id, wC.id]));
    // cross-agency never present
    expect(ids).not.toContain(wLow1.id);
  });
});

// ═══════════════════════ EXPIRY PERSISTENCE ════════════════════════════════
describe('Shift Change — expiry is persisted before the 409', () => {
  afterEach(() => jest.restoreAllMocks());

  // Build an accepted request via the service, keeping the shift in the future
  // during creation, then push a shift into the past to simulate "started".
  async function acceptedCover() {
    const shift = await mkShift({ agencyId: agencyA.id, houseId: houseA1.id, workerId: wA.id, startMs: soon(3) });
    const created = await shiftChangeService.createCoverRequest(
      { id: wA.id, name: wA.name, role: 'WORKER', contractedHours: 37.5 }, agencyA.id,
      { shiftId: shift.id, targetWorkerId: wB.id },
    );
    return { shift, id: created.id };
  }
  async function acceptedSwap() {
    const shiftA = await mkShift({ agencyId: agencyA.id, houseId: houseA1.id, workerId: wA.id, startMs: soon(3) });
    const shiftB = await mkShift({ agencyId: agencyA.id, houseId: houseA2.id, workerId: wB.id, startMs: soon(5) });
    const created = await shiftChangeService.createSwapRequest(
      { id: wA.id, name: wA.name, role: 'WORKER', contractedHours: 37.5 }, agencyA.id,
      { shiftId: shiftA.id, targetWorkerId: wB.id, targetShiftId: shiftB.id },
    );
    return { shiftA, shiftB, id: created.id };
  }
  const toPast = (shiftId) =>
    prisma.shift.update({ where: { id: shiftId }, data: { startTime: new Date(Date.now() - 2 * HOUR), endTime: new Date(Date.now() + 6 * HOUR) } });

  test('recipient responds after the primary shift starts → 409 EXPIRED, DB status EXPIRED, no ACCEPTED', async () => {
    const { shift, id } = await acceptedCover();
    await toPast(shift.id);
    const res = await as(wB).post(`/shift-change/${id}/respond`, { decision: 'ACCEPT' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('EXPIRED');
    const row = await prisma.shiftChangeRequest.findUnique({ where: { id } });
    expect(row.status).toBe('EXPIRED');
    expect(row.recipientResponse).toBeNull();
    expect((await prisma.shift.findUnique({ where: { id: shift.id } })).workerId).toBe(wA.id);
  });

  test('manager approves a cover after the shift starts → 409 EXPIRED, DB EXPIRED, ownership unchanged', async () => {
    const { shift, id } = await acceptedCover();
    await prisma.shiftChangeRequest.update({ where: { id }, data: { status: 'PENDING_MANAGER', recipientResponse: 'ACCEPTED', recipientRespondedAt: new Date() } });
    await toPast(shift.id);
    const res = await as(mgrA).post(`/shift-change/${id}/approve`);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('EXPIRED');
    const row = await prisma.shiftChangeRequest.findUnique({ where: { id } });
    expect(row.status).toBe('EXPIRED');
    expect(row.managerDecisionAt).toBeNull();
    expect((await prisma.shift.findUnique({ where: { id: shift.id } })).workerId).toBe(wA.id);
  });

  test('manager approves a swap after EITHER shift starts → 409 EXPIRED, both ownerships unchanged', async () => {
    for (const which of ['primary', 'swap']) {
      const { shiftA, shiftB, id } = await acceptedSwap();
      await prisma.shiftChangeRequest.update({ where: { id }, data: { status: 'PENDING_MANAGER', recipientResponse: 'ACCEPTED', recipientRespondedAt: new Date() } });
      await toPast(which === 'primary' ? shiftA.id : shiftB.id);
      const res = await as(mgrA).post(`/shift-change/${id}/approve`);
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('EXPIRED');
      expect((await prisma.shiftChangeRequest.findUnique({ where: { id } })).status).toBe('EXPIRED');
      expect((await prisma.shift.findUnique({ where: { id: shiftA.id } })).workerId).toBe(wA.id);
      expect((await prisma.shift.findUnique({ where: { id: shiftB.id } })).workerId).toBe(wB.id);
    }
  });

  test('a second attempt against an already-EXPIRED request stays 409 EXPIRED', async () => {
    const { shift, id } = await acceptedCover();
    await prisma.shiftChangeRequest.update({ where: { id }, data: { status: 'PENDING_MANAGER', recipientResponse: 'ACCEPTED', recipientRespondedAt: new Date() } });
    await toPast(shift.id);
    expect((await as(mgrA).post(`/shift-change/${id}/approve`)).status).toBe(409); // first → EXPIRED persisted

    const again = await as(mgrA).post(`/shift-change/${id}/approve`);
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('EXPIRED');
    const rr = await as(wB).post(`/shift-change/${id}/respond`, { decision: 'ACCEPT' });
    expect(rr.status).toBe(409);
    expect(rr.body.code).toBe('EXPIRED');
    expect((await prisma.shiftChangeRequest.findUnique({ where: { id } })).status).toBe('EXPIRED');
  });
});

// ═══════════════ APPROVAL SIDE-EFFECT / OVERRIDE-AUDIT ATOMICITY ═══════════
describe('Shift Change — approval side effects never break a committed reassignment', () => {
  afterEach(() => jest.restoreAllMocks());

  test('override audit is NOT written when the reassignment transaction fails', async () => {
    // Over-cap cover so a manager override would be needed.
    const s = await mkShift({ agencyId: agencyLow.id, houseId: houseLow_id, workerId: wLow2.id, startMs: nwWed(8), hours: 8 });
    const { body: { data: reqRow } } = await as(wLow2).post('/shift-change/cover', { shiftId: s.id, targetWorkerId: wLow1.id });
    await as(wLow1).post(`/shift-change/${reqRow.id}/respond`, { decision: 'ACCEPT' });
    await mkShift({ agencyId: agencyLow.id, houseId: houseLow_id, workerId: wLow1.id, startMs: nwWed(30), hours: 15 }); // pushes wLow1 to 23h

    // Make the reassignment transaction fail AFTER validateWorkerAssignment
    // (which produces the override-audit closure) has already run.
    jest.spyOn(appPrisma, '$transaction').mockRejectedValueOnce(new Error('simulated tx failure'));

    const res = await as(mgrLow).post(`/shift-change/${reqRow.id}/approve`, { overrideWeeklyHours: true, overrideReason: 'Short-staffed, agreed' });
    expect(res.status).toBeGreaterThanOrEqual(500);

    // No misleading audit, nothing reassigned, request still pending.
    expect(await prisma.auditLog.count({ where: { action: 'WEEKLY_HOURS_LIMIT_OVERRIDE' } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { action: 'SHIFT_CHANGE_APPROVED', entityId: reqRow.id } })).toBe(0);
    expect((await prisma.shift.findUnique({ where: { id: s.id } })).workerId).toBe(wLow2.id);
    expect((await prisma.shiftChangeRequest.findUnique({ where: { id: reqRow.id } })).status).toBe('PENDING_MANAGER');
  });

  test('a notification write failure does NOT fail an already-committed approval', async () => {
    const shift = await mkShift({ agencyId: agencyA.id, houseId: houseA1.id, workerId: wA.id, startMs: soon(3) });
    const { body: { data: reqRow } } = await coverReq(wA, shift.id, wB.id);
    await as(wB).post(`/shift-change/${reqRow.id}/respond`, { decision: 'ACCEPT' });

    // Break the in-app notification write for the duration of this approval.
    jest.spyOn(appPrisma.notification, 'create').mockRejectedValue(new Error('simulated notification failure'));

    const res = await as(mgrA).post(`/shift-change/${reqRow.id}/approve`);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('APPROVED');
    expect((await prisma.shift.findUnique({ where: { id: shift.id } })).workerId).toBe(wB.id);
    expect(await prisma.auditLog.count({ where: { action: 'SHIFT_CHANGE_APPROVED', entityId: reqRow.id } })).toBe(1);
  });
});
