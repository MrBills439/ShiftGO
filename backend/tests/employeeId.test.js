process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-access-secret';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test-refresh-secret';
process.env.RATE_LIMIT_DISABLED = 'true';

const request = require('supertest');
const { PrismaClient } = require('@prisma/client');

let mockInvitationId = 'inv_eid';
jest.mock('../src/utils/clerkClient', () => ({
  organizations: {
    createOrganizationInvitation: jest.fn(async () => ({ id: mockInvitationId, status: 'pending' })),
  },
  users: { getUser: jest.fn() },
}));
const clerkStub = require('../src/utils/clerkClient');

const app = require('../src/app');
const { signAccess } = require('../src/utils/jwt');
const { generateEmployeeId, normalizeEmployeeIdPrefix } = require('../src/services/employeeIdService');

const prisma = new PrismaClient();
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const tokenFor = (u) => signAccess({ id: u.id, agencyId: u.agencyId, role: u.role, status: u.status, name: u.name, email: u.email });
const as = (u) => ({
  get: (p) => request(app).get(p).set('Authorization', `Bearer ${tokenFor(u)}`),
  post: (p, b) => request(app).post(p).set('Authorization', `Bearer ${tokenFor(u)}`).send(b || {}),
  patch: (p, b) => request(app).patch(p).set('Authorization', `Bearer ${tokenFor(u)}`).send(b || {}),
});

let agA, agB, agCon, agNo;
let hrA, hrB, hrCon, hrNo, mgrNo;

const mkAgency = (tag, extra = {}) =>
  prisma.agency.create({ data: { name: `EID ${tag} ${suffix}`, clerkOrgId: `org_eid_${tag}_${suffix}`, ...extra } });
const mkUser = (agencyId, role, tag) =>
  prisma.user.create({ data: { agencyId, role, name: `EID ${tag}`, email: `eid-${tag}-${suffix}@shiftgo.test`, passwordHash: 'x' } });

beforeAll(async () => {
  agA = await mkAgency('a', { employeeIdPrefix: 'SEQ' });
  agB = await mkAgency('b', { employeeIdPrefix: 'DUP' });
  agCon = await mkAgency('con', { employeeIdPrefix: 'CON' });
  agNo = await mkAgency('no'); // no prefix
  hrA = await mkUser(agA.id, 'HR', 'hrA');
  hrB = await mkUser(agB.id, 'HR', 'hrB');
  hrCon = await mkUser(agCon.id, 'HR', 'hrCon');
  hrNo = await mkUser(agNo.id, 'HR', 'hrNo');
  mgrNo = await mkUser(agNo.id, 'MANAGER', 'mgrNo');
});

afterEach(async () => {
  const ids = [agA.id, agB.id, agCon.id, agNo.id];
  await prisma.auditLog.deleteMany({ where: { agencyId: { in: ids } } });
  await prisma.pendingEmployee.deleteMany({ where: { agencyId: { in: ids } } });
  await prisma.user.deleteMany({ where: { agencyId: { in: ids }, email: { contains: 'hire' } } });
  // reset the sequence-under-test agency to a known state
  await prisma.agency.update({ where: { id: agA.id }, data: { employeeIdPrefix: 'SEQ', employeeIdNextNumber: 1 } });
});

afterAll(async () => {
  const ids = [agA.id, agB.id, agCon.id, agNo.id];
  await prisma.user.deleteMany({ where: { agencyId: { in: ids } } });
  await prisma.agency.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
});

const hire = (hr, over = {}) => {
  mockInvitationId = `inv_${Math.random().toString(16).slice(2)}`;
  return as(hr).post('/users', {
    name: 'New Hire', email: `newhire-${Math.random().toString(16).slice(2)}-${suffix}@shiftgo.test`,
    role: 'WORKER', ...over,
  });
};

