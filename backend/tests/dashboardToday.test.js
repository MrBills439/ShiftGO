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

let agencyA;
let agencyB;
let hrA;
let tlA;
let workerA1;
let workerA2;
let houseA;
let hrB;
let workerB;
let houseB;

function tokenFor(user) {
  return signAccess({
    id: user.id,
    agencyId: user.agencyId,
    role: user.role,
    status: user.status,
    name: user.name,
    email: user.email,
  });
}

function get(user) {
  return request(app).get('/dashboard/today').set('Authorization', `Bearer ${tokenFor(user)}`);
}

async function mkUser(agencyId, role, tag) {
  return prisma.user.create({
    data: {
      agencyId,
      name: `${tag}`,
      email: `${tag}-${suffix}@shiftgo.test`.toLowerCase(),
      passwordHash: 'test-password-hash',
      role,
    },
  });
}

function hoursFromNow(h) {
  return new Date(Date.now() + h * 60 * 60 * 1000);
}

async function mkShift({ agencyId, houseId, workerId = null, start, end, status = 'SCHEDULED' }) {
  return prisma.shift.create({
    data: {
      agencyId,
      houseId,
      workerId,
      createdById: hrA.id,
      startTime: start,
      endTime: end,
      date: start,
      status,
    },
  });
}

async function mkTimesheet({ agencyId, houseId, workerId, shiftId, status = 'PENDING', clockOutAt = null, needsReview = false, reviewReason = null }) {
  return prisma.timesheet.create({
    data: {
      agencyId, houseId, workerId, shiftId, status,
      clockInAt: hoursFromNow(-6),
      clockOutAt,
      needsReview,
      reviewReason,
    },
  });
}

beforeAll(async () => {
  agencyA = await prisma.agency.create({ data: { name: `Dash A ${suffix}` } });
  agencyB = await prisma.agency.create({ data: { name: `Dash B ${suffix}` } });

  hrA = await mkUser(agencyA.id, 'HR', 'dash-hrA');
  tlA = await mkUser(agencyA.id, 'TEAM_LEADER', 'dash-tlA');
  workerA1 = await mkUser(agencyA.id, 'WORKER', 'dash-wA1');
  workerA2 = await mkUser(agencyA.id, 'WORKER', 'dash-wA2');
  hrB = await mkUser(agencyB.id, 'HR', 'dash-hrB');
  workerB = await mkUser(agencyB.id, 'WORKER', 'dash-wB');

  houseA = await prisma.house.create({
    data: { agencyId: agencyA.id, name: `House A ${suffix}`, address: '1 A St', latitude: 51.5, longitude: -0.12 },
  });
  houseB = await prisma.house.create({
    data: { agencyId: agencyB.id, name: `House B ${suffix}`, address: '1 B St', latitude: 52.0, longitude: -1.0 },
  });

  await prisma.houseTeamLeader.create({ data: { houseId: houseA.id, teamLeaderId: tlA.id } });
});

afterEach(async () => {
  const agencyIds = [agencyA.id, agencyB.id];
  await prisma.leaveRequest.deleteMany({ where: { agencyId: { in: agencyIds } } });
  await prisma.attendanceMonitor.deleteMany({ where: { agencyId: { in: agencyIds } } });
  await prisma.timesheet.deleteMany({ where: { agencyId: { in: agencyIds } } });
  await prisma.shift.deleteMany({ where: { agencyId: { in: agencyIds } } });
  await prisma.shareCode.deleteMany({ where: { agencyId: { in: agencyIds } } });
});

afterAll(async () => {
  await prisma.houseTeamLeader.deleteMany({ where: { houseId: houseA.id } });
  await prisma.house.deleteMany({ where: { agencyId: { in: [agencyA.id, agencyB.id] } } });
  await prisma.user.deleteMany({ where: { agencyId: { in: [agencyA.id, agencyB.id] } } });
  await prisma.agency.deleteMany({ where: { id: { in: [agencyA.id, agencyB.id] } } });
  await prisma.$disconnect();
});

