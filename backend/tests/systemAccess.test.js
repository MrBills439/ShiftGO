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
const tokenFor = (u) => signAccess({ id: u.id, agencyId: u.agencyId, role: u.role, status: u.status, name: u.name, email: u.email });
const as = (u) => ({
  get: (p) => request(app).get(p).set('Authorization', `Bearer ${tokenFor(u)}`),
  patch: (p, b) => request(app).patch(p).set('Authorization', `Bearer ${tokenFor(u)}`).send(b || {}),
  post: (p, b) => request(app).post(p).set('Authorization', `Bearer ${tokenFor(u)}`).send(b || {}),
});
const sysAccess = (actor, targetId, role) => as(actor).patch(`/users/${targetId}/system-access`, { role });

let agA, agB, agSolo;
let hrA, hrA2, mgrA, tlA, wkrA, deadA, hrB, wkrB, hrSolo;

const mkUser = (agencyId, role, tag, extra = {}) =>
  prisma.user.create({ data: {
    agencyId, role, name: `SA ${tag}`, email: `sa-${tag}-${suffix}@shiftgo.test`, passwordHash: 'x', ...extra,
  } });

beforeAll(async () => {
  agA = await prisma.agency.create({ data: { name: `SA A ${suffix}`, employeeIdPrefix: 'SAA' } });
  agB = await prisma.agency.create({ data: { name: `SA B ${suffix}`, employeeIdPrefix: 'SAB' } });
  agSolo = await prisma.agency.create({ data: { name: `SA Solo ${suffix}`, employeeIdPrefix: 'SAS' } });

  hrA = await mkUser(agA.id, 'HR', 'hrA');
  hrA2 = await mkUser(agA.id, 'HR', 'hrA2');
  mgrA = await mkUser(agA.id, 'MANAGER', 'mgrA');
  tlA = await mkUser(agA.id, 'TEAM_LEADER', 'tlA');
  wkrA = await mkUser(agA.id, 'WORKER', 'wkrA');
  deadA = await mkUser(agA.id, 'WORKER', 'deadA', { status: 'DEACTIVATED', deactivatedAt: new Date(), deactivationReason: 'left' });

  hrB = await mkUser(agB.id, 'HR', 'hrB');
  wkrB = await mkUser(agB.id, 'WORKER', 'wkrB');

  hrSolo = await mkUser(agSolo.id, 'HR', 'hrSolo');
});

afterEach(async () => {
  await prisma.auditLog.deleteMany({ where: { agencyId: { in: [agA.id, agB.id, agSolo.id] } } });
  // restore the roles the tests mutate
  await prisma.user.update({ where: { id: wkrA.id }, data: { role: 'WORKER', status: 'ACTIVE' } });
  await prisma.user.update({ where: { id: tlA.id }, data: { role: 'TEAM_LEADER' } });
  await prisma.user.update({ where: { id: mgrA.id }, data: { role: 'MANAGER' } });
  await prisma.user.update({ where: { id: hrA2.id }, data: { role: 'HR', status: 'ACTIVE' } });
  await prisma.user.update({ where: { id: hrA.id }, data: { role: 'HR' } });
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { agencyId: { in: [agA.id, agB.id, agSolo.id] } } });
  await prisma.agency.deleteMany({ where: { id: { in: [agA.id, agB.id, agSolo.id] } } });
  await prisma.$disconnect();
});