// ───────────────────────── prefix settings ──────────────────────────────
describe('Employee ID prefix — Agency settings', () => {
  test('HR sets the prefix; it is normalised to uppercase and echoed with a next-id preview', async () => {
    const res = await as(hrA).patch('/agency', { employeeIdPrefix: '  pip ' });
    expect(res.status).toBe(200);
    expect(res.body.data.employeeIdPrefix).toBe('PIP');
    expect(res.body.data.nextEmployeeIdPreview).toBe('PIP-0001');
    expect(res.body.data).not.toHaveProperty('employeeIdNextNumber'); // raw counter never exposed

    const got = await as(hrA).get('/agency');
    expect(got.body.data.employeeIdPrefix).toBe('PIP');
    expect(got.body.data.nextEmployeeIdPreview).toBe('PIP-0001');
  });

  test('invalid prefixes are rejected (too short, too long, punctuation)', async () => {
    for (const bad of ['A', 'TOOLONGGG', 'PI P', 'PI.P', 'PÎP']) {
      const res = await as(hrA).patch('/agency', { employeeIdPrefix: bad });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INVALID_EMPLOYEE_ID_PREFIX');
    }
    // and the sequence-under-test agency still has its original prefix
    expect((await as(hrA).get('/agency')).body.data.employeeIdPrefix).toBe('SEQ');
  });

  test('a manager cannot change the prefix', async () => {
    expect((await as(mgrNo).patch('/agency', { employeeIdPrefix: 'MGR' })).status).toBe(403);
  });

  test('normalizeEmployeeIdPrefix unit behaviour', () => {
    expect(normalizeEmployeeIdPrefix('pip')).toBe('PIP');
    expect(normalizeEmployeeIdPrefix('  scm  ')).toBe('SCM'); // ends trimmed
    expect(normalizeEmployeeIdPrefix('AB12')).toBe('AB12');
    expect(normalizeEmployeeIdPrefix('')).toBeNull();
    expect(normalizeEmployeeIdPrefix(null)).toBeNull();
    expect(() => normalizeEmployeeIdPrefix('x')).toThrow();          // too short
    expect(() => normalizeEmployeeIdPrefix('abcdefghi')).toThrow();  // too long
    expect(() => normalizeEmployeeIdPrefix('A B')).toThrow();        // interior space
    expect(() => normalizeEmployeeIdPrefix('A-B')).toThrow();        // punctuation
  });
});

// ───────────────────────── generation ───────────────────────────────────
describe('Employee ID auto-generation on invite', () => {
  test('first hire gets PREFIX-0001, the second gets PREFIX-0002', async () => {
    const a = await hire(hrA);
    const b = await hire(hrA);
    expect(a.body.data.employeeNumber).toBe('SEQ-0001');
    expect(b.body.data.employeeNumber).toBe('SEQ-0002');
    // staged on the PendingEmployee row, not invented client-side
    const rows = await prisma.pendingEmployee.findMany({ where: { agencyId: agA.id }, orderBy: { employeeNumber: 'asc' } });
    expect(rows.map((r) => r.employeeNumber)).toEqual(['SEQ-0001', 'SEQ-0002']);
  });

  test('padding is a minimum of 4 digits and is NOT capped', async () => {
    await prisma.agency.update({ where: { id: agA.id }, data: { employeeIdNextNumber: 9999 } });
    expect((await hire(hrA)).body.data.employeeNumber).toBe('SEQ-9999');
    expect((await hire(hrA)).body.data.employeeNumber).toBe('SEQ-10000');
    expect((await hire(hrA)).body.data.employeeNumber).toBe('SEQ-10001');
  });

  test('an agency with no prefix cannot auto-generate — clear 400', async () => {
    const res = await hire(hrNo);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('NO_EMPLOYEE_ID_PREFIX');
    expect(res.body.message).toMatch(/prefix/i);
    expect(clerkStub.organizations.createOrganizationInvitation).not.toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: agNo.clerkOrgId }),
    );
    expect(await prisma.pendingEmployee.count({ where: { agencyId: agNo.id } })).toBe(0);
  });

  test('the same number is valid in a different agency (uniqueness is per-agency)', async () => {
    const a = await hire(hrA);
    const b = await hire(hrB);
    expect(a.body.data.employeeNumber).toBe('SEQ-0001');
    expect(b.body.data.employeeNumber).toBe('DUP-0001');
    // both rows exist, one per agency
    expect(await prisma.pendingEmployee.count({ where: { employeeNumber: { endsWith: '-0001' } } })).toBeGreaterThanOrEqual(2);
  });
});