describe('GET /dashboard/today — coverage', () => {
  test('no shifts today => coverage.percent is null, not 100', async () => {
    const res = await get(hrA);
    expect(res.status).toBe(200);
    expect(res.body.data.coverage.percent).toBeNull();
    expect(res.body.data.coverage.scheduled).toBe(0);
    expect(res.body.data.todayShifts).toHaveLength(0);
  });

  test('partially covered shifts => correct percentage', async () => {
    await mkShift({ agencyId: agencyA.id, houseId: houseA.id, workerId: workerA1.id, start: hoursFromNow(1), end: hoursFromNow(9) });
    await mkShift({ agencyId: agencyA.id, houseId: houseA.id, workerId: workerA2.id, start: hoursFromNow(2), end: hoursFromNow(10) });
    await mkShift({ agencyId: agencyA.id, houseId: houseA.id, workerId: tlA.id, start: hoursFromNow(3), end: hoursFromNow(11) });
    await mkShift({ agencyId: agencyA.id, houseId: houseA.id, workerId: null, start: hoursFromNow(4), end: hoursFromNow(12), status: 'OPEN' });

    const res = await get(hrA);
    expect(res.status).toBe(200);
    expect(res.body.data.coverage.scheduled).toBe(4);
    expect(res.body.data.coverage.covered).toBe(3);
    expect(res.body.data.coverage.percent).toBe(75);
    expect(res.body.data.issues.some((i) => i.type === 'UNCOVERED_SHIFT')).toBe(true);
  });

  test('fully covered shifts => 100%', async () => {
    await mkShift({ agencyId: agencyA.id, houseId: houseA.id, workerId: workerA1.id, start: hoursFromNow(1), end: hoursFromNow(9) });
    await mkShift({ agencyId: agencyA.id, houseId: houseA.id, workerId: workerA2.id, start: hoursFromNow(2), end: hoursFromNow(10) });

    const res = await get(hrA);
    expect(res.body.data.coverage.percent).toBe(100);
    expect(res.body.data.coverage.uncovered).toBe(0);
  });

  test('workersLive counts in-progress shifts only', async () => {
    await mkShift({ agencyId: agencyA.id, houseId: houseA.id, workerId: workerA1.id, start: hoursFromNow(-1), end: hoursFromNow(7), status: 'IN_PROGRESS' });
    await mkShift({ agencyId: agencyA.id, houseId: houseA.id, workerId: workerA2.id, start: hoursFromNow(2), end: hoursFromNow(10) });

    const res = await get(hrA);
    expect(res.body.data.workersLive).toBe(1);
  });

  test('a started, un-clocked-in scheduled shift becomes a LATE issue', async () => {
    await mkShift({ agencyId: agencyA.id, houseId: houseA.id, workerId: workerA1.id, start: hoursFromNow(-1), end: hoursFromNow(6), status: 'SCHEDULED' });
    const res = await get(hrA);
    expect(res.body.data.issues.some((i) => i.type === 'LATE' && i.worker?.id === workerA1.id)).toBe(true);
  });
});

describe('GET /dashboard/today — pending approvals', () => {
  test('counts attendance reviews, pending timesheets and pending leave', async () => {
    const s1 = await mkShift({ agencyId: agencyA.id, houseId: houseA.id, workerId: workerA1.id, start: hoursFromNow(-8), end: hoursFromNow(-1), status: 'COMPLETED' });
    await mkTimesheet({ agencyId: agencyA.id, houseId: houseA.id, workerId: workerA1.id, shiftId: s1.id, status: 'PENDING', clockOutAt: hoursFromNow(-1), needsReview: true, reviewReason: 'GPS inconclusive' });

    const s2 = await mkShift({ agencyId: agencyA.id, houseId: houseA.id, workerId: workerA2.id, start: hoursFromNow(-9), end: hoursFromNow(-2), status: 'COMPLETED' });
    await mkTimesheet({ agencyId: agencyA.id, houseId: houseA.id, workerId: workerA2.id, shiftId: s2.id, status: 'PENDING', clockOutAt: hoursFromNow(-2), needsReview: false });

    await prisma.leaveRequest.create({
      data: { agencyId: agencyA.id, workerId: workerA1.id, startDate: hoursFromNow(48), endDate: hoursFromNow(72), status: 'PENDING', totalHours: 8 },
    });

    const res = await get(hrA);
    expect(res.body.data.pendingApprovals.attendanceReviews).toBe(1);
    expect(res.body.data.pendingApprovals.timesheets).toBe(1);
    expect(res.body.data.pendingApprovals.leave).toBe(1);
    expect(res.body.data.pendingApprovals.total).toBe(3);

    const types = res.body.data.issues.map((i) => i.type);
    expect(types).toEqual(expect.arrayContaining(['ATTENDANCE_REVIEW', 'TIMESHEET_APPROVAL', 'LEAVE_APPROVAL']));
  });
});

