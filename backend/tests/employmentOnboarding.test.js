process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-access-secret';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test-refresh-secret';
process.env.RATE_LIMIT_DISABLED = 'true';

const request = require('supertest');
const { PrismaClient } = require('@prisma/client');

// Clerk stubs. The invitation just returns an id; getUser returns whatever the
// current test sets via `mockClerkUser`.
let mockInvitationId = 'inv_x';
let mockClerkUser = null;
jest.mock('../src/utils/clerkClient', () => ({
  organizations: {
    createOrganizationInvitation: jest.fn(async () => ({ id: mockInvitationId, status: 'pending' })),
  },
  users: {
    getUser: jest.fn(async () => mockClerkUser),
  },
}));
jest.mock('@clerk/express/webhooks', () => ({ verifyWebhook: jest.fn() }));
const { verifyWebhook } = require('@clerk/express/webhooks');

const app = require('../src/app');
const { signAccess } = require('../src/utils/jwt');
const appPrisma = require('../src/lib/prisma');
const clerkStub = require('../src/utils/clerkClient');

const prisma = new PrismaClient();
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const tokenFor = (u) => signAccess({ id: u.id, agencyId: u.agencyId, role: u.role, status: u.status, name: u.name, email: u.email });
const as = (u) => ({
  get: (p) => request(app).get(p).set('Authorization', `Bearer ${tokenFor(u)}`),
  post: (p, b) => request(app).post(p).set('Authorization', `Bearer ${tokenFor(u)}`).send(b || {}),
  patch: (p, b) => request(app).patch(p).set('Authorization', `Bearer ${tokenFor(u)}`).send(b || {}),
});
const postEvent = (event) => {
  verifyWebhook.mockResolvedValueOnce(event);
  return request(app).post('/webhooks/clerk').set('Content-Type', 'application/json').send('{}');
};

let agencyA, agencyB, hrA, mgrA, wkrA, hrB;
let deptCareA, deptOpsA, jtSupportA, locHouseA, locOfficeA, deptCareB;

const mkUser = (agencyId, role, tag, extra = {}) =>
  prisma.user.create({ data: { agencyId, role, name: `Emp ${tag}`, email: `emp-${tag}-${suffix}@shiftgo.test`, passwordHash: 'x', ...extra } });

beforeAll(async () => {
  agencyA = await prisma.agency.create({ data: { name: `Emp A ${suffix}`, clerkOrgId: `org_a_${suffix}` } });
  agencyB = await prisma.agency.create({ data: { name: `Emp B ${suffix}`, clerkOrgId: `org_b_${suffix}` } });
  hrA = await mkUser(agencyA.id, 'HR', 'hrA');
  mgrA = await mkUser(agencyA.id, 'MANAGER', 'mgrA');
  wkrA = await mkUser(agencyA.id, 'WORKER', 'wkrA');
  hrB = await mkUser(agencyB.id, 'HR', 'hrB');

  deptCareA = await prisma.department.create({ data: { agencyId: agencyA.id, name: 'Care' } });
  deptOpsA = await prisma.department.create({ data: { agencyId: agencyA.id, name: 'Operations' } });
  deptCareB = await prisma.department.create({ data: { agencyId: agencyB.id, name: 'Care' } });
  jtSupportA = await prisma.jobTitle.create({ data: { agencyId: agencyA.id, name: 'Support Worker', departmentId: deptCareA.id } });
  locHouseA = await prisma.location.create({ data: { agencyId: agencyA.id, name: 'Canterbury House', type: 'SUPPORTED_LIVING' } });
  locOfficeA = await prisma.location.create({ data: { agencyId: agencyA.id, name: 'Head Office', type: 'OFFICE' } });
});

afterEach(async () => {
  await prisma.auditLog.deleteMany({ where: { agencyId: { in: [agencyA.id, agencyB.id] } } });
  await prisma.pendingEmployee.deleteMany({ where: { agencyId: { in: [agencyA.id, agencyB.id] } } });
  await prisma.user.deleteMany({ where: { agencyId: { in: [agencyA.id, agencyB.id] }, email: { contains: 'newhire' } } });
  await prisma.user.updateMany({
    where: { id: { in: [wkrA.id, mgrA.id] } },
    data: { departmentId: null, jobTitleId: null, primaryLocationId: null, lineManagerId: null, employeeNumber: null, employmentType: null, workPatternType: 'ROTA', contractedHours: null },
  });
});