// ───────────────────────── custom override ──────────────────────────────
describe('Custom Employee ID override', () => {
  test('a supplied employeeNumber is used verbatim and does NOT consume the counter', async () => {
    const res = await hire(hrA, { employeeNumber: 'MANUAL-1' });
    expect(res.status).toBe(201);
    expect(res.body.data.employeeNumber).toBe('MANUAL-1');
    const ag = await prisma.agency.findUnique({ where: { id: agA.id } });
    expect(ag.employeeIdNextNumber).toBe(1); // untouched

    // next auto hire is still SEQ-0001
    expect((await hire(hrA)).body.data.employeeNumber).toBe('SEQ-0001');
  });

  test('a custom employeeNumber that an existing user already holds is rejected 409', async () => {
    await prisma.user.create({
      data: { agencyId: agA.id, role: 'WORKER', name: 'Has It', email: `hasit-${suffix}@shiftgo.test`, passwordHash: 'x', employeeNumber: 'TAKEN-1' },
    });
    const dup = await hire(hrA, { employeeNumber: 'TAKEN-1' });
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe('DUPLICATE_EMPLOYEE_NUMBER');
    // same string is fine in another agency
    expect((await hire(hrB, { employeeNumber: 'TAKEN-1' })).status).toBe(201);
    await prisma.user.deleteMany({ where: { email: `hasit-${suffix}@shiftgo.test` } });
  });

  test('an auto number skips a slot already taken by a manual id (no duplicates)', async () => {
    // manually create a user holding SEQ-0001
    await prisma.user.create({
      data: { agencyId: agA.id, role: 'WORKER', name: 'Holder', email: `holder-${suffix}@shiftgo.test`, passwordHash: 'x', employeeNumber: 'SEQ-0001' },
    });
    const a = await hire(hrA); // sequence is at 1 -> candidate SEQ-0001 clashes -> skips to SEQ-0002
    expect(a.body.data.employeeNumber).toBe('SEQ-0002');
    await prisma.user.deleteMany({ where: { email: `holder-${suffix}@shiftgo.test` } });
  });
});

// ───────────────────────── prefix change ────────────────────────────────
describe('Prefix change', () => {
  test('changing the prefix preserves existing IDs and CONTINUES the sequence', async () => {
    const first = await hire(hrA);
    const second = await hire(hrA);
    expect([first, second].map((r) => r.body.data.employeeNumber)).toEqual(['SEQ-0001', 'SEQ-0002']);

    const changed = await as(hrA).patch('/agency', { employeeIdPrefix: 'SHIFT' });
    expect(changed.status).toBe(200);
    expect(changed.body.data.nextEmployeeIdPreview).toBe('SHIFT-0003'); // counter NOT reset

    const third = await hire(hrA);
    expect(third.body.data.employeeNumber).toBe('SHIFT-0003');

    // the earlier rows keep their old prefix
    const rows = await prisma.pendingEmployee.findMany({ where: { agencyId: agA.id }, orderBy: { createdAt: 'asc' } });
    expect(rows.map((r) => r.employeeNumber)).toEqual(['SEQ-0001', 'SEQ-0002', 'SHIFT-0003']);
  });
});

