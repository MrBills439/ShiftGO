process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-access-secret';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test-refresh-secret';
process.env.RATE_LIMIT_DISABLED = 'true';

jest.mock('../src/utils/clerkClient', () => ({
  organizations: {},
  users: { banUser: jest.fn(), unbanUser: jest.fn() },
}));

const request = require('supertest');
const { PrismaClient } = require('@prisma/client');
const app = require('../src/app');
const clerkStub = require('../src/utils/clerkClient');
const { signAccess } = require('../src/utils/jwt');

const prisma = new PrismaClient();
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const tokenFor = (u) => signAccess({ id: u.id, agencyId: u.agencyId, role: u.role, status: u.status, name: u.name, email: u.email });
const as = (u) => ({
  get: (p) => request(app).get(p).set('Authorization', `Bearer ${tokenFor(u)}`),
  post: (p, b) => request(app).post(p).set('Authorization', `Bearer ${tokenFor(u)}`).send(b || {}),
});

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

let agA, agB;
let hrA, mgrA, wkrA, tlA, hrB;
let deptA, jtA, houseA;
let deadA, deadMgrA, deadB, workingA, futureA, noClerkA, noClerkDeadA;

const mkUser = (agencyId, role, tag, extra = {}) =>
  prisma.user.create({ data: {
    agencyId, role, name: `LC ${tag}`, email: `lc-${tag}-${suffix}@shiftgo.test`, passwordHash: 'x',
    clerkUserId: `clerk_lc_${tag}_${suffix}`, ...extra,
  } });

const mkShift = (workerId, over = {}) =>
  prisma.shift.create({ data: {
    agencyId: agA.id, houseId: houseA.id, workerId, createdById: hrA.id,
    startTime: new Date(Date.now() + DAY), endTime: new Date(Date.now() + DAY + 8 * HOUR),
    date: new Date(Date.now() + DAY), shiftType: 'LONG_DAY', status: 'SCHEDULED', ...over,
  } });

beforeAll(async () => {
  agA = await prisma.agency.create({ data: { name: `LC A ${suffix}`, employeeIdPrefix: 'LCA' } });
  agB = await prisma.agency.create({ data: { name: `LC B ${suffix}`, employeeIdPrefix: 'LCB' } });

  hrA = await mkUser(agA.id, 'HR', 'hrA');
  mgrA = await mkUser(agA.id, 'MANAGER', 'mgrA');
  wkrA = await mkUser(agA.id, 'WORKER', 'wkrA');
  tlA = await mkUser(agA.id, 'TEAM_LEADER', 'tlA');
  hrB = await mkUser(agB.id, 'HR', 'hrB');

  deptA = await prisma.department.create({ data: { agencyId: agA.id, name: 'Care' } });
  jtA = await prisma.jobTitle.create({ data: { agencyId: agA.id, name: 'Support Worker', departmentId: deptA.id } });
  houseA = await prisma.house.create({ data: { agencyId: agA.id, name: `House ${suffix}`, address: '1 St', latitude: 51, longitude: 0 } });

  const deactivatedShape = {
    status: 'DEACTIVATED', deactivatedAt: new Date('2026-01-15T00:00:00Z'),
    deactivatedById: hrA.id, deactivationReason: 'moved on',
  };
  deadA = await mkUser(agA.id, 'WORKER', 'deadA', {
    ...deactivatedShape,
    employeeNumber: 'KEEP-1', departmentId: deptA.id, jobTitleId: jtA.id,
    employmentType: 'PERMANENT', workPatternType: 'FIXED', contractedHours: 30,
    phone: '+44 7700 900123', address: '9 Elm Road',
  });
  deadMgrA = await mkUser(agA.id, 'MANAGER', 'deadMgrA', deactivatedShape);
  deadB = await mkUser(agB.id, 'WORKER', 'deadB', { status: 'DEACTIVATED', deactivatedAt: new Date(), deactivatedById: hrB.id });
  workingA = await mkUser(agA.id, 'WORKER', 'workingA');
  futureA = await mkUser(agA.id, 'WORKER', 'futureA');
  // No linked Clerk identity — cannot be suspended / restored via Clerk.
  noClerkA = await mkUser(agA.id, 'WORKER', 'noClerkA', { clerkUserId: null });
  noClerkDeadA = await mkUser(agA.id, 'WORKER', 'noClerkDeadA', { clerkUserId: null, ...deactivatedShape });

  // history for deadA that must survive reactivation
  await mkShift(deadA.id, { startTime: new Date(Date.now() - 10 * DAY), endTime: new Date(Date.now() - 10 * DAY + 8 * HOUR), date: new Date(Date.now() - 10 * DAY), status: 'COMPLETED' });
  await prisma.training.create({ data: { agencyId: agA.id, userId: deadA.id, title: 'Manual Handling', status: 'COMPLETED', completedAt: new Date('2026-01-01') } });
});

