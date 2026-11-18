process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-access-secret';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test-refresh-secret';
process.env.RATE_LIMIT_DISABLED = 'true';

const request = require('supertest');
const { PrismaClient } = require('@prisma/client');
const app = require('../src/app');
const { signAccess } = require('../src/utils/jwt');
const { hash } = require('../src/utils/password');

const prisma = new PrismaClient();
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const testPassword = 'Temporary123!';

let agency;
let otherAgency;
let manager;
let hr;
let workerActor;
let targetWorker;
let deactivatedTeamLeader;
let otherAgencyWorker;
let house;
let activeShift;

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

describe('Staff offboarding and deactivation', () => {
  beforeAll(async () => {
    agency = await prisma.agency.create({ data: { name: `Offboarding Agency ${suffix}` } });
    otherAgency = await prisma.agency.create({ data: { name: `Other Offboarding Agency ${suffix}` } });

    manager = await prisma.user.create({
      data: {
        agencyId: agency.id,
        name: 'Offboarding Manager',
        email: `offboarding-manager-${suffix}@shiftgo.test`,
        passwordHash: await hash(testPassword),
        role: 'MANAGER',
      },
    });

    hr = await prisma.user.create({
      data: {
        agencyId: agency.id,
        name: 'Offboarding HR',
        email: `offboarding-hr-${suffix}@shiftgo.test`,
        passwordHash: await hash(testPassword),
        role: 'HR',
      },
    });

    workerActor = await prisma.user.create({
      data: {
        agencyId: agency.id,
        name: 'Offboarding Worker Actor',
        email: `offboarding-worker-actor-${suffix}@shiftgo.test`,
        passwordHash: await hash(testPassword),
        role: 'WORKER',
      },
    });

    targetWorker = await prisma.user.create({
      data: {
        agencyId: agency.id,
        name: 'Offboarding Target Worker',
        email: `offboarding-target-worker-${suffix}@shiftgo.test`,
        passwordHash: await hash(testPassword),
        role: 'WORKER',
        fcmToken: 'test-device-token',
      },
    });

    deactivatedTeamLeader = await prisma.user.create({
      data: {
        agencyId: agency.id,
        name: 'Offboarding Deactivated Team Leader',
        email: `offboarding-deactivated-tl-${suffix}@shiftgo.test`,
        passwordHash: await hash(testPassword),
        role: 'TEAM_LEADER',
        status: 'DEACTIVATED',
        deactivatedAt: new Date(),
        deactivatedById: manager.id,
        deactivationReason: 'Already offboarded before assignment',
      },
    });

    otherAgencyWorker = await prisma.user.create({
      data: {
        agencyId: otherAgency.id,
        name: 'Other Agency Worker',
        email: `offboarding-other-worker-${suffix}@shiftgo.test`,
        passwordHash: await hash(testPassword),
        role: 'WORKER',
      },
    });

    house = await prisma.house.create({
      data: {
        agencyId: agency.id,
        name: `Offboarding House ${suffix}`,
        address: '12 Offboarding Street',
        latitude: 51.5,
        longitude: -0.12,
        managerId: manager.id,
      },
    });

    const now = Date.now();
    activeShift = await prisma.shift.create({
      data: {
        agencyId: agency.id,
        houseId: house.id,
        workerId: targetWorker.id,
        createdById: manager.id,
        date: new Date(now + 86_400_000),
        startTime: new Date(now + 86_400_000),
        endTime: new Date(now + 90_000_000),
        status: 'SCHEDULED',
      },
    });
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { agencyId: { in: [agency?.id, otherAgency?.id].filter(Boolean) } } });
    await prisma.timesheet.deleteMany({ where: { agencyId: { in: [agency?.id, otherAgency?.id].filter(Boolean) } } });
    await prisma.clockEvent.deleteMany({ where: { agencyId: { in: [agency?.id, otherAgency?.id].filter(Boolean) } } });
    await prisma.shift.deleteMany({ where: { agencyId: { in: [agency?.id, otherAgency?.id].filter(Boolean) } } });
    await prisma.house.deleteMany({ where: { agencyId: { in: [agency?.id, otherAgency?.id].filter(Boolean) } } });
    await prisma.user.deleteMany({ where: { agencyId: { in: [agency?.id, otherAgency?.id].filter(Boolean) } } });
    await prisma.agency.deleteMany({ where: { id: { in: [agency?.id, otherAgency?.id].filter(Boolean) } } });
    await prisma.$disconnect();
  });

  it('prevents workers from deactivating anyone', async () => {
    const res = await request(app)
      .post(`/users/${targetWorker.id}/deactivate`)
      .set('Authorization', `Bearer ${tokenFor(workerActor)}`)
      .send({ reason: 'Worker should not be able to offboard staff' });

    expect(res.status).toBe(403);
  });

  it('prevents a manager from deactivating another agency user', async () => {
    const res = await request(app)
      .post(`/users/${otherAgencyWorker.id}/deactivate`)
      .set('Authorization', `Bearer ${tokenFor(manager)}`)
      .send({ reason: 'Cross-agency offboarding attempt' });

    expect(res.status).toBe(404);
  });

  it('allows a manager to deactivate a worker in the same agency', async () => {
    const res = await request(app)
      .post(`/users/${targetWorker.id}/deactivate`)
      .set('Authorization', `Bearer ${tokenFor(manager)}`)
      .send({ reason: 'Worker left the agency' });

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(expect.objectContaining({
      id: targetWorker.id,
      agencyId: agency.id,
      status: 'DEACTIVATED',
      deactivatedById: manager.id,
      deactivationReason: 'Worker left the agency',
    }));
    expect(res.body.data.deactivatedAt).toBeTruthy();
  });

  it('rejects existing access tokens for deactivated users before clock in/out', async () => {
    const staleToken = tokenFor(targetWorker);

    const res = await request(app)
      .post('/clock/in')
      .set('Authorization', `Bearer ${staleToken}`)
      .send({
        houseId: house.id,
        shiftId: activeShift.id,
        reason: 'Attempt after deactivation',
      });

    expect(res.status).toBe(401);
    expect(res.body.message).toBe('User account is deactivated');
  });

  it('prevents a deactivated worker from being assigned to a new shift', async () => {
    const now = Date.now();
    const res = await request(app)
      .post('/shifts')
      .set('Authorization', `Bearer ${tokenFor(manager)}`)
      .send({
        workerId: targetWorker.id,
        houseId: house.id,
        date: new Date(now + 172_800_000).toISOString(),
        startTime: new Date(now + 172_800_000).toISOString(),
        endTime: new Date(now + 176_400_000).toISOString(),
      });

    expect(res.status).toBe(403);
    expect(res.body.message).toBe('Worker is deactivated and cannot be assigned new shifts');
  });

  it('prevents a deactivated worker from being assigned to a house', async () => {
    const res = await request(app)
      .post('/users/assign/worker')
      .set('Authorization', `Bearer ${tokenFor(hr)}`)
      .send({
        workerId: targetWorker.id,
        houseId: house.id,
      });

    expect(res.status).toBe(403);
    expect(res.body.message).toBe('Worker is deactivated and cannot be assigned to a house');

    const assignment = await prisma.houseWorker.findUnique({
      where: { houseId_workerId: { houseId: house.id, workerId: targetWorker.id } },
    });
    expect(assignment).toBeNull();
  });

  it('prevents a deactivated team leader from being assigned to a house', async () => {
    const res = await request(app)
      .post('/users/assign/team-leader')
      .set('Authorization', `Bearer ${tokenFor(hr)}`)
      .send({
        teamLeaderId: deactivatedTeamLeader.id,
        houseId: house.id,
      });

    expect(res.status).toBe(403);
    expect(res.body.message).toBe('Team leader is deactivated and cannot be assigned to a house');

    const assignment = await prisma.houseTeamLeader.findUnique({
      where: { houseId_teamLeaderId: { houseId: house.id, teamLeaderId: deactivatedTeamLeader.id } },
    });
    expect(assignment).toBeNull();
  });

  it('creates a USER_DEACTIVATED audit log', async () => {
    const auditLog = await prisma.auditLog.findFirst({
      where: {
        agencyId: agency.id,
        actorId: manager.id,
        action: 'USER_DEACTIVATED',
        entityType: 'User',
        entityId: targetWorker.id,
      },
    });

    expect(auditLog).toEqual(expect.objectContaining({
      agencyId: agency.id,
      actorId: manager.id,
      actorRole: 'MANAGER',
      action: 'USER_DEACTIVATED',
      entityType: 'User',
      entityId: targetWorker.id,
    }));
    expect(auditLog.oldValue.status).toBe('ACTIVE');
    expect(auditLog.newValue.status).toBe('DEACTIVATED');
  });
});
