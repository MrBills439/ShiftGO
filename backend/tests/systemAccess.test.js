process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-access-secret';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test-refresh-secret';
process.env.RATE_LIMIT_DISABLED = 'true';

const request = require('supertest');
const { PrismaClient } = require('@prisma/client');

let mockClerkUser = null;
jest.mock('../src/utils/clerkClient', () => ({
  organizations: {
    updateOrganizationMembership: jest.fn(async () => ({ id: 'mem_x', role: 'org:worker' })),
    getOrganization: jest.fn(async () => ({ name: 'Org' })),
  },
  users: { getUser: jest.fn(async () => mockClerkUser) },
}));
jest.mock('@clerk/express/webhooks', () => ({ verifyWebhook: jest.fn() }));
const { verifyWebhook } = require('@clerk/express/webhooks');
const clerkStub = require('../src/utils/clerkClient');

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
let hrA, hrA2, mgrA, tlA, wkrA, noClerkA, deadA, hrB, wkrB, hrSolo;

const mkUser = (agencyId, role, tag, extra = {}) =>
  prisma.user.create({ data: {
    agencyId, role, name: `SA ${tag}`, email: `sa-${tag}-${suffix}@shiftgo.test`, passwordHash: 'x',
    clerkUserId: `clerk_${tag}_${suffix}`, ...extra,
  } });

beforeAll(async () => {
  agA = await prisma.agency.create({ data: { name: `SA A ${suffix}`, clerkOrgId: `org_sa_a_${suffix}`, employeeIdPrefix: 'SAA' } });
  agB = await prisma.agency.create({ data: { name: `SA B ${suffix}`, clerkOrgId: `org_sa_b_${suffix}`, employeeIdPrefix: 'SAB' } });
  agSolo = await prisma.agency.create({ data: { name: `SA Solo ${suffix}`, clerkOrgId: `org_sa_solo_${suffix}`, employeeIdPrefix: 'SAS' } });

  hrA = await mkUser(agA.id, 'HR', 'hrA');
  hrA2 = await mkUser(agA.id, 'HR', 'hrA2');
  mgrA = await mkUser(agA.id, 'MANAGER', 'mgrA');
  tlA = await mkUser(agA.id, 'TEAM_LEADER', 'tlA');
  wkrA = await mkUser(agA.id, 'WORKER', 'wkrA');
  noClerkA = await mkUser(agA.id, 'WORKER', 'noClerkA', { clerkUserId: null });
  deadA = await mkUser(agA.id, 'WORKER', 'deadA', { status: 'DEACTIVATED', deactivatedAt: new Date(), deactivationReason: 'left' });

  hrB = await mkUser(agB.id, 'HR', 'hrB');
  wkrB = await mkUser(agB.id, 'WORKER', 'wkrB');

  hrSolo = await mkUser(agSolo.id, 'HR', 'hrSolo');
});

