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
let otherWorker;
let house;
let shift;
let otherShift;

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

describe('My Timesheets (self-service)', () => {
  beforeAll(async () => {
    agency = await prisma.agency.create({ data: { name: `My Timesheets Agency ${suffix}` } });

    manager = await prisma.user.create({
      data: {
        agencyId: agency.id,
        name: 'My Timesheets Manager',
        email: `my-timesheets-manager-${suffix}@shiftgo.test`,
        passwordHash: 'test-password-hash',
        role: 'MANAGER',
      },
    });

    worker = await prisma.user.create({
      data: {
        agencyId: agency.id,
        name: 'My Timesheets Worker',
        email: `my-timesheets-worker-${suffix}@shiftgo.test`,
        passwordHash: 'test-password-hash',
        role: 'WORKER',
      },
    });

    otherWorker = await prisma.user.create({
      data: {
        agencyId: agency.id,
        name: 'Other Worker',
        email: `my-timesheets-other-${suffix}@shiftgo.test`,
        passwordHash: 'test-password-hash',
        role: 'WORKER',
      },
    });

    house = await prisma.house.create({
      data: {
        agencyId: agency.id,
        name: `My Timesheets House ${suffix}`,
        address: '1 Timesheet Way',
        latitude: 51.5,
        longitude: -0.12,
        managerId: manager.id,
      },
    });

    shift = await prisma.shift.create({
      data: {
        agencyId: agency.id,
        houseId: house.id,
        workerId: worker.id,
        createdById: manager.id,
        date: new Date(),
        startTime: new Date(Date.now() - 8 * 3_600_000),
        endTime: new Date(Date.now() - 4 * 3_600_000),
        status: 'COMPLETED',
      },
    });

    otherShift = await prisma.shift.create({
      data: {
        agencyId: agency.id,
        houseId: house.id,
        workerId: otherWorker.id,
        createdById: manager.id,
        date: new Date(),
        startTime: new Date(Date.now() - 8 * 3_600_000),
        endTime: new Date(Date.now() - 4 * 3_600_000),
        status: 'COMPLETED',
      },
    });

    await prisma.timesheet.create({
      data: {
        agencyId: agency.id,
        workerId: worker.id,
        houseId: house.id,
        shiftId: shift.id,
        clockInAt: new Date(Date.now() - 8 * 3_600_000),
        clockOutAt: new Date(Date.now() - 4 * 3_600_000),
        totalHours: 4,
        status: 'APPROVED',
      },
    });

    await prisma.timesheet.create({
      data: {
        agencyId: agency.id,
        workerId: otherWorker.id,
        houseId: house.id,
        shiftId: otherShift.id,
        clockInAt: new Date(Date.now() - 8 * 3_600_000),
        clockOutAt: new Date(Date.now() - 4 * 3_600_000),
        totalHours: 4,
        status: 'PENDING',
      },
    });
  });

  afterAll(async () => {
    await prisma.timesheet.deleteMany({ where: { workerId: { in: [worker.id, otherWorker.id] } } });
    await prisma.shift.deleteMany({ where: { houseId: house.id } });
    await prisma.house.delete({ where: { id: house.id } });
    await prisma.user.deleteMany({ where: { id: { in: [manager.id, worker.id, otherWorker.id] } } });
    await prisma.agency.delete({ where: { id: agency.id } });
    await prisma.$disconnect();
  });

  it('returns only the requesting worker\'s own timesheets', async () => {
    const res = await request(app)
      .get('/timesheets/me')
      .set('Authorization', `Bearer ${tokenFor(worker)}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toEqual(expect.objectContaining({
      workerId: worker.id,
      totalHours: 4,
      status: 'APPROVED',
    }));
  });

  it('does not return another worker\'s timesheets', async () => {
    const res = await request(app)
      .get('/timesheets/me')
      .set('Authorization', `Bearer ${tokenFor(otherWorker)}`);

    expect(res.status).toBe(200);
    expect(res.body.data.every((t) => t.workerId === otherWorker.id)).toBe(true);
  });
});
