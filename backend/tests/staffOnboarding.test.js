process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-access-secret';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test-refresh-secret';
process.env.RATE_LIMIT_DISABLED = 'true';

const request = require('supertest');
const { PrismaClient } = require('@prisma/client');
const { signAccess } = require('../src/utils/jwt');

const mockCreateOrganizationInvitation = jest.fn();
jest.mock('../src/utils/clerkClient', () => ({
  organizations: {
    createOrganizationInvitation: (...args) => mockCreateOrganizationInvitation(...args),
  },
}));

const app = require('../src/app');

const prisma = new PrismaClient();
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

let agency;
let otherAgency;
let manager;
let worker;
let createdWorkerId;
let createdCrossAttemptId;

function tokenFor(user) {
  return signAccess({
    id: user.id,
    agencyId: user.agencyId,
    role: user.role,
    name: user.name,
    email: user.email,
  });
}

describe('Protected agency staff onboarding', () => {
  beforeAll(async () => {
    agency = await prisma.agency.create({ data: { name: `Onboarding Agency ${suffix}`, clerkOrgId: `org_test_${suffix}`, employeeIdPrefix: 'ONB' } });
    otherAgency = await prisma.agency.create({ data: { name: `Other Agency ${suffix}` } });

    manager = await prisma.user.create({
      data: {
        agencyId: agency.id,
        clerkUserId: `user_test_manager_${suffix}`,
        name: 'Onboarding Manager',
        email: `onboarding-manager-${suffix}@shiftgo.test`,
        passwordHash: 'test-password-hash',
        role: 'MANAGER',
      },
    });

    worker = await prisma.user.create({
      data: {
        agencyId: agency.id,
        clerkUserId: `user_test_worker_${suffix}`,
        name: 'Onboarding Worker',
        email: `onboarding-worker-${suffix}@shiftgo.test`,
        passwordHash: 'test-password-hash',
        role: 'WORKER',
      },
    });
  });

  beforeEach(() => {
    mockCreateOrganizationInvitation.mockReset();
    mockCreateOrganizationInvitation.mockResolvedValue({ id: `invitation_${suffix}`, status: 'pending' });
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { agencyId: { in: [agency?.id, otherAgency?.id].filter(Boolean) } } });
    await prisma.user.deleteMany({ where: { agencyId: { in: [agency?.id, otherAgency?.id].filter(Boolean) } } });
    await prisma.agency.deleteMany({ where: { id: { in: [agency?.id, otherAgency?.id].filter(Boolean) } } });
    await prisma.$disconnect();
  });

  it('allows a manager to create a worker inside their own agency', async () => {
    const res = await request(app)
      .post('/users')
      .set('Authorization', `Bearer ${tokenFor(manager)}`)
      .send({
        name: 'Created Staff Worker',
        email: `created-worker-${suffix}@shiftgo.test`,
        role: 'WORKER',
        phone: '+441234567890',
      });

    expect(res.status).toBe(201);
    expect(res.body.data).toEqual(expect.objectContaining({
      email: `created-worker-${suffix}@shiftgo.test`,
      role: 'WORKER',
      status: 'pending',
    }));
    // No inviterUserId — the org:hr/org:manager Clerk custom roles have no
    // permissions granted in this instance, so attributing the invite to a
    // specific member 403s. Sending it as the API key itself avoids that.
    expect(mockCreateOrganizationInvitation).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: agency.clerkOrgId,
      emailAddress: `created-worker-${suffix}@shiftgo.test`,
      role: 'org:worker',
    }));
    expect(mockCreateOrganizationInvitation.mock.calls[0][0]).not.toHaveProperty('inviterUserId');
    createdWorkerId = res.body.data.invitationId;
  });

  it('does not let a manager create users in another agency', async () => {
    const res = await request(app)
      .post('/users')
      .set('Authorization', `Bearer ${tokenFor(manager)}`)
      .send({
        agencyId: otherAgency.id,
        name: 'Cross Agency Staff',
        email: `cross-agency-staff-${suffix}@shiftgo.test`,
        role: 'WORKER',
        temporaryPassword: 'Temporary123!',
      });

    expect(res.status).toBe(403);

    const created = await prisma.user.findUnique({
      where: { email: `cross-agency-staff-${suffix}@shiftgo.test` },
    });
    expect(created).toBeNull();
    createdCrossAttemptId = created?.id;
  });

  it('prevents workers from creating users', async () => {
    const res = await request(app)
      .post('/users')
      .set('Authorization', `Bearer ${tokenFor(worker)}`)
      .send({
        name: 'Worker Created Staff',
        email: `worker-created-${suffix}@shiftgo.test`,
        role: 'WORKER',
        temporaryPassword: 'Temporary123!',
      });

    expect(res.status).toBe(403);
  });

  it('rejects invalid staff roles', async () => {
    const res = await request(app)
      .post('/users')
      .set('Authorization', `Bearer ${tokenFor(manager)}`)
      .send({
        name: 'Bad Role Staff',
        email: `bad-role-${suffix}@shiftgo.test`,
        role: 'SUPER_ADMIN',
        temporaryPassword: 'Temporary123!',
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toEqual(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
    expect(res.body.error.fields).toEqual(expect.objectContaining({
      role: 'Role must be WORKER, TEAM_LEADER, MANAGER, or HR',
    }));
  });

  it('records an audit log when staff is invited', async () => {
    const auditLog = await prisma.auditLog.findFirst({
      where: {
        agencyId: agency.id,
        actorId: manager.id,
        action: 'USER_INVITED',
        entityType: 'OrganizationInvitation',
        entityId: createdWorkerId,
      },
    });

    expect(auditLog).toEqual(expect.objectContaining({
      agencyId: agency.id,
      actorId: manager.id,
      actorRole: 'MANAGER',
      action: 'USER_INVITED',
      entityType: 'OrganizationInvitation',
      entityId: createdWorkerId,
    }));
    expect(auditLog.newValue).toEqual(expect.objectContaining({
      role: 'WORKER',
    }));
    expect(createdCrossAttemptId).toBeUndefined();
  });
});