afterAll(async () => {
  await prisma.jobTitle.deleteMany({ where: { agencyId: { in: [agencyA.id, agencyB.id] } } });
  await prisma.department.deleteMany({ where: { agencyId: { in: [agencyA.id, agencyB.id] } } });
  await prisma.location.deleteMany({ where: { agencyId: { in: [agencyA.id, agencyB.id] } } });
  await prisma.user.deleteMany({ where: { agencyId: { in: [agencyA.id, agencyB.id] } } });
  await prisma.agency.deleteMany({ where: { id: { in: [agencyA.id, agencyB.id] } } });
  await prisma.$disconnect();
});

const membershipEvent = (orgClerkId, clerkUserId, orgRole = 'org:worker') => ({
  type: 'organizationMembership.created',
  data: { role: orgRole, organization: { id: orgClerkId }, public_user_data: { user_id: clerkUserId } },
});

// ─────────────────────── HR create employee → staging ─────────────────────
describe('HR create employee — employment data is staged', () => {
  test('creates a PendingEmployee with all employment fields for this agency', async () => {
    mockInvitationId = `inv_full_${suffix}`;
    const email = `newhire-full-${suffix}@shiftgo.test`;
    const res = await as(hrA).post('/users', {
      name: 'Grace Newhire', email, role: 'WORKER',
      employeeNumber: 'E-1001', departmentId: deptCareA.id, jobTitleId: jtSupportA.id,
      primaryLocationId: locHouseA.id, lineManagerId: mgrA.id,
      contractedHours: 36, workPatternType: 'ROTA', employmentType: 'PERMANENT',
    });
    expect(res.status).toBe(201);

    const pending = await prisma.pendingEmployee.findUnique({ where: { agencyId_email: { agencyId: agencyA.id, email } } });
    expect(pending).toMatchObject({
      agencyId: agencyA.id, role: 'WORKER', employeeNumber: 'E-1001',
      departmentId: deptCareA.id, jobTitleId: jtSupportA.id, primaryLocationId: locHouseA.id,
      lineManagerId: mgrA.id, contractedHours: 36, workPatternType: 'ROTA', employmentType: 'PERMANENT',
      invitedById: hrA.id, consumedAt: null,
    });
    expect(pending.invitationId).toBe(mockInvitationId);
  });

  test('a cross-agency department / job title / location is rejected before any invite is sent', async () => {
    const clerkClient = require('../src/utils/clerkClient');
    clerkClient.organizations.createOrganizationInvitation.mockClear();

    const bad = await as(hrA).post('/users', {
      name: 'Bad Dept', email: `newhire-baddept-${suffix}@shiftgo.test`, role: 'WORKER', departmentId: deptCareB.id,
    });
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe('INVALID_DEPARTMENT');
    expect(clerkClient.organizations.createOrganizationInvitation).not.toHaveBeenCalled();
    expect(await prisma.pendingEmployee.count({ where: { agencyId: agencyA.id } })).toBe(0);
  });

  test('existing create (no employment fields) still works exactly as before', async () => {
    mockInvitationId = `inv_plain_${suffix}`;
    const res = await as(hrA).post('/users', { name: 'Plain', email: `newhire-plain-${suffix}@shiftgo.test`, role: 'WORKER' });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ role: 'WORKER', status: 'pending' });
  });
});