describe('GET /dashboard/today — role & agency isolation', () => {
  test('WORKER is forbidden', async () => {
    const res = await get(workerA1);
    expect(res.status).toBe(403);
  });

  test('TEAM_LEADER sees shift issues but no approvals / RTW data', async () => {
    await mkShift({ agencyId: agencyA.id, houseId: houseA.id, workerId: null, start: hoursFromNow(2), end: hoursFromNow(10), status: 'OPEN' });
    const s = await mkShift({ agencyId: agencyA.id, houseId: houseA.id, workerId: workerA1.id, start: hoursFromNow(-9), end: hoursFromNow(-2), status: 'COMPLETED' });
    await mkTimesheet({ agencyId: agencyA.id, houseId: houseA.id, workerId: workerA1.id, shiftId: s.id, status: 'PENDING', clockOutAt: hoursFromNow(-2), needsReview: true, reviewReason: 'x' });
    await prisma.leaveRequest.create({
      data: { agencyId: agencyA.id, workerId: workerA1.id, startDate: hoursFromNow(48), endDate: hoursFromNow(72), status: 'PENDING', totalHours: 8 },
    });

    const res = await get(tlA);
    expect(res.status).toBe(200);
    expect(res.body.data.permissions.canReviewApprovals).toBe(false);
    expect(res.body.data.pendingApprovals.total).toBe(0);
    const types = res.body.data.issues.map((i) => i.type);
    expect(types).toContain('UNCOVERED_SHIFT');
    expect(types).not.toContain('ATTENDANCE_REVIEW');
    expect(types).not.toContain('LEAVE_APPROVAL');
    expect(types).not.toContain('RIGHT_TO_WORK');
  });

  test('one agency never sees another agency\'s shifts, approvals or issues', async () => {
    // Agency A: clean bill of health (share codes on file, no shifts today).
    for (const u of [workerA1, workerA2, tlA]) {
      await prisma.shareCode.create({
        data: { agencyId: agencyA.id, userId: u.id, code: 'ABC123XYZ', shareDate: hoursFromNow(-24) },
      });
    }
    // Agency B: an uncovered shift, a flagged timesheet and a pending leave.
    await mkShift({ agencyId: agencyB.id, houseId: houseB.id, workerId: null, start: hoursFromNow(2), end: hoursFromNow(10), status: 'OPEN' });
    const sB = await prisma.shift.create({
      data: { agencyId: agencyB.id, houseId: houseB.id, workerId: workerB.id, createdById: hrB.id, startTime: hoursFromNow(-9), endTime: hoursFromNow(-2), date: hoursFromNow(-9), status: 'COMPLETED' },
    });
    await prisma.timesheet.create({
      data: { agencyId: agencyB.id, houseId: houseB.id, workerId: workerB.id, shiftId: sB.id, status: 'PENDING', clockInAt: hoursFromNow(-9), clockOutAt: hoursFromNow(-2), needsReview: true, reviewReason: 'b' },
    });
    await prisma.leaveRequest.create({
      data: { agencyId: agencyB.id, workerId: workerB.id, startDate: hoursFromNow(48), endDate: hoursFromNow(72), status: 'PENDING', totalHours: 8 },
    });

    const resA = await get(hrA);
    expect(resA.body.data.coverage.scheduled).toBe(0);
    expect(resA.body.data.coverage.percent).toBeNull();
    expect(resA.body.data.pendingApprovals.total).toBe(0);
    expect(resA.body.data.issues).toHaveLength(0);

    const resB = await get(hrB);
    expect(resB.body.data.coverage.scheduled).toBeGreaterThanOrEqual(1);
    expect(resB.body.data.pendingApprovals.attendanceReviews).toBe(1);
    expect(resB.body.data.pendingApprovals.leave).toBe(1);
    expect(resB.body.data.issues.some((i) => i.type === 'UNCOVERED_SHIFT')).toBe(true);
  });
});
