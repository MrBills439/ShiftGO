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
    agency = await prisma.agency.create({ data: { name: `Onboarding Agency ${suffix}` } });
    otherAgency = await prisma.agency.create({ data: { name: `Other Agency ${suffix}` } });

    manager = await prisma.user.create({
      data: {
        agencyId: agency.id,
        name: 'Onboarding Manager',
        email: `onboarding-manager-${suffix}@shiftgo.test`,
        passwordHash: 'test-password-hash',
        role: 'MANAGER',
      },
    });

    worker = await prisma.user.create({
      data: {
        agencyId: agency.id,
        name: 'Onboarding Worker',
        email: `onboarding-worker-${suffix}@shiftgo.test`,
        passwordHash: 'test-password-hash',
        role: 'WORKER',
      },
    });
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
        temporaryPassword: 'Temporary123!',
      });

    expect(res.status).toBe(201);
    expect(res.body.data).toEqual(expect.objectContaining({
      agencyId: agency.id,
      name: 'Created Staff Worker',
      email: `created-worker-${suffix}@shiftgo.test`,
      role: 'WORKER',
      phone: '+441234567890',
    }));
    expect(res.body.data.passwordHash).toBeUndefined();
    createdWorkerId = res.body.data.id;
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

  it('blocks public register in production', async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    const res = await request(app)
      .post('/auth/register')
      .send({
        name: 'Public Production Register',
        email: `public-register-${suffix}@shiftgo.test`,
        role: 'WORKER',
        password: 'Temporary123!',
      });

    process.env.NODE_ENV = originalNodeEnv;

    expect(res.status).toBe(403);
    expect(res.body.message).toBe('Public registration is disabled in production; use protected staff onboarding');
  });

  it('records an audit log when staff is created', async () => {
    const auditLog = await prisma.auditLog.findFirst({
      where: {
        agencyId: agency.id,
        actorId: manager.id,
        action: 'USER_CREATED',
        entityType: 'User',
        entityId: createdWorkerId,
      },
    });

    expect(auditLog).toEqual(expect.objectContaining({
      agencyId: agency.id,
      actorId: manager.id,
      actorRole: 'MANAGER',
      action: 'USER_CREATED',
      entityType: 'User',
      entityId: createdWorkerId,
    }));
    expect(auditLog.newValue).toEqual(expect.objectContaining({
      agencyId: agency.id,
      role: 'WORKER',
    }));
    expect(createdCrossAttemptId).toBeUndefined();
  });
});