// ───────────────────────── happy paths ─────────────────────────
describe('HR changes system access', () => {
  test('WORKER → TEAM_LEADER: role changes immediately, audit written', async () => {
    const res = await sysAccess(hrA, wkrA.id, 'TEAM_LEADER');
    expect(res.status).toBe(200);
    expect(res.body.data.role).toBe('TEAM_LEADER');

    expect((await prisma.user.findUnique({ where: { id: wkrA.id } })).role).toBe('TEAM_LEADER');

    const audit = await prisma.auditLog.findFirst({ where: { action: 'USER_SYSTEM_ACCESS_CHANGED', entityId: wkrA.id } });
    expect(audit).toMatchObject({
      actorId: hrA.id, agencyId: agA.id, entityType: 'User',
      oldValue: { role: 'WORKER' }, newValue: { role: 'TEAM_LEADER' },
    });
  });

  test('TEAM_LEADER → MANAGER', async () => {
    const res = await sysAccess(hrA, tlA.id, 'MANAGER');
    expect(res.status).toBe(200);
    expect((await prisma.user.findUnique({ where: { id: tlA.id } })).role).toBe('MANAGER');
  });

  test('MANAGER → HR', async () => {
    const res = await sysAccess(hrA, mgrA.id, 'HR');
    expect(res.status).toBe(200);
    expect((await prisma.user.findUnique({ where: { id: mgrA.id } })).role).toBe('HR');
  });
});

describe('guards, validation and safety rules', () => {
  test('a MANAGER cannot change system access (403)', async () => {
    expect((await sysAccess(mgrA, wkrA.id, 'TEAM_LEADER')).status).toBe(403);
  });

  test('a WORKER cannot change system access (403)', async () => {
    expect((await sysAccess(wkrA, tlA.id, 'MANAGER')).status).toBe(403);
  });

  test('an invalid role is rejected (400)', async () => {
    const res = await sysAccess(hrA, wkrA.id, 'SUPERADMIN');
    expect(res.status).toBe(400);
  });

  test('changing to the same role is rejected (400 SAME_ROLE)', async () => {
    const res = await sysAccess(hrA, wkrA.id, 'WORKER');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('SAME_ROLE');
  });

  test('HR cannot change their own system access (403 SELF_ROLE_CHANGE)', async () => {
    // hrA2 is still active HR, so this is blocked by the SELF rule, not LAST_HR.
    const res = await sysAccess(hrA, hrA.id, 'MANAGER');
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('SELF_ROLE_CHANGE');
  });

  test('the last active HR of an agency cannot be downgraded (400 LAST_HR_REQUIRED)', async () => {
    const res = await sysAccess(hrSolo, hrSolo.id, 'MANAGER');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('LAST_HR_REQUIRED');
    expect((await prisma.user.findUnique({ where: { id: hrSolo.id } })).role).toBe('HR');
  });

  test('an HR CAN be downgraded while another active HR remains', async () => {
    const res = await sysAccess(hrA, hrA2.id, 'MANAGER');
    expect(res.status).toBe(200);
    expect((await prisma.user.findUnique({ where: { id: hrA2.id } })).role).toBe('MANAGER');
  });

  test('a DEACTIVATED employee cannot have their system access changed (400 USER_DEACTIVATED)', async () => {
    const res = await sysAccess(hrA, deadA.id, 'TEAM_LEADER');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('USER_DEACTIVATED');
  });
});

// ───────────────────────── tenant isolation ─────────────────────────
describe('tenant isolation', () => {
  test('a cross-agency target is a 404 — identical to an unknown id', async () => {
    const cross = await sysAccess(hrA, wkrB.id, 'TEAM_LEADER');
    const bogus = await sysAccess(hrA, 'no-such-user-000', 'TEAM_LEADER');
    expect(cross.status).toBe(404);
    expect(bogus.status).toBe(404);
    expect(cross.body).toEqual(bogus.body);
    expect((await prisma.user.findUnique({ where: { id: wkrB.id } })).role).toBe('WORKER');
  });
});

// ───────────────────────── webhook idempotency ─────────────────────────

describe('the change applies immediately', () => {
  test('a worker promoted to TEAM_LEADER can use team-leader endpoints on their next request', async () => {
    expect((await as(wkrA).get('/staff/allocation')).status).toBe(403);
    expect((await sysAccess(hrA, wkrA.id, 'TEAM_LEADER')).status).toBe(200);
    // same (old) token — the role is read from the database, not the token
    expect((await as(wkrA).get('/staff/allocation')).status).not.toBe(403);
  });
});