beforeEach(() => {
  // Happy path by default; individual tests override with mockRejectedValueOnce.
  clerkStub.users.banUser.mockReset().mockResolvedValue({});
  clerkStub.users.unbanUser.mockReset().mockResolvedValue({});
});

afterEach(async () => {
  await prisma.auditLog.deleteMany({ where: { agencyId: { in: [agA.id, agB.id] } } });
  await prisma.attendanceMonitor.deleteMany({ where: { agencyId: agA.id } });
  await prisma.shift.deleteMany({ where: { agencyId: agA.id, workerId: { in: [workingA.id, futureA.id] } } });
  const deactivatedShape = { status: 'DEACTIVATED', deactivatedAt: new Date('2026-01-15T00:00:00Z'), deactivatedById: hrA.id, deactivationReason: 'moved on' };
  await prisma.user.update({ where: { id: deadA.id }, data: deactivatedShape });
  await prisma.user.update({ where: { id: deadMgrA.id }, data: deactivatedShape });
  await prisma.user.update({ where: { id: deadB.id }, data: { status: 'DEACTIVATED' } });
  await prisma.user.update({ where: { id: workingA.id }, data: { status: 'ACTIVE' } });
  await prisma.user.update({ where: { id: futureA.id }, data: { status: 'ACTIVE', deactivatedAt: null, deactivatedById: null, deactivationReason: null } });
});

afterAll(async () => {
  await prisma.attendanceMonitor.deleteMany({ where: { agencyId: { in: [agA.id, agB.id] } } });
  await prisma.shift.deleteMany({ where: { agencyId: { in: [agA.id, agB.id] } } });
  await prisma.training.deleteMany({ where: { agencyId: { in: [agA.id, agB.id] } } });
  await prisma.user.updateMany({ where: { agencyId: { in: [agA.id, agB.id] } }, data: { departmentId: null, jobTitleId: null, deactivatedById: null } });
  await prisma.jobTitle.deleteMany({ where: { agencyId: { in: [agA.id, agB.id] } } });
  await prisma.department.deleteMany({ where: { agencyId: { in: [agA.id, agB.id] } } });
  await prisma.house.deleteMany({ where: { agencyId: { in: [agA.id, agB.id] } } });
  await prisma.user.deleteMany({ where: { agencyId: { in: [agA.id, agB.id] } } });
  await prisma.agency.deleteMany({ where: { id: { in: [agA.id, agB.id] } } });
  await prisma.$disconnect();
});