beforeEach(() => {
  clerkStub.organizations.updateOrganizationMembership.mockReset().mockResolvedValue({ id: 'mem_x', role: 'org:worker' });
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
describe('HR changes system access — Clerk first, then local', () => {
  test('WORKER → TEAM_LEADER: Clerk membership gets org:team_leader, then local role changes, audit written', async () => {
    const res = await sysAccess(hrA, wkrA.id, 'TEAM_LEADER');
    expect(res.status).toBe(200);
    expect(res.body.data.role).toBe('TEAM_LEADER');

    expect(clerkStub.organizations.updateOrganizationMembership).toHaveBeenCalledWith({
      organizationId: agA.clerkOrgId,
      userId: wkrA.clerkUserId,
      role: 'org:team_leader',
    });
    expect((await prisma.user.findUnique({ where: { id: wkrA.id } })).role).toBe('TEAM_LEADER');

    const audit = await prisma.auditLog.findFirst({ where: { action: 'USER_SYSTEM_ACCESS_CHANGED', entityId: wkrA.id } });
    expect(audit).toMatchObject({
      actorId: hrA.id, agencyId: agA.id, entityType: 'User',
      oldValue: { role: 'WORKER' }, newValue: { role: 'TEAM_LEADER' },
    });
  });

  test('TEAM_LEADER → MANAGER maps to org:manager', async () => {
    const res = await sysAccess(hrA, tlA.id, 'MANAGER');
    expect(res.status).toBe(200);
    expect(clerkStub.organizations.updateOrganizationMembership.mock.calls[0][0].role).toBe('org:manager');
    expect((await prisma.user.findUnique({ where: { id: tlA.id } })).role).toBe('MANAGER');
  });

  test('MANAGER → HR maps to org:hr', async () => {
    const res = await sysAccess(hrA, mgrA.id, 'HR');
    expect(res.status).toBe(200);
    expect(clerkStub.organizations.updateOrganizationMembership.mock.calls[0][0].role).toBe('org:hr');
    expect((await prisma.user.findUnique({ where: { id: mgrA.id } })).role).toBe('HR');
  });
});

// ───────────────────────── failure / consistency ─────────────────────────
describe('failure handling keeps local role unchanged', () => {
  test('Clerk failure → 502, local role unchanged, NO success audit', async () => {
    clerkStub.organizations.updateOrganizationMembership.mockRejectedValueOnce(new Error('clerk unavailable'));
    const res = await sysAccess(hrA, wkrA.id, 'MANAGER');
    expect(res.status).toBe(502);
    expect(res.body.code).toBe('CLERK_UPDATE_FAILED');
    expect((await prisma.user.findUnique({ where: { id: wkrA.id } })).role).toBe('WORKER');
    expect(await prisma.auditLog.count({ where: { action: 'USER_SYSTEM_ACCESS_CHANGED', entityId: wkrA.id } })).toBe(0);
  });

  test('target has no Clerk membership in the org → 409 NO_CLERK_MEMBERSHIP, local role unchanged', async () => {
    const notFound = new Error('not a member');
    notFound.errors = [{ code: 'resource_not_found' }];
    clerkStub.organizations.updateOrganizationMembership.mockRejectedValueOnce(notFound);
    const res = await sysAccess(hrA, wkrA.id, 'MANAGER');
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('NO_CLERK_MEMBERSHIP');
    expect((await prisma.user.findUnique({ where: { id: wkrA.id } })).role).toBe('WORKER');
  });

  test('target has no Clerk identity → 409 NO_CLERK_IDENTITY, Clerk not called', async () => {
    const res = await sysAccess(hrA, noClerkA.id, 'TEAM_LEADER');
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('NO_CLERK_IDENTITY');
    expect(clerkStub.organizations.updateOrganizationMembership).not.toHaveBeenCalled();
  });
});

// ───────────────────────── guards & validation ─────────────────────────
describe('guards, validation and safety rules', () => {
  test('a MANAGER cannot change system access (403)', async () => {
    expect((await sysAccess(mgrA, wkrA.id, 'TEAM_LEADER')).status).toBe(403);
    expect(clerkStub.organizations.updateOrganizationMembership).not.toHaveBeenCalled();
  });

  test('a WORKER cannot change system access (403)', async () => {
    expect((await sysAccess(wkrA, tlA.id, 'MANAGER')).status).toBe(403);
  });

  test('an invalid role is rejected (400)', async () => {
    const res = await sysAccess(hrA, wkrA.id, 'SUPERADMIN');
    expect(res.status).toBe(400);
    expect(clerkStub.organizations.updateOrganizationMembership).not.toHaveBeenCalled();
  });

  test('changing to the same role is rejected (400 SAME_ROLE), Clerk not called', async () => {
    const res = await sysAccess(hrA, wkrA.id, 'WORKER');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('SAME_ROLE');
    expect(clerkStub.organizations.updateOrganizationMembership).not.toHaveBeenCalled();
  });

  test('HR cannot change their own system access (403 SELF_ROLE_CHANGE)', async () => {
    // hrA2 is still active HR, so this is blocked by the SELF rule, not LAST_HR.
    const res = await sysAccess(hrA, hrA.id, 'MANAGER');
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('SELF_ROLE_CHANGE');
    expect(clerkStub.organizations.updateOrganizationMembership).not.toHaveBeenCalled();
  });

  test('the last active HR of an agency cannot be downgraded (400 LAST_HR_REQUIRED)', async () => {
    const res = await sysAccess(hrSolo, hrSolo.id, 'MANAGER');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('LAST_HR_REQUIRED');
    expect((await prisma.user.findUnique({ where: { id: hrSolo.id } })).role).toBe('HR');
    expect(clerkStub.organizations.updateOrganizationMembership).not.toHaveBeenCalled();
  });

  test('an HR CAN be downgraded while another active HR remains', async () => {
    const res = await sysAccess(hrA, hrA2.id, 'MANAGER');
    expect(res.status).toBe(200);
    expect((await prisma.user.findUnique({ where: { id: hrA2.id } })).role).toBe('MANAGER');
    expect(clerkStub.organizations.updateOrganizationMembership.mock.calls[0][0].role).toBe('org:manager');
  });

  test('a DEACTIVATED employee cannot have their system access changed (400 USER_DEACTIVATED)', async () => {
    const res = await sysAccess(hrA, deadA.id, 'TEAM_LEADER');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('USER_DEACTIVATED');
    expect(clerkStub.organizations.updateOrganizationMembership).not.toHaveBeenCalled();
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
    expect(clerkStub.organizations.updateOrganizationMembership).not.toHaveBeenCalled();
  });
});

// ───────────────────────── webhook idempotency ─────────────────────────
describe('membership webhook after the endpoint stays idempotent', () => {
  test('endpoint sets MANAGER, then a matching organizationMembership.updated webhook leaves it MANAGER', async () => {
    expect((await sysAccess(hrA, wkrA.id, 'MANAGER')).status).toBe(200);
    expect((await prisma.user.findUnique({ where: { id: wkrA.id } })).role).toBe('MANAGER');

    mockClerkUser = {
      firstName: 'SA', lastName: 'wkrA',
      primaryEmailAddressId: 'e1',
      emailAddresses: [{ id: 'e1', emailAddress: wkrA.email }],
    };
    verifyWebhook.mockResolvedValueOnce({
      type: 'organizationMembership.updated',
      data: { role: 'org:manager', organization: { id: agA.clerkOrgId }, public_user_data: { user_id: wkrA.clerkUserId } },
    });
    const wh = await request(app).post('/webhooks/clerk').set('Content-Type', 'application/json').send('{}');
    expect(wh.status).toBe(200);

    const after = await prisma.user.findUnique({ where: { id: wkrA.id } });
    expect(after.role).toBe('MANAGER'); // unchanged, no duplicate side effect
  });
});