// ───────────────────────── Clerk failure + retry ────────────────────────
describe('Clerk failure and retry', () => {
  test('a failed Clerk invite leaves a gap; the next hire does not reuse the number', async () => {
    const quota = new Error('quota'); quota.errors = [{ code: 'organization_membership_quota_exceeded' }];
    clerkStub.organizations.createOrganizationInvitation.mockRejectedValueOnce(quota);

    const failed = await hire(hrA);
    expect(failed.status).toBe(403); // number SEQ-0001 was reserved then abandoned
    expect(await prisma.pendingEmployee.count({ where: { agencyId: agA.id } })).toBe(0); // rolled back

    const next = await hire(hrA);
    expect(next.body.data.employeeNumber).toBe('SEQ-0002'); // gap at 0001, no reuse, no dup
  });

  test('retrying a still-staged invite reuses the staged Employee ID (no fresh number)', async () => {
    const email = `newhire-retry-${suffix}@shiftgo.test`;
    mockInvitationId = `inv_retry_${suffix}`;
    const first = await as(hrA).post('/users', { name: 'Retry', email, role: 'WORKER' });
    expect(first.body.data.employeeNumber).toBe('SEQ-0001');

    // re-invite the same email (pending row still there) — must reuse SEQ-0001
    const dupe = new Error('dup'); dupe.errors = [{ code: 'duplicate_record' }];
    clerkStub.organizations.createOrganizationInvitation.mockRejectedValueOnce(dupe);
    const retry = await as(hrA).post('/users', { name: 'Retry', email, role: 'WORKER' });
    expect(retry.status).toBe(409);

    const pending = await prisma.pendingEmployee.findUnique({ where: { agencyId_email: { agencyId: agA.id, email } } });
    expect(pending.employeeNumber).toBe('SEQ-0001');
    const ag = await prisma.agency.findUnique({ where: { id: agA.id } });
    expect(ag.employeeIdNextNumber).toBe(2); // only the first hire advanced it
  });
});

// ───────────────────────── concurrency ──────────────────────────────────
describe('Concurrency', () => {
  test('two simultaneous generateEmployeeId calls never return the same number', async () => {
    await prisma.agency.update({ where: { id: agCon.id }, data: { employeeIdNextNumber: 1 } });
    const [a, b] = await Promise.all([generateEmployeeId(agCon.id), generateEmployeeId(agCon.id)]);
    expect(a).not.toBe(b);
    expect([a, b].sort()).toEqual(['CON-0001', 'CON-0002']);
  });

  test('many simultaneous hires get a contiguous, duplicate-free block of IDs', async () => {
    await prisma.agency.update({ where: { id: agCon.id }, data: { employeeIdNextNumber: 1 } });
    await prisma.pendingEmployee.deleteMany({ where: { agencyId: agCon.id } });

    const N = 8;
    const results = await Promise.all(Array.from({ length: N }, () => hire(hrCon)));
    const numbers = results.map((r) => r.body.data.employeeNumber);
    expect(new Set(numbers).size).toBe(N); // all distinct
    expect([...numbers].sort()).toEqual(
      Array.from({ length: N }, (_, i) => `CON-${String(i + 1).padStart(4, '0')}`),
    );
    await prisma.pendingEmployee.deleteMany({ where: { agencyId: agCon.id } });
    await prisma.user.deleteMany({ where: { agencyId: agCon.id, email: { contains: 'hire' } } });
  });
});

// ───────────────────────── multi-tenancy + backfill ─────────────────────
describe('Multi-tenancy & existing data', () => {
  test('agency A cannot read agency B prefix or consume agency B counter', async () => {
    await as(hrB).patch('/agency', { employeeIdPrefix: 'SECRET8' });
    const aView = await as(hrA).get('/agency');
    expect(aView.body.data.employeeIdPrefix).toBe('SEQ'); // its own, never B's

    const beforeB = await prisma.agency.findUnique({ where: { id: agB.id } });
    await hire(hrA); // advances A only
    const afterB = await prisma.agency.findUnique({ where: { id: agB.id } });
    expect(afterB.employeeIdNextNumber).toBe(beforeB.employeeIdNextNumber);
    await prisma.agency.update({ where: { id: agB.id }, data: { employeeIdPrefix: 'DUP' } });
  });

  test('existing users with employeeNumber = null are never auto-filled', async () => {
    const legacy = await prisma.user.create({
      data: { agencyId: agA.id, role: 'WORKER', name: 'Legacy', email: `legacy-${suffix}@shiftgo.test`, passwordHash: 'x' },
    });
    expect(legacy.employeeNumber).toBeNull();

    await hire(hrA); // a new hire runs the generator
    const still = await prisma.user.findUnique({ where: { id: legacy.id } });
    expect(still.employeeNumber).toBeNull(); // untouched

    await prisma.user.delete({ where: { id: legacy.id } });
  });
});
