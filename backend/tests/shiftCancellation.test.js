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
let manager;
let worker;
let house;
let scheduledShift;
let completedShift;

function tokenFor(user) {
  return signAccess({
    id: user.id,
    role: user.role,
    name: user.name,
    email: user.email,
  });
}

describe('Shift cancellation', () => {
  beforeAll(async () => {
    agency = await prisma.agency.create({ data: { name: `Cancellation Agency ${suffix}` } });

    manager = await prisma.user.create({
      data: {
        agencyId: agency.id,
        name: 'Test Manager',
        email: `manager-${suffix}@shiftgo.test`,
        passwordHash: 'test-password-hash',
        role: 'MANAGER',
      },
    });

    worker = await prisma.user.create({
      data: {
        agencyId: agency.id,
        name: 'Test Worker',
        email: `worker-${suffix}@shiftgo.test`,
        passwordHash: 'test-password-hash',
        role: 'WORKER',
      },
    });

    house = await prisma.house.create({
      data: {
        agencyId: agency.id,
        name: `Test House ${suffix}`,
        address: '1 Test Street',
        latitude: 51.5,
        longitude: -0.12,
        managerId: manager.id,
      },
    });

    const now = Date.now();
    scheduledShift = await prisma.shift.create({
      data: {
        agencyId: agency.id,
        houseId: house.id,
        workerId: worker.id,
        createdById: manager.id,
        date: new Date(now + 86_400_000),
        startTime: new Date(now + 86_400_000),
        endTime: new Date(now + 90_000_000),
        status: 'SCHEDULED',
      },
    });

    completedShift = await prisma.shift.create({
      data: {
        agencyId: agency.id,
        houseId: house.id,
        workerId: worker.id,
        createdById: manager.id,
        date: new Date(now - 86_400_000),
        startTime: new Date(now - 90_000_000),
        endTime: new Date(now - 86_400_000),
        status: 'COMPLETED',
      },
    });
  });

  afterAll(async () => {
    await new Promise((resolve) => setTimeout(resolve, 100));
    if (worker) await prisma.notification.deleteMany({ where: { userId: worker.id } });
    if (agency) await prisma.auditLog.deleteMany({ where: { agencyId: agency.id } });
    await prisma.shift.deleteMany({ where: { id: { in: [scheduledShift?.id, completedShift?.id].filter(Boolean) } } });
    if (house) await prisma.house.delete({ where: { id: house.id } });
    await prisma.user.deleteMany({ where: { id: { in: [manager?.id, worker?.id].filter(Boolean) } } });
    if (agency) await prisma.agency.delete({ where: { id: agency.id } });
    await prisma.$disconnect();
  });

  it('returns 401 when cancelling without auth', async () => {
    const res = await request(app)
      .delete(`/shifts/${scheduledShift.id}`)
      .send({ reason: 'No longer needed' });

    expect(res.status).toBe(401);
  });

  it('returns 403 when a worker cancels a shift', async () => {
    const res = await request(app)
      .delete(`/shifts/${scheduledShift.id}`)
      .set('Authorization', `Bearer ${tokenFor(worker)}`)
      .send({ reason: 'No longer needed' });

    expect(res.status).toBe(403);
  });

  it('lets a manager cancel a scheduled shift without deleting it', async () => {
    const res = await request(app)
      .delete(`/shifts/${scheduledShift.id}`)
      .set('Authorization', `Bearer ${tokenFor(manager)}`)
      .send({ reason: 'Agency cover arranged' });

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(expect.objectContaining({
      id: scheduledShift.id,
      status: 'CANCELLED',
      cancelledById: manager.id,
      cancellationReason: 'Agency cover arranged',
    }));
    expect(res.body.data.cancelledAt).toBeTruthy();

    const stored = await prisma.shift.findUnique({ where: { id: scheduledShift.id } });
    expect(stored).toEqual(expect.objectContaining({
      id: scheduledShift.id,
      status: 'CANCELLED',
      cancellationReason: 'Agency cover arranged',
    }));
  });

  it('returns 409 when cancelling the same shift again', async () => {
    const res = await request(app)
      .delete(`/shifts/${scheduledShift.id}`)
      .set('Authorization', `Bearer ${tokenFor(manager)}`)
      .send({ reason: 'Second cancellation attempt' });

    expect(res.status).toBe(409);
    expect(res.body).toEqual(expect.objectContaining({
      success: false,
      message: 'Shift is already cancelled',
    }));
  });

  it('returns 409 when cancelling a completed shift', async () => {
    const res = await request(app)
      .delete(`/shifts/${completedShift.id}`)
      .set('Authorization', `Bearer ${tokenFor(manager)}`)
      .send({ reason: 'Trying to cancel payroll evidence' });

    expect(res.status).toBe(409);
    expect(res.body).toEqual(expect.objectContaining({
      success: false,
      message: 'Completed shifts cannot be cancelled',
    }));
  });
});
