process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-access-secret';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test-refresh-secret';
process.env.RATE_LIMIT_DISABLED = 'true';

const request = require('supertest');
const { PrismaClient } = require('@prisma/client');

const app = require('../src/app');
const { signAccess } = require('../src/utils/jwt');
const appPrisma = require('../src/lib/prisma');
const invitationsRouter = require('../src/routes/invitations');
const { outbox } = require('../src/lib/email');

// Accepting an invitation hashes the password with Better Auth; that's covered
// by tests-auth/. Here a stand-in hasher keeps this suite on plain Jest.
invitationsRouter.hashPassword = async (p) => `test-hash:${p}`;

const prisma = new PrismaClient();
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const tokenFor = (u) => signAccess({ id: u.id, agencyId: u.agencyId, role: u.role, status: u.status, name: u.name, email: u.email });
const as = (u) => ({
  get: (p) => request(app).get(p).set('Authorization', `Bearer ${tokenFor(u)}`),
  post: (p, b) => request(app).post(p).set('Authorization', `Bearer ${tokenFor(u)}`).send(b || {}),
  patch: (p, b) => request(app).patch(p).set('Authorization', `Bearer ${tokenFor(u)}`).send(b || {}),
});
/** The one-time token from the most recent invitation email sent to `email`. */
const inviteToken = (email) => {
  const mail = [...outbox].reverse().find((m) => m.to === email);
  if (!mail) throw new Error(`no invitation email for ${email}`);
  return decodeURIComponent(/accept-invite\?token=([^\s"&]+)/.exec(mail.text)[1]);
};
/** The person opens their invitation link and chooses a password. */
const accept = (email, body = {}) => request(app).post('/invitations/accept')
  .send({ token: inviteToken(email), password: 'a long enough password', ...body });

let agencyA, agencyB, hrA, mgrA, wkrA, hrB;
let deptCareA, deptOpsA, jtSupportA, locHouseA, locOfficeA, deptCareB;

const mkUser = (agencyId, role, tag, extra = {}) =>
  prisma.user.create({ data: { agencyId, role, name: `Emp ${tag}`, email: `emp-${tag}-${suffix}@shiftgo.test`, passwordHash: 'x', ...extra } });

beforeAll(async () => {
  agencyA = await prisma.agency.create({ data: { name: `Emp A ${suffix}`, employeeIdPrefix: 'EMA' } });
  agencyB = await prisma.agency.create({ data: { name: `Emp B ${suffix}`, employeeIdPrefix: 'EMB' } });
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

beforeEach(() => { outbox.length = 0; });

afterEach(async () => {
  await prisma.account.deleteMany({ where: { user: { email: { contains: 'newhire' } } } });
  await prisma.auditLog.deleteMany({ where: { agencyId: { in: [agencyA.id, agencyB.id] } } });
  await prisma.pendingEmployee.deleteMany({ where: { agencyId: { in: [agencyA.id, agencyB.id] } } });
  await prisma.user.deleteMany({ where: { agencyId: { in: [agencyA.id, agencyB.id] }, email: { contains: 'newhire' } } });
  await prisma.user.updateMany({
    where: { id: { in: [wkrA.id, mgrA.id] } },
    data: {
      departmentId: null, jobTitleId: null, primaryLocationId: null, lineManagerId: null,
      employeeNumber: null, employmentType: null, workPatternType: 'ROTA', contractedHours: null,
      phone: null, address: null, employmentStartDate: null,
      emergencyContactName: null, emergencyContactPhone: null, emergencyContactRelationship: null,
    },
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

// ─────────────────────── HR create employee → staging ─────────────────────
describe('HR create employee — employment data is staged', () => {
  test('creates a PendingEmployee with all employment fields for this agency', async () => {
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
    expect(pending.inviteTokenHash).toMatch(/^[a-f0-9]{64}$/); // only a hash of the emailed token is stored
  });

  test('a cross-agency department / job title / location is rejected before any invite is sent', async () => {

    const bad = await as(hrA).post('/users', {
      name: 'Bad Dept', email: `newhire-baddept-${suffix}@shiftgo.test`, role: 'WORKER', departmentId: deptCareB.id,
    });
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe('INVALID_DEPARTMENT');
    expect(outbox).toHaveLength(0); // no invitation email
    expect(await prisma.pendingEmployee.count({ where: { agencyId: agencyA.id } })).toBe(0);
  });

  test('create with no employment fields still works and auto-generates an Employee ID', async () => {
    const email = `newhire-plain-${suffix}@shiftgo.test`;
    const res = await as(hrA).post('/users', { name: 'Plain', email, role: 'WORKER' });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ role: 'WORKER', status: 'pending' });
    // agencyA prefix is 'EMA'; the number is whatever the sequence is at.
    expect(res.body.data.employeeNumber).toMatch(/^EMA-\d{4,}$/);
    const pending = await prisma.pendingEmployee.findUnique({ where: { agencyId_email: { agencyId: agencyA.id, email } } });
    expect(pending.employeeNumber).toBe(res.body.data.employeeNumber);
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
    const email = `newhire-match-${suffix}@shiftgo.test`;
    const res = await as(hrA).post('/users', {
      name: 'Matched Hire', email, role: 'WORKER', departmentId: deptCareA.id, jobTitleId: jtSupportA.id,
    });
    expect(res.status).toBe(201);
    const pending = await prisma.pendingEmployee.findUnique({ where: { agencyId_email: { agencyId: agencyA.id, email } } });
    expect(pending).toMatchObject({ departmentId: deptCareA.id, jobTitleId: jtSupportA.id });
  });

  test('POST /users with a mismatched Department + Job Title is rejected before any invite', async () => {
    const res = await as(hrA).post('/users', {
      name: 'Bad Pair', email: `newhire-badpair-${suffix}@shiftgo.test`, role: 'WORKER',
      departmentId: deptOpsA.id, jobTitleId: jtSupportA.id, // jtSupportA = Care
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('JOB_TITLE_DEPARTMENT_MISMATCH');
    expect(outbox).toHaveLength(0); // no invitation email
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

// ─────────────────────────── invitation acceptance ─────────────────────────
describe('onboarding — accepting the invitation applies staged employment data', () => {
  test('accepting creates the account with all staged employment data and consumes the invitation', async () => {
    const email = `newhire-webhook-${suffix}@shiftgo.test`;
    await as(hrA).post('/users', {
      name: 'Webhook Hire', email, role: 'WORKER',
      departmentId: deptCareA.id, jobTitleId: jtSupportA.id, primaryLocationId: locHouseA.id,
      employeeNumber: 'WH-1', contractedHours: 36, employmentType: 'PERMANENT',
    });
    expect(await prisma.user.findUnique({ where: { email } })).toBeNull(); // nothing until they accept

    const res = await accept(email);
    expect(res.status).toBe(201);

    const user = await prisma.user.findUnique({ where: { email } });
    expect(user).toMatchObject({
      agencyId: agencyA.id, role: 'WORKER', status: 'ACTIVE', emailVerified: true, name: 'Webhook Hire',
      departmentId: deptCareA.id, jobTitleId: jtSupportA.id, primaryLocationId: locHouseA.id,
      employeeNumber: 'WH-1', contractedHours: 36, employmentType: 'PERMANENT', workPatternType: 'ROTA',
    });
    const account = await prisma.account.findFirst({ where: { userId: user.id } });
    expect(account).toMatchObject({ providerId: 'credential', accountId: user.id, password: 'test-hash:a long enough password' });
    const pending = await prisma.pendingEmployee.findUnique({ where: { agencyId_email: { agencyId: agencyA.id, email } } });
    expect(pending.consumedAt).not.toBeNull();
    expect(pending.inviteTokenHash).toBeNull(); // the link can never be used again
  });

  test('an invitation link works once', async () => {
    const email = `newhire-webhook-idem-${suffix}@shiftgo.test`;
    await as(hrA).post('/users', { name: 'Idem', email, role: 'WORKER', departmentId: deptCareA.id });
    const token = inviteToken(email);
    expect((await accept(email)).status).toBe(201);

    const again = await request(app).post('/invitations/accept').send({ token, password: 'another long password' });
    expect(again.status).toBe(410);
    expect(again.body.code).toBe('INVITE_INVALID');
    expect(await prisma.account.count({ where: { user: { email } } })).toBe(1);
  });

  test('the preview shows who and which agency; it is not a way in', async () => {
    const email = `newhire-preview-${suffix}@shiftgo.test`;
    await as(hrA).post('/users', { name: 'Preview Person', email, role: 'TEAM_LEADER' });
    const res = await request(app).get(`/invitations/${encodeURIComponent(inviteToken(email))}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ email, name: 'Preview Person', agencyName: agencyA.name, role: 'TEAM_LEADER' });
    expect(await prisma.user.findUnique({ where: { email } })).toBeNull();
  });

  test('an unknown, tampered or expired token creates nothing', async () => {
    expect((await request(app).post('/invitations/accept').send({ token: 'x'.repeat(43), password: 'a long enough password' })).status).toBe(410);

    const email = `newhire-expired-${suffix}@shiftgo.test`;
    await as(hrA).post('/users', { name: 'Expired', email, role: 'WORKER' });
    await prisma.pendingEmployee.update({ where: { agencyId_email: { agencyId: agencyA.id, email } }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await accept(email)).status).toBe(410);
    expect(await prisma.user.findUnique({ where: { email } })).toBeNull();
  });

  test('a short password is refused and the invitation stays usable', async () => {
    const email = `newhire-weakpw-${suffix}@shiftgo.test`;
    await as(hrA).post('/users', { name: 'Weak', email, role: 'WORKER' });
    const weak = await accept(email, { password: 'short' });
    expect(weak.status).toBe(400);
    expect(weak.body.code).toBe('WEAK_PASSWORD');
    expect((await accept(email)).status).toBe(201);
  });

  test('re-inviting sends a fresh link and the old link stops working', async () => {
    const email = `newhire-reissue-${suffix}@shiftgo.test`;
    await as(hrA).post('/users', { name: 'Reissue', email, role: 'WORKER' });
    const oldToken = inviteToken(email);
    await as(hrA).post('/users', { name: 'Reissue', email, role: 'WORKER' });
    expect(inviteToken(email)).not.toBe(oldToken);
    expect((await request(app).post('/invitations/accept').send({ token: oldToken, password: 'a long enough password' })).status).toBe(410);
    expect((await accept(email)).status).toBe(201);
  });
});

// ══════════ hardening: invitation ↔ staging write ordering ══════════
describe('onboarding hardening — the recoverable write (staging) runs first', () => {
  afterEach(() => {
    jest.restoreAllMocks(); // undo any prisma sp(y)ies; jest.fn() stubs are untouched
  });

  test('staging DB write fails → NO invitation email is sent, nothing is staged, no user', async () => {
    const email = `newhire-stagefail-${suffix}@shiftgo.test`;
    jest.spyOn(appPrisma.pendingEmployee, 'upsert').mockRejectedValueOnce(new Error('simulated DB failure'));

    const res = await as(hrA).post('/users', {
      name: 'Stage Fail', email, role: 'WORKER',
      departmentId: deptCareA.id, employeeNumber: 'SF-1', contractedHours: 20,
    });

    expect(res.status).toBe(500);
    expect(outbox).toHaveLength(0); // no invitation email
    expect(await appPrisma.pendingEmployee.count({ where: { agencyId: agencyA.id, email } })).toBe(0);
    expect(await appPrisma.user.findUnique({ where: { email } })).toBeNull();
  });

  test('the invitation email fails right after staging → the freshly-staged row is rolled back', async () => {
    const email = `newhire-invfail-${suffix}@shiftgo.test`;
    jest.spyOn(require('../src/lib/email'), 'sendEmail').mockRejectedValueOnce(new Error('provider down'));

    const res = await as(hrA).post('/users', {
      name: 'Inv Fail', email, role: 'WORKER', departmentId: deptCareA.id, employeeNumber: 'IF-1',
    });

    expect(res.status).toBe(502);
    expect(res.body.code).toBe('INVITE_EMAIL_FAILED');
    expect(await appPrisma.pendingEmployee.count({ where: { agencyId: agencyA.id, email } })).toBe(0);
    expect(await appPrisma.user.findUnique({ where: { email } })).toBeNull();
  });

  test('the email fails on a re-invite → a pre-existing staging row is preserved (data not lost)', async () => {
    const email = `newhire-reinvite-${suffix}@shiftgo.test`;
    const first = await as(hrA).post('/users', {
      name: 'Re Invite', email, role: 'WORKER', departmentId: deptCareA.id, employeeNumber: 'RI-1',
    });
    expect(first.status).toBe(201);
    const before = await appPrisma.pendingEmployee.findUnique({ where: { agencyId_email: { agencyId: agencyA.id, email } } });
    expect(before).not.toBeNull();

    jest.spyOn(require('../src/lib/email'), 'sendEmail').mockRejectedValueOnce(new Error('provider down'));
    const second = await as(hrA).post('/users', { name: 'Re Invite', email, role: 'MANAGER', departmentId: deptOpsA.id });
    expect(second.status).toBe(502);

    const after = await appPrisma.pendingEmployee.findUnique({ where: { agencyId_email: { agencyId: agencyA.id, email } } });
    expect(after).not.toBeNull();       // NOT rolled back — HR's staged data survives
    expect(after.id).toBe(before.id);
  });
});

// ═════ hardening: acceptance can't fully apply staged data → NEEDS_REVIEW ═════
describe('onboarding hardening — incomplete employment setup is recorded, not hidden', () => {
  test('employee number taken between invite and acceptance → user + safe fields applied, number skipped, row flagged', async () => {
    const email = `newhire-empnorace-${suffix}@shiftgo.test`;
    await as(hrA).post('/users', {
      name: 'Race Hire', email, role: 'WORKER',
      departmentId: deptCareA.id, jobTitleId: jtSupportA.id, primaryLocationId: locHouseA.id,
      employeeNumber: 'RACE-1', contractedHours: 30, employmentType: 'PERMANENT',
    });

    const blocker = await prisma.user.create({ data: {
      agencyId: agencyA.id, role: 'WORKER', name: 'Blocker',
      email: `newhire-blocker-${suffix}@shiftgo.test`, passwordHash: 'x', employeeNumber: 'RACE-1',
    } });
    const res = await accept(email);
    expect(res.status).toBe(201);

    const user = await prisma.user.findUnique({ where: { email } });
    expect(user).not.toBeNull();                    // account still created
    expect(user.departmentId).toBe(deptCareA.id);   // valid staged data applied
    expect(user.jobTitleId).toBe(jtSupportA.id);
    expect(user.primaryLocationId).toBe(locHouseA.id);
    expect(user.contractedHours).toBe(30);
    expect(user.employeeNumber).toBeNull();          // conflicting number NOT applied

    const pending = await prisma.pendingEmployee.findUnique({ where: { agencyId_email: { agencyId: agencyA.id, email } } });
    expect(pending.consumedAt).not.toBeNull();
    expect(pending.needsReview).toBe(true);
    expect(pending.reviewNote).toMatch(/employee number/i);

    // the link cannot be replayed to re-run onboarding
    const consumedAtBefore = pending.consumedAt.toISOString();
    expect((await request(app).post('/invitations/accept').send({ token: 'replayed-token-value-0000000000000', password: 'a long enough password' })).status).toBe(410);
    const after = await prisma.pendingEmployee.findUnique({ where: { agencyId_email: { agencyId: agencyA.id, email } } });
    expect(after.consumedAt.toISOString()).toBe(consumedAtBefore);
    expect(after.needsReview).toBe(true);
    expect((await prisma.user.findUnique({ where: { email } })).employeeNumber).toBeNull();

    await prisma.user.delete({ where: { id: blocker.id } });
    await prisma.user.delete({ where: { email } }); // account rows cascade
  });

  test('a department deactivated between invite and acceptance → applied without it, row flagged', async () => {
    const email = `newhire-staledept-${suffix}@shiftgo.test`;
    const tmpDept = await prisma.department.create({ data: { agencyId: agencyA.id, name: `Temp ${suffix}` } });
    const jtTmp = await prisma.jobTitle.create({ data: { agencyId: agencyA.id, name: `Temp Title ${suffix}`, departmentId: tmpDept.id } });
    await as(hrA).post('/users', {
      name: 'Stale Dept', email, role: 'WORKER',
      departmentId: tmpDept.id, jobTitleId: jtTmp.id, employeeNumber: 'STALE-1',
    });
    await prisma.department.update({ where: { id: tmpDept.id }, data: { active: false } });
    await accept(email);

    const user = await prisma.user.findUnique({ where: { email } });
    expect(user.departmentId).toBeNull();          // deactivated dept not applied
    expect(user.jobTitleId).toBe(jtTmp.id);        // still-active field applied
    expect(user.employeeNumber).toBe('STALE-1');

    const pending = await prisma.pendingEmployee.findUnique({ where: { agencyId_email: { agencyId: agencyA.id, email } } });
    expect(pending.needsReview).toBe(true);
    expect(pending.reviewNote).toMatch(/department/i);
    expect(pending.consumedAt).not.toBeNull();

    await prisma.user.delete({ where: { email } }); // account rows cascade
    await prisma.jobTitle.delete({ where: { id: jtTmp.id } });
    await prisma.department.delete({ where: { id: tmpDept.id } });
  });

  test('the fully-successful path leaves the staging row consumed and NOT flagged', async () => {
    const email = `newhire-clean-${suffix}@shiftgo.test`;
    await as(hrA).post('/users', {
      name: 'Clean Hire', email, role: 'WORKER',
      departmentId: deptCareA.id, jobTitleId: jtSupportA.id, primaryLocationId: locHouseA.id,
      lineManagerId: mgrA.id, employeeNumber: 'CLEAN-1', contractedHours: 40, employmentType: 'PERMANENT',
    });
    await accept(email);

    const user = await prisma.user.findUnique({ where: { email } });
    expect(user).toMatchObject({
      departmentId: deptCareA.id, jobTitleId: jtSupportA.id, primaryLocationId: locHouseA.id,
      lineManagerId: mgrA.id, employeeNumber: 'CLEAN-1', contractedHours: 40, employmentType: 'PERMANENT',
    });
    const pending = await prisma.pendingEmployee.findUnique({ where: { agencyId_email: { agencyId: agencyA.id, email } } });
    expect(pending.consumedAt).not.toBeNull();
    expect(pending.needsReview).toBe(false);
    expect(pending.reviewNote).toBeNull();

    await prisma.user.delete({ where: { email } }); // account rows cascade
  });
});

// ═══════ hardening: HR can see and clear incomplete onboarding ═══════
describe('onboarding hardening — onboarding-review endpoints', () => {
  async function makeFlaggedRow(tag) {
    const email = `newhire-flag-${tag}-${suffix}@shiftgo.test`;
    const tmpDept = await prisma.department.create({ data: { agencyId: agencyA.id, name: `Flag ${tag} ${suffix}` } });
    await as(hrA).post('/users', { name: `Flag ${tag}`, email, role: 'WORKER', departmentId: tmpDept.id });
    await prisma.department.update({ where: { id: tmpDept.id }, data: { active: false } });
    await accept(email);
    return { email, tmpDept };
  }

  test('GET /users/onboarding-review lists flagged rows for HR, hides other agencies, 403s a worker', async () => {
    const { email, tmpDept } = await makeFlaggedRow('list');

    const hr = await as(hrA).get('/users/onboarding-review');
    expect(hr.status).toBe(200);
    const row = hr.body.data.find((r) => r.email === email);
    expect(row).toBeTruthy();
    expect(row.reviewNote).toMatch(/department/i);

    const other = await as(hrB).get('/users/onboarding-review');
    expect(other.body.data.find((r) => r.email === email)).toBeUndefined();

    expect((await as(wkrA).get('/users/onboarding-review')).status).toBe(403);

    await prisma.user.delete({ where: { email } }); // account rows cascade
    await prisma.department.delete({ where: { id: tmpDept.id } });
  });

  test('POST /users/onboarding-review/:id/resolve clears the flag — HR only, tenant-scoped', async () => {
    const { email, tmpDept } = await makeFlaggedRow('resolve');
    const pending = await prisma.pendingEmployee.findUnique({ where: { agencyId_email: { agencyId: agencyA.id, email } } });

    expect((await as(mgrA).post(`/users/onboarding-review/${pending.id}/resolve`)).status).toBe(403);
    expect((await as(hrB).post(`/users/onboarding-review/${pending.id}/resolve`)).status).toBe(404);

    const done = await as(hrA).post(`/users/onboarding-review/${pending.id}/resolve`);
    expect(done.status).toBe(200);
    expect(done.body.data.needsReview).toBe(false);

    expect((await as(hrA).get('/users/onboarding-review')).body.data.find((r) => r.email === email)).toBeUndefined();

    await prisma.user.delete({ where: { email } }); // account rows cascade
    await prisma.department.delete({ where: { id: tmpDept.id } });
  });
});

// ═════════════════ HR Onboarding V1 — personal + emergency contact ═════════════════
describe('HR Onboarding V1', () => {
  const V1 = {
    name: 'Grace Onboarding Ltd',
    phone: '+44 7700 900111',
    address: '12 Oak Street, Canterbury, CT1 2AB',
    employmentStartDate: '2026-10-01',
    emergencyContactName: 'Sam Kin',
    emergencyContactPhone: '+44 7700 900222',
    emergencyContactRelationship: 'Sibling',
  };
  test('a complete V1 onboarding stages every new field on PendingEmployee', async () => {
    const email = `newhire-v1full-${suffix}@shiftgo.test`;
    const res = await as(hrA).post('/users', {
      ...V1, email, role: 'WORKER',
      departmentId: deptCareA.id, jobTitleId: jtSupportA.id, employmentType: 'PERMANENT',
      primaryLocationId: locHouseA.id, lineManagerId: mgrA.id, contractedHours: 37.5, workPatternType: 'FIXED',
    });
    expect(res.status).toBe(201);

    const pending = await prisma.pendingEmployee.findUnique({ where: { agencyId_email: { agencyId: agencyA.id, email } } });
    expect(pending).toMatchObject({
      name: V1.name, phone: V1.phone, address: V1.address,
      emergencyContactName: V1.emergencyContactName,
      emergencyContactPhone: V1.emergencyContactPhone,
      emergencyContactRelationship: V1.emergencyContactRelationship,
      departmentId: deptCareA.id, jobTitleId: jtSupportA.id, primaryLocationId: locHouseA.id,
      lineManagerId: mgrA.id, contractedHours: 37.5, workPatternType: 'FIXED', employmentType: 'PERMANENT',
    });
    expect(new Date(pending.employmentStartDate).toISOString().slice(0, 10)).toBe('2026-10-01');
    expect(pending.employeeNumber).toMatch(/^EMA-\d{4,}$/);
  });

  test('accepting copies every V1 field to the User; phone is not dropped', async () => {
    const email = `newhire-v1apply-${suffix}@shiftgo.test`;
    await as(hrA).post('/users', { ...V1, email, role: 'WORKER', departmentId: deptCareA.id, jobTitleId: jtSupportA.id, employmentType: 'BANK' });
    await accept(email);

    const user = await prisma.user.findUnique({ where: { email } });
    expect(user).toMatchObject({
      phone: V1.phone,
      address: V1.address,
      emergencyContactName: V1.emergencyContactName,
      emergencyContactPhone: V1.emergencyContactPhone,
      emergencyContactRelationship: V1.emergencyContactRelationship,
      employmentType: 'BANK',
      departmentId: deptCareA.id,
    });
    expect(new Date(user.employmentStartDate).toISOString().slice(0, 10)).toBe('2026-10-01');

    // and it is readable through the staff API
    const viaApi = await as(hrA).get(`/users/${user.id}`);
    expect(viaApi.body.data).toMatchObject({
      emergencyContactName: V1.emergencyContactName,
      emergencyContactRelationship: V1.emergencyContactRelationship,
    });
  });

  test('the HR-entered name wins over a name typed when accepting', async () => {
    const email = `newhire-v1name-${suffix}@shiftgo.test`;
    await as(hrA).post('/users', { name: 'Priya Legal Name', email, role: 'WORKER', departmentId: deptCareA.id, jobTitleId: jtSupportA.id, employmentType: 'PERMANENT' });
    expect((await accept(email, { name: 'P' })).status).toBe(201);
    expect((await prisma.user.findUnique({ where: { email } })).name).toBe('Priya Legal Name');
  });

  test('if HR left the name blank, the name typed when accepting is used', async () => {
    const email = `newhire-v1noname-${suffix}@shiftgo.test`;
    await as(hrA).post('/users', { name: 'Placeholder', email, role: 'WORKER' });
    await prisma.pendingEmployee.update({ where: { agencyId_email: { agencyId: agencyA.id, email } }, data: { name: null } });
    expect((await accept(email, { name: 'Self Named' })).status).toBe(201);
    expect((await prisma.user.findUnique({ where: { email } })).name).toBe('Self Named');
  });

  test('a retry updates the V1 staged values and reuses the Employee ID', async () => {
    const email = `newhire-v1retry-${suffix}@shiftgo.test`;
    const first = await as(hrA).post('/users', { ...V1, email, role: 'WORKER', departmentId: deptCareA.id, jobTitleId: jtSupportA.id, employmentType: 'PERMANENT' });
    const firstNumber = first.body.data.employeeNumber;
    expect(firstNumber).toMatch(/^EMA-\d{4,}$/);

    const retry = await as(hrA).post('/users', {
      name: 'Grace Onboarding Ltd', email, role: 'WORKER',
      departmentId: deptCareA.id, jobTitleId: jtSupportA.id, employmentType: 'PERMANENT',
      phone: '+44 7700 999999', address: 'New address 42',
    });
    expect(retry.status).toBe(201);
    expect(retry.body.data.employeeNumber).toBe(firstNumber); // no fresh number burned

    const pending = await prisma.pendingEmployee.findUnique({ where: { agencyId_email: { agencyId: agencyA.id, email } } });
    expect(pending.phone).toBe('+44 7700 999999');   // updated
    expect(pending.address).toBe('New address 42');  // updated
    expect(pending.emergencyContactName).toBe(V1.emergencyContactName); // not re-sent -> preserved
    expect(pending.consumedAt).toBeNull();  // consumedAt reset by the upsert
    expect(pending.needsReview).toBe(false);
  });

  test('invalid new-field lengths and an invalid start date are rejected', async () => {
    const base = { email: `newhire-v1bad-${suffix}@shiftgo.test`, name: 'Len Check', role: 'WORKER', departmentId: deptCareA.id, jobTitleId: jtSupportA.id, employmentType: 'PERMANENT' };
    expect((await as(hrA).post('/users', { ...base, address: 'x'.repeat(501) })).status).toBe(400);
    expect((await as(hrA).post('/users', { ...base, emergencyContactName: 'x'.repeat(121) })).status).toBe(400);
    expect((await as(hrA).post('/users', { ...base, emergencyContactPhone: 'x'.repeat(41) })).status).toBe(400);
    expect((await as(hrA).post('/users', { ...base, emergencyContactRelationship: 'x'.repeat(81) })).status).toBe(400);
    expect((await as(hrA).post('/users', { ...base, employmentStartDate: 'not-a-date' })).status).toBe(400);
    expect(await prisma.pendingEmployee.count({ where: { agencyId: agencyA.id } })).toBe(0);
  });

  test('a legacy invite with no optional V1 fields still works end to end', async () => {
    const email = `newhire-v1legacy-${suffix}@shiftgo.test`;
    const res = await as(hrA).post('/users', { name: 'Bare Minimum', email, role: 'WORKER', departmentId: deptCareA.id, jobTitleId: jtSupportA.id, employmentType: 'PERMANENT' });
    expect(res.status).toBe(201);
    await accept(email);
    const user = await prisma.user.findUnique({ where: { email } });
    expect(user.name).toBe('Bare Minimum');
    expect(user.phone).toBeNull();
    expect(user.address).toBeNull();
    expect(user.employmentStartDate).toBeNull();
    expect(user.emergencyContactName).toBeNull();
    expect(user.emergencyContactPhone).toBeNull();
    expect(user.emergencyContactRelationship).toBeNull();
  });

  test('existing users are unaffected — their new columns stay null', async () => {
    const fresh = await prisma.user.findUnique({ where: { id: wkrA.id } });
    expect(fresh.employmentStartDate).toBeNull();
    expect(fresh.emergencyContactName).toBeNull();
    expect(fresh.emergencyContactPhone).toBeNull();
    expect(fresh.emergencyContactRelationship).toBeNull();
  });
});

// ═════════════════ Employee Detail V1 — GET /users/:id + personal edits ═════════════════
describe('Employee Detail V1', () => {
  test('GET /users/:id returns identity, employment, personal, emergency contact + deactivation metadata (same agency)', async () => {
    await as(hrA).patch(`/users/${wkrA.id}`, {
      departmentId: deptCareA.id, jobTitleId: jtSupportA.id, primaryLocationId: locHouseA.id,
      contractedHours: 32, employmentType: 'PERMANENT', workPatternType: 'FIXED',
      phone: '+44 7700 900500', address: '9 Elm Road',
      employmentStartDate: '2026-11-03',
      emergencyContactName: 'Dana Kin', emergencyContactPhone: '+44 7700 900600', emergencyContactRelationship: 'Parent',
    });

    const res = await as(mgrA).get(`/users/${wkrA.id}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      id: wkrA.id, name: wkrA.name, email: wkrA.email, role: 'WORKER', status: 'ACTIVE',
      phone: '+44 7700 900500', address: '9 Elm Road',
      contractedHours: 32, employmentType: 'PERMANENT', workPatternType: 'FIXED',
      emergencyContactName: 'Dana Kin', emergencyContactPhone: '+44 7700 900600', emergencyContactRelationship: 'Parent',
      department: { id: deptCareA.id, name: 'Care' },
      jobTitle: { id: jtSupportA.id, name: 'Support Worker' },
      primaryLocation: { id: locHouseA.id, name: 'Canterbury House' },
    });
    expect(new Date(res.body.data.employmentStartDate).toISOString().slice(0, 10)).toBe('2026-11-03');
    // deactivation metadata keys are present (null on an active user)
    expect(res.body.data).toHaveProperty('deactivatedAt', null);
    expect(res.body.data).toHaveProperty('deactivatedBy', null);
    // no sign-in internals / secrets
    expect(res.body.data).not.toHaveProperty('passwordHash');
    expect(res.body.data).not.toHaveProperty('accounts');
    expect(res.body.data).not.toHaveProperty('passwordHash');
  });

  test('a cross-agency employee is 404 — indistinguishable from a non-existent id', async () => {
    const crossAgency = await as(hrB).get(`/users/${wkrA.id}`);
    const bogus = await as(hrB).get('/users/does-not-exist-000000');
    expect(crossAgency.status).toBe(404);
    expect(bogus.status).toBe(404);
    expect(crossAgency.body).toEqual(bogus.body); // no existence leak
  });

  test('a WORKER cannot read another employee (roleGuard unchanged)', async () => {
    expect((await as(wkrA).get(`/users/${mgrA.id}`)).status).toBe(403);
  });

  test('HR/Manager can edit phone / address / emergency contact via PATCH /users/:id', async () => {
    const res = await as(mgrA).patch(`/users/${wkrA.id}`, {
      phone: '+44 7700 900777',
      address: '77 Maple Avenue, London',
      emergencyContactName: 'Alex Kin',
      emergencyContactPhone: '+44 7700 900888',
      emergencyContactRelationship: 'Spouse',
    });
    expect(res.status).toBe(200);
    const fresh = await prisma.user.findUnique({ where: { id: wkrA.id } });
    expect(fresh).toMatchObject({
      phone: '+44 7700 900777', address: '77 Maple Avenue, London',
      emergencyContactName: 'Alex Kin', emergencyContactPhone: '+44 7700 900888', emergencyContactRelationship: 'Spouse',
    });
  });

  test('omitted fields are preserved on PATCH; blank string clears a field', async () => {
    await as(hrA).patch(`/users/${wkrA.id}`, { phone: '+44 111', address: '1 High St', emergencyContactName: 'Keep Me' });
    // a later PATCH that only touches address must not wipe phone / emergency contact
    await as(hrA).patch(`/users/${wkrA.id}`, { address: '2 Low St' });
    let fresh = await prisma.user.findUnique({ where: { id: wkrA.id } });
    expect(fresh).toMatchObject({ phone: '+44 111', address: '2 Low St', emergencyContactName: 'Keep Me' });
    // an explicit empty string clears it
    await as(hrA).patch(`/users/${wkrA.id}`, { phone: '' });
    fresh = await prisma.user.findUnique({ where: { id: wkrA.id } });
    expect(fresh.phone).toBeNull();
    expect(fresh.emergencyContactName).toBe('Keep Me'); // still untouched
  });

  test('invalid personal-field lengths are rejected (400)', async () => {
    expect((await as(hrA).patch(`/users/${wkrA.id}`, { address: 'x'.repeat(501) })).status).toBe(400);
    expect((await as(hrA).patch(`/users/${wkrA.id}`, { emergencyContactName: 'x'.repeat(121) })).status).toBe(400);
    expect((await as(hrA).patch(`/users/${wkrA.id}`, { emergencyContactPhone: 'x'.repeat(41) })).status).toBe(400);
    expect((await as(hrA).patch(`/users/${wkrA.id}`, { emergencyContactRelationship: 'x'.repeat(81) })).status).toBe(400);
    expect((await as(hrA).patch(`/users/${wkrA.id}`, { employmentStartDate: 'nope' })).status).toBe(400);
  });

  test('employment edits still work and Department → Job Title validation is still enforced', async () => {
    const ok = await as(hrA).patch(`/users/${wkrA.id}`, { departmentId: deptCareA.id, jobTitleId: jtSupportA.id });
    expect(ok.status).toBe(200);
    // jtSupportA belongs to Care — pairing it with Operations must still 400
    const bad = await as(hrA).patch(`/users/${wkrA.id}`, { departmentId: deptOpsA.id, jobTitleId: jtSupportA.id });
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe('JOB_TITLE_DEPARTMENT_MISMATCH');
  });

  test('a personal-only PATCH never touches the employee number', async () => {
    await prisma.user.update({ where: { id: wkrA.id }, data: { employeeNumber: 'FIXED-77' } });
    await as(hrA).patch(`/users/${wkrA.id}`, { phone: '+44 7700 900999', address: 'somewhere' });
    const fresh = await prisma.user.findUnique({ where: { id: wkrA.id } });
    expect(fresh.employeeNumber).toBe('FIXED-77');
  });

  test('cross-agency PATCH is blocked (404) and writes nothing', async () => {
    const res = await as(hrB).patch(`/users/${wkrA.id}`, { phone: 'HACKED' });
    expect(res.status).toBe(404);
    const fresh = await prisma.user.findUnique({ where: { id: wkrA.id } });
    expect(fresh.phone).not.toBe('HACKED');
  });

  test('existing deactivation behaviour is unchanged and surfaces on the detail response', async () => {
    const victim = await mkUser(agencyA.id, 'WORKER', `det-deact-${Math.random().toString(16).slice(2)}`, {
    });
    const d = await as(hrA).post(`/users/${victim.id}/deactivate`, { reason: 'Left the company' });
    expect(d.status).toBe(200);

    const detail = await as(hrA).get(`/users/${victim.id}`);
    expect(detail.body.data.status).toBe('DEACTIVATED');
    expect(detail.body.data.deactivationReason).toBe('Left the company');
    expect(detail.body.data.deactivatedBy).toMatchObject({ id: hrA.id });
    expect(detail.body.data.deactivatedAt).not.toBeNull();

    await prisma.user.delete({ where: { id: victim.id } });
  });
});