// ───────────────────────── Reactivation ─────────────────────────
describe('POST /users/:id/reactivate', () => {
  test('HR reactivates: status ACTIVE, deactivation metadata cleared, everything else preserved', async () => {
    const res = await as(hrA).post(`/users/${deadA.id}/reactivate`);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('ACTIVE');
    expect(res.body.data.deactivatedAt).toBeNull();
    expect(res.body.data.deactivatedBy).toBeNull();

    const fresh = await prisma.user.findUnique({ where: { id: deadA.id } });
    expect(fresh).toMatchObject({
      status: 'ACTIVE', deactivatedAt: null, deactivatedById: null, deactivationReason: null,
      employeeNumber: 'KEEP-1', departmentId: deptA.id, jobTitleId: jtA.id,
      employmentType: 'PERMANENT', workPatternType: 'FIXED', contractedHours: 30, role: 'WORKER',
      phone: '+44 7700 900123', address: '9 Elm Road', clerkUserId: `clerk_lc_deadA_${suffix}`,
    });

    // history untouched, same User.id reused
    expect(fresh.id).toBe(deadA.id);
    expect(await prisma.shift.count({ where: { workerId: deadA.id } })).toBeGreaterThanOrEqual(1);
    expect(await prisma.training.count({ where: { userId: deadA.id } })).toBeGreaterThanOrEqual(1);
  });

  test('reactivation does NOT change role (MANAGER stays MANAGER)', async () => {
    const res = await as(hrA).post(`/users/${deadMgrA.id}/reactivate`);
    expect(res.status).toBe(200);
    expect((await prisma.user.findUnique({ where: { id: deadMgrA.id } })).role).toBe('MANAGER');
  });

  test('writes a USER_REACTIVATED audit with actor / target / agency / prev + new status', async () => {
    await as(hrA).post(`/users/${deadA.id}/reactivate`);
    const audit = await prisma.auditLog.findFirst({ where: { action: 'USER_REACTIVATED', entityId: deadA.id } });
    expect(audit).toMatchObject({ actorId: hrA.id, agencyId: agA.id, entityType: 'User', newValue: { status: 'ACTIVE' } });
    expect(audit.oldValue).toMatchObject({ status: 'DEACTIVATED', deactivationReason: 'moved on' });
  });

  test('an already-active employee is rejected (400 ALREADY_ACTIVE)', async () => {
    const res = await as(hrA).post(`/users/${wkrA.id}/reactivate`);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('ALREADY_ACTIVE');
  });

  test('a cross-agency target is a tenant-safe 404 — identical to an unknown id', async () => {
    const cross = await as(hrA).post(`/users/${deadB.id}/reactivate`);
    const bogus = await as(hrA).post('/users/no-such-user-lc/reactivate');
    expect(cross.status).toBe(404);
    expect(bogus.status).toBe(404);
    expect(cross.body).toEqual(bogus.body);
    expect((await prisma.user.findUnique({ where: { id: deadB.id } })).status).toBe('DEACTIVATED');
  });

  test('a MANAGER cannot reactivate (403)', async () => {
    expect((await as(mgrA).post(`/users/${deadA.id}/reactivate`)).status).toBe(403);
    expect((await prisma.user.findUnique({ where: { id: deadA.id } })).status).toBe('DEACTIVATED');
  });

  test('a WORKER cannot reactivate (403)', async () => {
    expect((await as(wkrA).post(`/users/${deadA.id}/reactivate`)).status).toBe(403);
  });

  test('the detail + directory responses reflect ACTIVE after reactivation', async () => {
    await as(hrA).post(`/users/${deadA.id}/reactivate`);

    const detail = await as(hrA).get(`/users/${deadA.id}`);
    expect(detail.body.data.status).toBe('ACTIVE');
    expect(detail.body.data.deactivatedAt).toBeNull();

    const activeList = await as(hrA).get('/users?status=ACTIVE');
    expect(activeList.body.data.map((u) => u.id)).toContain(deadA.id);
    const deactList = await as(hrA).get('/users?status=DEACTIVATED');
    expect(deactList.body.data.map((u) => u.id)).not.toContain(deadA.id);
  });
});