// ─────────────────────────── validation on update ────────────────────────
describe('employment validation on PATCH /users/:id', () => {
  test('invalid job title / location / line manager are rejected', async () => {
    const jtB = await prisma.jobTitle.create({ data: { agencyId: agencyB.id, name: `X-${suffix}` } });
    expect((await as(hrA).patch(`/users/${wkrA.id}`, { jobTitleId: jtB.id })).body.code).toBe('INVALID_JOB_TITLE');
    const locB = await prisma.location.create({ data: { agencyId: agencyB.id, name: `LB-${suffix}`, type: 'OFFICE' } });
    expect((await as(hrA).patch(`/users/${wkrA.id}`, { primaryLocationId: locB.id })).body.code).toBe('INVALID_LOCATION');
    expect((await as(hrA).patch(`/users/${wkrA.id}`, { lineManagerId: hrB.id })).body.code).toBe('INVALID_LINE_MANAGER');
    await prisma.jobTitle.delete({ where: { id: jtB.id } });
    await prisma.location.delete({ where: { id: locB.id } });
  });

  test('a user cannot be their own line manager', async () => {
    const res = await as(hrA).patch(`/users/${wkrA.id}`, { lineManagerId: wkrA.id });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('SELF_LINE_MANAGER');
  });

  test('employee number is unique per agency, but the same number is allowed in another agency', async () => {
    expect((await as(hrA).patch(`/users/${wkrA.id}`, { employeeNumber: 'DUP-1' })).status).toBe(200);
    const dup = await as(hrA).patch(`/users/${mgrA.id}`, { employeeNumber: 'DUP-1' });
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe('DUPLICATE_EMPLOYEE_NUMBER');
    // agency B: same number is fine
    expect((await as(hrB).patch(`/users/${hrB.id}`, { employeeNumber: 'DUP-1' })).status).toBe(200);
    await prisma.user.update({ where: { id: hrB.id }, data: { employeeNumber: null } });
  });

  test('a matching Department + Job Title pair is accepted', async () => {
    const res = await as(hrA).patch(`/users/${wkrA.id}`, { departmentId: deptCareA.id, jobTitleId: jtSupportA.id });
    expect(res.status).toBe(200);
    expect(res.body.data.department.id).toBe(deptCareA.id);
    expect(res.body.data.jobTitle.id).toBe(jtSupportA.id);
  });

  test('a Job Title from another department is rejected with JOB_TITLE_DEPARTMENT_MISMATCH', async () => {
    // jtSupportA belongs to Care; pairing it with Operations must fail.
    const res = await as(hrA).patch(`/users/${wkrA.id}`, { jobTitleId: jtSupportA.id, departmentId: deptOpsA.id });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('JOB_TITLE_DEPARTMENT_MISMATCH');
  });

  test('a legacy Job Title with no department fits any department', async () => {
    const jtLegacy = await prisma.jobTitle.create({ data: { agencyId: agencyA.id, name: `Legacy ${suffix}` } });
    const res = await as(hrA).patch(`/users/${wkrA.id}`, { departmentId: deptOpsA.id, jobTitleId: jtLegacy.id });
    expect(res.status).toBe(200);
    expect(res.body.data.department.id).toBe(deptOpsA.id);
    expect(res.body.data.jobTitle.id).toBe(jtLegacy.id);
  });

  test('changing only the department to one incompatible with the existing job title is rejected', async () => {
    await as(hrA).patch(`/users/${wkrA.id}`, { departmentId: deptCareA.id, jobTitleId: jtSupportA.id });
    const res = await as(hrA).patch(`/users/${wkrA.id}`, { departmentId: deptOpsA.id }); // job title stays = Care's
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('JOB_TITLE_DEPARTMENT_MISMATCH');
  });

  test('POST /users with a matching Department + Job Title succeeds and stages both', async () => {
    mockInvitationId = `inv_match_${suffix}`;
    const email = `newhire-match-${suffix}@shiftgo.test`;
    const res = await as(hrA).post('/users', {
      name: 'Matched Hire', email, role: 'WORKER', departmentId: deptCareA.id, jobTitleId: jtSupportA.id,
    });
    expect(res.status).toBe(201);
    const pending = await prisma.pendingEmployee.findUnique({ where: { agencyId_email: { agencyId: agencyA.id, email } } });
    expect(pending).toMatchObject({ departmentId: deptCareA.id, jobTitleId: jtSupportA.id });
  });

  test('POST /users with a mismatched Department + Job Title is rejected before any invite', async () => {
    const clerkClient = require('../src/utils/clerkClient');
    clerkClient.organizations.createOrganizationInvitation.mockClear();
    const res = await as(hrA).post('/users', {
      name: 'Bad Pair', email: `newhire-badpair-${suffix}@shiftgo.test`, role: 'WORKER',
      departmentId: deptOpsA.id, jobTitleId: jtSupportA.id, // jtSupportA = Care
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('JOB_TITLE_DEPARTMENT_MISMATCH');
    expect(clerkClient.organizations.createOrganizationInvitation).not.toHaveBeenCalled();
    expect(await prisma.pendingEmployee.count({ where: { agencyId: agencyA.id } })).toBe(0);
  });

  test("re-parenting a Job Title's department does NOT mutate existing employees and does not block unrelated edits", async () => {
    const deptIT = await prisma.department.create({ data: { agencyId: agencyA.id, name: `IT ${suffix}` } });
    const deptEng = await prisma.department.create({ data: { agencyId: agencyA.id, name: `Engineering ${suffix}` } });
    const jtDev = await prisma.jobTitle.create({ data: { agencyId: agencyA.id, name: `Developer ${suffix}`, departmentId: deptIT.id } });

    // employee: IT / Developer (consistent)
    expect((await as(hrA).patch(`/users/${wkrA.id}`, { departmentId: deptIT.id, jobTitleId: jtDev.id })).status).toBe(200);

    // HR re-parents the Developer title to Engineering
    expect((await as(hrA).patch(`/job-titles/${jtDev.id}`, { departmentId: deptEng.id })).status).toBe(200);

    // the employee is untouched
    const after = await as(hrA).get(`/users/${wkrA.id}`);
    expect(after.body.data.departmentId).toBe(deptIT.id);
    expect(after.body.data.jobTitleId).toBe(jtDev.id);

    // an unrelated edit still saves even though the pair is now technically stale
    expect((await as(hrA).patch(`/users/${wkrA.id}`, { contractedHours: 21 })).status).toBe(200);
    // and re-sending the same (now-stale) pair is not treated as a new mismatch
    expect((await as(hrA).patch(`/users/${wkrA.id}`, { departmentId: deptIT.id, jobTitleId: jtDev.id })).status).toBe(200);
  });
});

// ─────────────────────────── directory ───────────────────────────────────
describe('employee directory', () => {
  test('GET /users response includes the employment relations; a bare user still works', async () => {
    await as(hrA).patch(`/users/${wkrA.id}`, {
      departmentId: deptCareA.id, jobTitleId: jtSupportA.id, primaryLocationId: locHouseA.id,
      lineManagerId: mgrA.id, employeeNumber: 'DIR-1', contractedHours: 30, employmentType: 'BANK',
    });
    const one = await as(hrA).get(`/users/${wkrA.id}`);
    expect(one.body.data).toMatchObject({
      employeeNumber: 'DIR-1', workPatternType: 'ROTA', employmentType: 'BANK', contractedHours: 30,
      department: { id: deptCareA.id, name: 'Care' },
      jobTitle: { id: jtSupportA.id, name: 'Support Worker' },
      primaryLocation: { id: locHouseA.id, name: 'Canterbury House', type: 'SUPPORTED_LIVING' },
      lineManager: { id: mgrA.id },
    });

    const bare = await as(hrA).get(`/users/${hrA.id}`);
    expect(bare.status).toBe(200);
    expect(bare.body.data.department).toBeNull();
    expect(bare.body.data.workPatternType).toBe('ROTA');
  });

  test('GET /users supports employment filters and keeps the role/status filters', async () => {
    await as(hrA).patch(`/users/${wkrA.id}`, { departmentId: deptCareA.id, workPatternType: 'FIXED' });
    await as(hrA).patch(`/users/${mgrA.id}`, { departmentId: deptOpsA.id });

    const byDept = await as(hrA).get(`/users?departmentId=${deptCareA.id}`);
    expect(byDept.body.data.map((u) => u.id)).toEqual([wkrA.id]);

    const byPattern = await as(hrA).get('/users?workPatternType=FIXED');
    expect(byPattern.body.data.map((u) => u.id)).toContain(wkrA.id);
    expect(byPattern.body.data.map((u) => u.id)).not.toContain(mgrA.id);

    const byRole = await as(hrA).get('/users?role=MANAGER');
    expect(byRole.body.data.every((u) => u.role === 'MANAGER')).toBe(true);
  });
});

// ─────────────────────────── webhook consumption ─────────────────────────
describe('onboarding — webhook consumes staged employment data', () => {
  test('membership.created applies the pending employment data and marks it consumed', async () => {
    const email = `newhire-webhook-${suffix}@shiftgo.test`;
    mockInvitationId = `inv_wh_${suffix}`;
    await as(hrA).post('/users', {
      name: 'Webhook Hire', email, role: 'WORKER',
      departmentId: deptCareA.id, jobTitleId: jtSupportA.id, primaryLocationId: locHouseA.id,
      employeeNumber: 'WH-1', contractedHours: 36, employmentType: 'PERMANENT',
    });

    const clerkUserId = `user_wh_${suffix}`;
    mockClerkUser = { firstName: 'Webhook', lastName: 'Hire', primaryEmailAddressId: 'e1', emailAddresses: [{ id: 'e1', emailAddress: email }] };
    const res = await postEvent(membershipEvent(agencyA.clerkOrgId, clerkUserId));
    expect(res.status).toBe(200);

    const user = await prisma.user.findUnique({ where: { clerkUserId } });
    expect(user).toMatchObject({
      agencyId: agencyA.id, role: 'WORKER',
      departmentId: deptCareA.id, jobTitleId: jtSupportA.id, primaryLocationId: locHouseA.id,
      employeeNumber: 'WH-1', contractedHours: 36, employmentType: 'PERMANENT', workPatternType: 'ROTA',
    });
    const pending = await prisma.pendingEmployee.findUnique({ where: { agencyId_email: { agencyId: agencyA.id, email } } });
    expect(pending.consumedAt).not.toBeNull();
  });

  test('a duplicate webhook delivery is idempotent (no second apply, consumedAt unchanged)', async () => {
    const email = `newhire-webhook-idem-${suffix}@shiftgo.test`;
    mockInvitationId = `inv_idem_${suffix}`;
    await as(hrA).post('/users', { name: 'Idem', email, role: 'WORKER', departmentId: deptCareA.id });

    const clerkUserId = `user_idem_${suffix}`;
    mockClerkUser = { firstName: 'Idem', lastName: 'Hire', primaryEmailAddressId: 'e1', emailAddresses: [{ id: 'e1', emailAddress: email }] };
    await postEvent(membershipEvent(agencyA.clerkOrgId, clerkUserId));
    const first = await prisma.pendingEmployee.findUnique({ where: { agencyId_email: { agencyId: agencyA.id, email } } });

    // change the department in the DB; a retry must NOT re-apply anything.
    await prisma.user.update({ where: { clerkUserId }, data: { departmentId: deptOpsA.id } });
    await postEvent(membershipEvent(agencyA.clerkOrgId, clerkUserId));

    const user = await prisma.user.findUnique({ where: { clerkUserId } });
    expect(user.departmentId).toBe(deptOpsA.id); // NOT reverted to Care
    const second = await prisma.pendingEmployee.findUnique({ where: { agencyId_email: { agencyId: agencyA.id, email } } });
    expect(second.consumedAt.toISOString()).toBe(first.consumedAt.toISOString());
  });

  test('another agency cannot consume agency A pending data (same email joining agency B)', async () => {
    const email = `newhire-crosswebhook-${suffix}@shiftgo.test`;
    mockInvitationId = `inv_cross_${suffix}`;
    await as(hrA).post('/users', { name: 'Cross', email, role: 'WORKER', departmentId: deptCareA.id, employeeNumber: 'X-9' });

    const clerkUserId = `user_cross_${suffix}`;
    mockClerkUser = { firstName: 'Cross', lastName: 'Hire', primaryEmailAddressId: 'e1', emailAddresses: [{ id: 'e1', emailAddress: email }] };
    // The person accepts a membership in agency B instead.
    const res = await postEvent(membershipEvent(agencyB.clerkOrgId, clerkUserId));
    expect(res.status).toBe(200);

    const user = await prisma.user.findUnique({ where: { clerkUserId } });
    expect(user.agencyId).toBe(agencyB.id);
    expect(user.departmentId).toBeNull();       // agency A's pending data NOT applied
    expect(user.employeeNumber).toBeNull();
    const pendingA = await prisma.pendingEmployee.findUnique({ where: { agencyId_email: { agencyId: agencyA.id, email } } });
    expect(pendingA.consumedAt).toBeNull();     // still waiting for an agency-A membership
  });

  test('membership.created with NO pending row behaves exactly as before', async () => {
    const clerkUserId = `user_nopending_${suffix}`;
    const email = `emp-nopending-${suffix}@shiftgo.test`;
    mockClerkUser = { firstName: 'No', lastName: 'Pending', primaryEmailAddressId: 'e1', emailAddresses: [{ id: 'e1', emailAddress: email }] };
    const res = await postEvent(membershipEvent(agencyA.clerkOrgId, clerkUserId, 'org:manager'));
    expect(res.status).toBe(200);
    const user = await prisma.user.findUnique({ where: { clerkUserId } });
    expect(user).toMatchObject({ agencyId: agencyA.id, role: 'MANAGER', name: 'No Pending', email });
    expect(user.departmentId).toBeNull();
    expect(user.workPatternType).toBe('ROTA'); // DB default
    await prisma.user.delete({ where: { clerkUserId } });
  });
});

// ══════════ hardening: invitation ↔ staging write ordering ══════════
describe('onboarding hardening — the recoverable write (staging) runs first', () => {
  afterEach(() => {
    jest.restoreAllMocks(); // undo any prisma sp(y)ies; jest.fn() stubs are untouched
  });

  test('staging DB write fails → NO Clerk invitation is sent, nothing is staged, no user', async () => {
    const email = `newhire-stagefail-${suffix}@shiftgo.test`;
    clerkStub.organizations.createOrganizationInvitation.mockClear();
    jest.spyOn(appPrisma.pendingEmployee, 'upsert').mockRejectedValueOnce(new Error('simulated DB failure'));

    const res = await as(hrA).post('/users', {
      name: 'Stage Fail', email, role: 'WORKER',
      departmentId: deptCareA.id, employeeNumber: 'SF-1', contractedHours: 20,
    });

    expect(res.status).toBe(500);
    expect(clerkStub.organizations.createOrganizationInvitation).not.toHaveBeenCalled();
    expect(await appPrisma.pendingEmployee.count({ where: { agencyId: agencyA.id, email } })).toBe(0);
    expect(await appPrisma.user.findUnique({ where: { email } })).toBeNull();
  });

  test('Clerk invitation fails right after staging → the freshly-staged row is rolled back', async () => {
    const email = `newhire-invfail-${suffix}@shiftgo.test`;
    const dupErr = new Error('duplicate'); dupErr.errors = [{ code: 'duplicate_record' }];
    clerkStub.organizations.createOrganizationInvitation.mockRejectedValueOnce(dupErr);

    const res = await as(hrA).post('/users', {
      name: 'Inv Fail', email, role: 'WORKER', departmentId: deptCareA.id, employeeNumber: 'IF-1',
    });

    expect(res.status).toBe(409);
    expect(await appPrisma.pendingEmployee.count({ where: { agencyId: agencyA.id, email } })).toBe(0);
    expect(await appPrisma.user.findUnique({ where: { email } })).toBeNull();
  });

  test('Clerk invitation fails on a re-invite → a pre-existing staging row is preserved (data not lost)', async () => {
    const email = `newhire-reinvite-${suffix}@shiftgo.test`;
    mockInvitationId = `inv_reinvite_${suffix}`;
    const first = await as(hrA).post('/users', {
      name: 'Re Invite', email, role: 'WORKER', departmentId: deptCareA.id, employeeNumber: 'RI-1',
    });
    expect(first.status).toBe(201);
    const before = await appPrisma.pendingEmployee.findUnique({ where: { agencyId_email: { agencyId: agencyA.id, email } } });
    expect(before).not.toBeNull();

    const dupErr = new Error('duplicate'); dupErr.errors = [{ code: 'duplicate_record' }];
    clerkStub.organizations.createOrganizationInvitation.mockRejectedValueOnce(dupErr);
    const second = await as(hrA).post('/users', { name: 'Re Invite', email, role: 'MANAGER', departmentId: deptOpsA.id });
    expect(second.status).toBe(409);

    const after = await appPrisma.pendingEmployee.findUnique({ where: { agencyId_email: { agencyId: agencyA.id, email } } });
    expect(after).not.toBeNull();       // NOT rolled back — HR's staged data survives
    expect(after.id).toBe(before.id);
  });
});

// ═════ hardening: webhook can't fully apply staged data → NEEDS_REVIEW ═════
describe('onboarding hardening — incomplete employment setup is recorded, not hidden', () => {
  test('employee number taken between invite and webhook → user + safe fields applied, number skipped, row flagged', async () => {
    const email = `newhire-empnorace-${suffix}@shiftgo.test`;
    mockInvitationId = `inv_race_${suffix}`;
    await as(hrA).post('/users', {
      name: 'Race Hire', email, role: 'WORKER',
      departmentId: deptCareA.id, jobTitleId: jtSupportA.id, primaryLocationId: locHouseA.id,
      employeeNumber: 'RACE-1', contractedHours: 30, employmentType: 'PERMANENT',
    });

    const blocker = await prisma.user.create({ data: {
      agencyId: agencyA.id, role: 'WORKER', name: 'Blocker',
      email: `newhire-blocker-${suffix}@shiftgo.test`, passwordHash: 'x', employeeNumber: 'RACE-1',
    } });

    const clerkUserId = `user_race_${suffix}`;
    mockClerkUser = { firstName: 'Race', lastName: 'Hire', primaryEmailAddressId: 'e1', emailAddresses: [{ id: 'e1', emailAddress: email }] };
    const res = await postEvent(membershipEvent(agencyA.clerkOrgId, clerkUserId));
    expect(res.status).toBe(200);

    const user = await prisma.user.findUnique({ where: { clerkUserId } });
    expect(user).not.toBeNull();                    // membership still created
    expect(user.departmentId).toBe(deptCareA.id);   // valid staged data applied
    expect(user.jobTitleId).toBe(jtSupportA.id);
    expect(user.primaryLocationId).toBe(locHouseA.id);
    expect(user.contractedHours).toBe(30);
    expect(user.employeeNumber).toBeNull();          // conflicting number NOT applied

    const pending = await prisma.pendingEmployee.findUnique({ where: { agencyId_email: { agencyId: agencyA.id, email } } });
    expect(pending.consumedAt).not.toBeNull();
    expect(pending.needsReview).toBe(true);
    expect(pending.reviewNote).toMatch(/employee number/i);

    // duplicate webhook: idempotent, no repeated mutation of user or row
    const consumedAtBefore = pending.consumedAt.toISOString();
    await postEvent(membershipEvent(agencyA.clerkOrgId, clerkUserId));
    const after = await prisma.pendingEmployee.findUnique({ where: { agencyId_email: { agencyId: agencyA.id, email } } });
    expect(after.consumedAt.toISOString()).toBe(consumedAtBefore);
    expect(after.needsReview).toBe(true);
    expect((await prisma.user.findUnique({ where: { clerkUserId } })).employeeNumber).toBeNull();

    await prisma.user.delete({ where: { id: blocker.id } });
    await prisma.user.delete({ where: { clerkUserId } });
  });

  test('a department deactivated between invite and webhook → applied without it, row flagged', async () => {
    const email = `newhire-staledept-${suffix}@shiftgo.test`;
    mockInvitationId = `inv_stale_${suffix}`;
    const tmpDept = await prisma.department.create({ data: { agencyId: agencyA.id, name: `Temp ${suffix}` } });
    const jtTmp = await prisma.jobTitle.create({ data: { agencyId: agencyA.id, name: `Temp Title ${suffix}`, departmentId: tmpDept.id } });
    await as(hrA).post('/users', {
      name: 'Stale Dept', email, role: 'WORKER',
      departmentId: tmpDept.id, jobTitleId: jtTmp.id, employeeNumber: 'STALE-1',
    });
    await prisma.department.update({ where: { id: tmpDept.id }, data: { active: false } });

    const clerkUserId = `user_stale_${suffix}`;
    mockClerkUser = { firstName: 'Stale', lastName: 'Dept', primaryEmailAddressId: 'e1', emailAddresses: [{ id: 'e1', emailAddress: email }] };
    await postEvent(membershipEvent(agencyA.clerkOrgId, clerkUserId));

    const user = await prisma.user.findUnique({ where: { clerkUserId } });
    expect(user.departmentId).toBeNull();          // deactivated dept not applied
    expect(user.jobTitleId).toBe(jtTmp.id);        // still-active field applied
    expect(user.employeeNumber).toBe('STALE-1');

    const pending = await prisma.pendingEmployee.findUnique({ where: { agencyId_email: { agencyId: agencyA.id, email } } });
    expect(pending.needsReview).toBe(true);
    expect(pending.reviewNote).toMatch(/department/i);
    expect(pending.consumedAt).not.toBeNull();

    await prisma.user.delete({ where: { clerkUserId } });
    await prisma.jobTitle.delete({ where: { id: jtTmp.id } });
    await prisma.department.delete({ where: { id: tmpDept.id } });
  });

  test('the fully-successful path leaves the staging row consumed and NOT flagged', async () => {
    const email = `newhire-clean-${suffix}@shiftgo.test`;
    mockInvitationId = `inv_clean_${suffix}`;
    await as(hrA).post('/users', {
      name: 'Clean Hire', email, role: 'WORKER',
      departmentId: deptCareA.id, jobTitleId: jtSupportA.id, primaryLocationId: locHouseA.id,
      lineManagerId: mgrA.id, employeeNumber: 'CLEAN-1', contractedHours: 40, employmentType: 'PERMANENT',
    });
    const clerkUserId = `user_clean_${suffix}`;
    mockClerkUser = { firstName: 'Clean', lastName: 'Hire', primaryEmailAddressId: 'e1', emailAddresses: [{ id: 'e1', emailAddress: email }] };
    await postEvent(membershipEvent(agencyA.clerkOrgId, clerkUserId));

    const user = await prisma.user.findUnique({ where: { clerkUserId } });
    expect(user).toMatchObject({
      departmentId: deptCareA.id, jobTitleId: jtSupportA.id, primaryLocationId: locHouseA.id,
      lineManagerId: mgrA.id, employeeNumber: 'CLEAN-1', contractedHours: 40, employmentType: 'PERMANENT',
    });
    const pending = await prisma.pendingEmployee.findUnique({ where: { agencyId_email: { agencyId: agencyA.id, email } } });
    expect(pending.consumedAt).not.toBeNull();
    expect(pending.needsReview).toBe(false);
    expect(pending.reviewNote).toBeNull();

    await prisma.user.delete({ where: { clerkUserId } });
  });
});

// ═══════ hardening: HR can see and clear incomplete onboarding ═══════
describe('onboarding hardening — onboarding-review endpoints', () => {
  async function makeFlaggedRow(tag) {
    const email = `newhire-flag-${tag}-${suffix}@shiftgo.test`;
    mockInvitationId = `inv_flag_${tag}_${suffix}`;
    const tmpDept = await prisma.department.create({ data: { agencyId: agencyA.id, name: `Flag ${tag} ${suffix}` } });
    await as(hrA).post('/users', { name: `Flag ${tag}`, email, role: 'WORKER', departmentId: tmpDept.id });
    await prisma.department.update({ where: { id: tmpDept.id }, data: { active: false } });
    const clerkUserId = `user_flag_${tag}_${suffix}`;
    mockClerkUser = { firstName: 'Flag', lastName: tag, primaryEmailAddressId: 'e1', emailAddresses: [{ id: 'e1', emailAddress: email }] };
    await postEvent(membershipEvent(agencyA.clerkOrgId, clerkUserId));
    return { email, clerkUserId, tmpDept };
  }

  test('GET /users/onboarding-review lists flagged rows for HR, hides other agencies, 403s a worker', async () => {
    const { email, clerkUserId, tmpDept } = await makeFlaggedRow('list');

    const hr = await as(hrA).get('/users/onboarding-review');
    expect(hr.status).toBe(200);
    const row = hr.body.data.find((r) => r.email === email);
    expect(row).toBeTruthy();
    expect(row.reviewNote).toMatch(/department/i);

    const other = await as(hrB).get('/users/onboarding-review');
    expect(other.body.data.find((r) => r.email === email)).toBeUndefined();

    expect((await as(wkrA).get('/users/onboarding-review')).status).toBe(403);

    await prisma.user.delete({ where: { clerkUserId } });
    await prisma.department.delete({ where: { id: tmpDept.id } });
  });

  test('POST /users/onboarding-review/:id/resolve clears the flag — HR only, tenant-scoped', async () => {
    const { email, clerkUserId, tmpDept } = await makeFlaggedRow('resolve');
    const pending = await prisma.pendingEmployee.findUnique({ where: { agencyId_email: { agencyId: agencyA.id, email } } });

    expect((await as(mgrA).post(`/users/onboarding-review/${pending.id}/resolve`)).status).toBe(403);
    expect((await as(hrB).post(`/users/onboarding-review/${pending.id}/resolve`)).status).toBe(404);

    const done = await as(hrA).post(`/users/onboarding-review/${pending.id}/resolve`);
    expect(done.status).toBe(200);
    expect(done.body.data.needsReview).toBe(false);

    expect((await as(hrA).get('/users/onboarding-review')).body.data.find((r) => r.email === email)).toBeUndefined();

    await prisma.user.delete({ where: { clerkUserId } });
    await prisma.department.delete({ where: { id: tmpDept.id } });
  });
});
