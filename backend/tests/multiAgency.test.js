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
let managerA;
let managerB;
let workerA;
let workerB;
let houseA;
let houseB;
let shiftB;
let timesheetB;

function tokenFor(user) {
  return signAccess({
    id: user.id,
    agencyId: user.agencyId,
    role: user.role,
    name: user.name,
    email: user.email,
  });
}

describe('Multi-agency data isolation', () => {
  beforeAll(async () => {
    agencyA = await prisma.agency.create({ data: { name: `Agency A ${suffix}` } });
    agencyB = await prisma.agency.create({ data: { name: `Agency B ${suffix}` } });

    managerA = await prisma.user.create({
      data: {
        agencyId: agencyA.id,
        name: 'Agency A Manager',
        email: `agency-a-manager-${suffix}@shiftgo.test`,
        passwordHash: 'test-password-hash',
        role: 'MANAGER',
      },
    });
    managerB = await prisma.user.create({
      data: {
        agencyId: agencyB.id,
        name: 'Agency B Manager',
        email: `agency-b-manager-${suffix}@shiftgo.test`,
        passwordHash: 'test-password-hash',
        role: 'MANAGER',
      },
    });
    workerA = await prisma.user.create({
      data: {
        agencyId: agencyA.id,
        name: 'Agency A Worker',
        email: `agency-a-worker-${suffix}@shiftgo.test`,
        passwordHash: 'test-password-hash',
        role: 'WORKER',
      },
    });
    workerB = await prisma.user.create({
      data: {
        agencyId: agencyB.id,
        name: 'Agency B Worker',
        email: `agency-b-worker-${suffix}@shiftgo.test`,
        passwordHash: 'test-password-hash',
        role: 'WORKER',
      },
    });

    houseA = await prisma.house.create({
      data: {
        agencyId: agencyA.id,
        name: `Agency A House ${suffix}`,
        address: '1 Agency A Street',
        latitude: 51.5,
        longitude: -0.12,
        managerId: managerA.id,
      },
    });
    houseB = await prisma.house.create({
      data: {
        agencyId: agencyB.id,
        name: `Agency B House ${suffix}`,
        address: '1 Agency B Street',
        latitude: 51.6,
        longitude: -0.13,
        managerId: managerB.id,
      },
    });

    const now = Date.now();
    shiftB = await prisma.shift.create({
      data: {
        agencyId: agencyB.id,
        houseId: houseB.id,
        workerId: workerB.id,
        createdById: managerB.id,
        date: new Date(now),
        startTime: new Date(now - 3_600_000),
        endTime: new Date(now + 3_600_000),
        status: 'SCHEDULED',
      },
    });
    timesheetB = await prisma.timesheet.create({
      data: {
        agencyId: agencyB.id,
        workerId: workerB.id,
        houseId: houseB.id,
        shiftId: shiftB.id,
        clockInAt: new Date(now - 3_600_000),
        status: 'PENDING',
      },
    });

    await prisma.auditLog.createMany({
      data: [
        {
          agencyId: agencyA.id,
          actorId: managerA.id,
          actorRole: 'MANAGER',
          action: 'AGENCY_A_TEST',
          entityType: 'Shift',
          entityId: 'agency-a-entity',
        },
        {
          agencyId: agencyB.id,
          actorId: managerB.id,
          actorRole: 'MANAGER',
          action: 'AGENCY_B_TEST',
          entityType: 'Shift',
          entityId: 'agency-b-entity',
        },
      ],
    });
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { agencyId: { in: [agencyA?.id, agencyB?.id].filter(Boolean) } } });
    await prisma.timesheet.deleteMany({ where: { agencyId: { in: [agencyA?.id, agencyB?.id].filter(Boolean) } } });
    await prisma.clockEvent.deleteMany({ where: { agencyId: { in: [agencyA?.id, agencyB?.id].filter(Boolean) } } });
    await prisma.shift.deleteMany({ where: { agencyId: { in: [agencyA?.id, agencyB?.id].filter(Boolean) } } });
    await prisma.house.deleteMany({ where: { agencyId: { in: [agencyA?.id, agencyB?.id].filter(Boolean) } } });
    await prisma.user.deleteMany({ where: { agencyId: { in: [agencyA?.id, agencyB?.id].filter(Boolean) } } });
    await prisma.agency.deleteMany({ where: { id: { in: [agencyA?.id, agencyB?.id].filter(Boolean) } } });
    await prisma.$disconnect();
  });

  it('prevents an Agency A manager from seeing Agency B workers', async () => {
    const res = await request(app)
      .get('/users')
      .set('Authorization', `Bearer ${tokenFor(managerA)}`);

    expect(res.status).toBe(200);
    expect(res.body.data.map((user) => user.id)).toContain(workerA.id);
    expect(res.body.data.map((user) => user.id)).not.toContain(workerB.id);
  });

  it('prevents an Agency A manager from creating a shift with Agency B worker and house', async () => {
    const now = Date.now();
    const res = await request(app)
      .post('/shifts')
      .set('Authorization', `Bearer ${tokenFor(managerA)}`)
      .send({
        workerId: workerB.id,
        houseId: houseB.id,
        date: new Date(now + 86_400_000).toISOString(),
        startTime: new Date(now + 86_400_000).toISOString(),
        endTime: new Date(now + 90_000_000).toISOString(),
      });

    expect(res.status).toBe(403);
    expect(res.body.message).toBe('Worker and house must belong to your agency');
  });

  it('prevents an Agency A worker from clocking into an Agency B shift', async () => {
    const res = await request(app)
      .post('/clock/in')
      .set('Authorization', `Bearer ${tokenFor(workerA)}`)
      .send({
        houseId: houseB.id,
        shiftId: shiftB.id,
        reason: 'Cross-agency attempt',
      });

    expect(res.status).toBe(403);
  });

  it('scopes house timesheet lists to the actor agency', async () => {
    const res = await request(app)
      .get(`/timesheets/house/${houseB.id}`)
      .set('Authorization', `Bearer ${tokenFor(managerA)}`);

    expect(res.status).toBe(200);
    expect(res.body.data.map((timesheet) => timesheet.id)).not.toContain(timesheetB.id);
  });

  it('scopes audit log lists to the actor agency', async () => {
    const res = await request(app)
      .get('/audit-logs?entityType=Shift')
      .set('Authorization', `Bearer ${tokenFor(managerA)}`);

    expect(res.status).toBe(200);
    expect(res.body.data.map((log) => log.action)).toContain('AGENCY_A_TEST');
    expect(res.body.data.map((log) => log.action)).not.toContain('AGENCY_B_TEST');
  });
});