// ───────────────────────── Deactivation safety ─────────────────────────
describe('deactivation active-attendance safety', () => {
  test('blocked (409 EMPLOYEE_CURRENTLY_WORKING) when the employee has an IN_PROGRESS shift; status unchanged', async () => {
    await mkShift(workingA.id, { startTime: new Date(Date.now() - HOUR), endTime: new Date(Date.now() + HOUR), date: new Date(), status: 'IN_PROGRESS' });
    const res = await as(hrA).post(`/users/${workingA.id}/deactivate`, { reason: 'trying to offboard' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('EMPLOYEE_CURRENTLY_WORKING');
    expect((await prisma.user.findUnique({ where: { id: workingA.id } })).status).toBe('ACTIVE');
    expect(clerkStub.users.banUser).not.toHaveBeenCalled(); // never banned mid-shift
  });

  test('blocked when the employee has an open AttendanceMonitor; the monitor is NOT auto-closed', async () => {
    const s = await mkShift(workingA.id, { status: 'SCHEDULED' });
    const monitor = await prisma.attendanceMonitor.create({
      data: { agencyId: agA.id, shiftId: s.id, workerId: workingA.id, houseId: houseA.id, closedAt: null },
    });
    const res = await as(hrA).post(`/users/${workingA.id}/deactivate`, { reason: 'offboarding attempt' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('EMPLOYEE_CURRENTLY_WORKING');
    expect((await prisma.attendanceMonitor.findUnique({ where: { id: monitor.id } })).closedAt).toBeNull();
    expect((await prisma.user.findUnique({ where: { id: workingA.id } })).status).toBe('ACTIVE');
    expect(clerkStub.users.banUser).not.toHaveBeenCalled(); // never banned with an open monitor
  });

  test('a normal deactivation (no active attendance) still succeeds and does NOT delete future shifts', async () => {
    await mkShift(futureA.id);
    await mkShift(futureA.id);
    const before = await prisma.shift.count({ where: { workerId: futureA.id } });

    const res = await as(hrA).post(`/users/${futureA.id}/deactivate`, { reason: 'left the company' });
    expect(res.status).toBe(200);
    expect((await prisma.user.findUnique({ where: { id: futureA.id } })).status).toBe('DEACTIVATED');

    expect(await prisma.shift.count({ where: { workerId: futureA.id } })).toBe(before); // nothing deleted
    expect(await prisma.shift.count({ where: { workerId: futureA.id, startTime: { gt: new Date() } } })).toBe(2); // still assigned
  });
});

// ───────────────────── Account Suspension / Clerk Security V1 ─────────────────────
describe('deactivation — Clerk ban', () => {
  test('a valid deactivation bans the target’s own clerkUserId, then flips local status', async () => {
    const res = await as(hrA).post(`/users/${futureA.id}/deactivate`, { reason: 'left the company' });
    expect(res.status).toBe(200);
    expect(clerkStub.users.banUser).toHaveBeenCalledTimes(1);
    expect(clerkStub.users.banUser).toHaveBeenCalledWith(`clerk_lc_futureA_${suffix}`);
    expect((await prisma.user.findUnique({ where: { id: futureA.id } })).status).toBe('DEACTIVATED');
  });

  test('a MANAGER deactivation also goes through Clerk banUser', async () => {
    const res = await as(mgrA).post(`/users/${futureA.id}/deactivate`, { reason: 'contract ended' });
    expect(res.status).toBe(200);
    expect(clerkStub.users.banUser).toHaveBeenCalledWith(`clerk_lc_futureA_${suffix}`);
  });

  test('Clerk ban failure leaves the employee ACTIVE with no success audit and no attendance/shift mutation', async () => {
    clerkStub.users.banUser.mockRejectedValueOnce(new Error('clerk 500'));
    await mkShift(futureA.id, { startTime: new Date(Date.now() + 2 * DAY) });
    const shiftsBefore = await prisma.shift.count({ where: { workerId: futureA.id } });

    const res = await as(hrA).post(`/users/${futureA.id}/deactivate`, { reason: 'left' });
    expect(res.status).toBe(502);
    expect(res.body.code).toBe('CLERK_SUSPENSION_FAILED');

    const fresh = await prisma.user.findUnique({ where: { id: futureA.id } });
    expect(fresh.status).toBe('ACTIVE');
    expect(fresh.deactivatedAt).toBeNull();
    expect(await prisma.auditLog.count({ where: { action: 'USER_DEACTIVATED', entityId: futureA.id } })).toBe(0);
    expect(await prisma.shift.count({ where: { workerId: futureA.id } })).toBe(shiftsBefore);
  });

  test('an employee with no clerkUserId is rejected (409 NO_CLERK_IDENTITY) before any Clerk call', async () => {
    const res = await as(hrA).post(`/users/${noClerkA.id}/deactivate`, { reason: 'no identity' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('NO_CLERK_IDENTITY');
    expect(clerkStub.users.banUser).not.toHaveBeenCalled();
    expect((await prisma.user.findUnique({ where: { id: noClerkA.id } })).status).toBe('ACTIVE');
  });

  test('an IN_PROGRESS shift blocks BEFORE Clerk banUser is reached', async () => {
    await mkShift(futureA.id, { startTime: new Date(Date.now() - HOUR), endTime: new Date(Date.now() + HOUR), date: new Date(), status: 'IN_PROGRESS' });
    const res = await as(hrA).post(`/users/${futureA.id}/deactivate`, { reason: 'still on shift' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('EMPLOYEE_CURRENTLY_WORKING');
    expect(clerkStub.users.banUser).not.toHaveBeenCalled();
  });
});

describe('reactivation — Clerk unban', () => {
  test('HR reactivation unbans the target’s own clerkUserId, then flips local status', async () => {
    const res = await as(hrA).post(`/users/${deadA.id}/reactivate`);
    expect(res.status).toBe(200);
    expect(clerkStub.users.unbanUser).toHaveBeenCalledTimes(1);
    expect(clerkStub.users.unbanUser).toHaveBeenCalledWith(`clerk_lc_deadA_${suffix}`);
    expect(clerkStub.users.banUser).not.toHaveBeenCalled();
    const fresh = await prisma.user.findUnique({ where: { id: deadA.id } });
    expect(fresh.status).toBe('ACTIVE');
    expect(fresh.role).toBe('WORKER');
    expect(fresh.employeeNumber).toBe('KEEP-1'); // employment metadata preserved
    expect(fresh.id).toBe(deadA.id); // same User.id
  });

  test('Clerk unban failure leaves the employee DEACTIVATED with no success audit', async () => {
    clerkStub.users.unbanUser.mockRejectedValueOnce(new Error('clerk down'));
    const res = await as(hrA).post(`/users/${deadA.id}/reactivate`);
    expect(res.status).toBe(502);
    expect(res.body.code).toBe('CLERK_REACTIVATION_FAILED');
    expect((await prisma.user.findUnique({ where: { id: deadA.id } })).status).toBe('DEACTIVATED');
    expect(await prisma.auditLog.count({ where: { action: 'USER_REACTIVATED', entityId: deadA.id } })).toBe(0);
  });

  test('a deactivated employee with no clerkUserId is rejected (409 NO_CLERK_IDENTITY) before any Clerk call', async () => {
    const res = await as(hrA).post(`/users/${noClerkDeadA.id}/reactivate`);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('NO_CLERK_IDENTITY');
    expect(clerkStub.users.unbanUser).not.toHaveBeenCalled();
    expect((await prisma.user.findUnique({ where: { id: noClerkDeadA.id } })).status).toBe('DEACTIVATED');
  });

  test('an already-active employee is rejected BEFORE Clerk unbanUser is reached', async () => {
    const res = await as(hrA).post(`/users/${wkrA.id}/reactivate`);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('ALREADY_ACTIVE');
    expect(clerkStub.users.unbanUser).not.toHaveBeenCalled();
  });
});

// ───────────────────────── Offboarding preview ─────────────────────────
describe('GET /users/:id/offboarding-preview', () => {
  test('counts future assigned shifts, in-progress shifts, training, and current role only', async () => {
    await mkShift(futureA.id, { startTime: new Date(Date.now() + 2 * DAY) });
    await mkShift(futureA.id, { startTime: new Date(Date.now() + 3 * DAY) });
    await mkShift(futureA.id, { startTime: new Date(Date.now() + 4 * DAY) });
    await mkShift(futureA.id, { startTime: new Date(Date.now() - 5 * DAY), endTime: new Date(Date.now() - 5 * DAY + HOUR), date: new Date(Date.now() - 5 * DAY), status: 'COMPLETED' });

    const res = await as(hrA).get(`/users/${futureA.id}/offboarding-preview`);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ futureShiftCount: 3, inProgressShiftCount: 0, trainingCount: 0, role: 'WORKER' });
    // no sensitive personal / compliance detail
    expect(res.body.data).not.toHaveProperty('email');
    expect(res.body.data).not.toHaveProperty('deactivationReason');
    expect(res.body.data).not.toHaveProperty('phone');
  });

  test('a MANAGER may read the preview; a WORKER cannot', async () => {
    expect((await as(mgrA).get(`/users/${futureA.id}/offboarding-preview`)).status).toBe(200);
    expect((await as(wkrA).get(`/users/${futureA.id}/offboarding-preview`)).status).toBe(403);
  });

  test('a cross-agency target is a tenant-safe 404', async () => {
    const cross = await as(hrA).get(`/users/${deadB.id}/offboarding-preview`);
    const bogus = await as(hrA).get('/users/no-such-user-lc/offboarding-preview');
    expect(cross.status).toBe(404);
    expect(bogus.status).toBe(404);
    expect(cross.body).toEqual(bogus.body);
  });

  test('shift counts only include this employee in this agency', async () => {
    // a shift for a *different* worker must not be counted
    await mkShift(wkrA.id, { startTime: new Date(Date.now() + 2 * DAY) });
    const res = await as(hrA).get(`/users/${futureA.id}/offboarding-preview`);
    expect(res.body.data.futureShiftCount).toBe(0);
    await prisma.shift.deleteMany({ where: { workerId: wkrA.id } });
  });
});
