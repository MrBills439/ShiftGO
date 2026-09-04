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

function tokenFor(user) {
  return signAccess({
    id: user.id,
    role: user.role,
    name: user.name,
    email: user.email,
  });
}

async function createActiveShift() {
  const now = Date.now();
  return prisma.shift.create({
    data: {
      agencyId: agency.id,
      houseId: house.id,
      workerId: worker.id,
      createdById: manager.id,
      date: new Date(now),
      startTime: new Date(now - 3_600_000),
      endTime: new Date(now + 3_600_000),
      status: 'SCHEDULED',
    },
  });
}

describe('Clock-out duplicate prevention', () => {
  beforeAll(async () => {
    agency = await prisma.agency.create({ data: { name: `Clock Test Agency ${suffix}` } });

    manager = await prisma.user.create({
      data: {
        agencyId: agency.id,
        name: 'Clock Test Manager',
        email: `clock-manager-${suffix}@shiftgo.test`,
        passwordHash: 'test-password-hash',
        role: 'MANAGER',
      },
    });

    worker = await prisma.user.create({
      data: {
        agencyId: agency.id,
        name: 'Clock Test Worker',
        email: `clock-worker-${suffix}@shiftgo.test`,
        passwordHash: 'test-password-hash',
        role: 'WORKER',
      },
    });

    house = await prisma.house.create({
      data: {
        agencyId: agency.id,
        name: `Clock Test House ${suffix}`,
        address: '10 Clock Street',
        latitude: 51.5,
        longitude: -0.12,
        managerId: manager.id,
      },
    });
  });

  afterAll(async () => {
    if (agency) await prisma.auditLog.deleteMany({ where: { agencyId: agency.id } });
    await prisma.attendanceMonitor.deleteMany({ where: { workerId: worker?.id } });
    await prisma.timesheet.deleteMany({ where: { workerId: worker?.id } });
    await prisma.clockEvent.deleteMany({ where: { workerId: worker?.id } });
    await prisma.shift.deleteMany({ where: { houseId: house?.id } });
    if (house) await prisma.house.delete({ where: { id: house.id } });
    await prisma.user.deleteMany({ where: { id: { in: [manager?.id, worker?.id].filter(Boolean) } } });
    if (agency) await prisma.agency.delete({ where: { id: agency.id } });
    await prisma.$disconnect();
  });

  it('returns 409 when the worker is not currently clocked in', async () => {
    const shift = await createActiveShift();

    const res = await request(app)
      .post('/clock/out')
      .set('Authorization', `Bearer ${tokenFor(worker)}`)
      .send({ houseId: house.id, shiftId: shift.id });

    expect(res.status).toBe(409);
    expect(res.body).toEqual(expect.objectContaining({
      success: false,
      message: 'No active clock-in found for this shift',
    }));
  });

  it('allows first clock-out and rejects a duplicate without creating another OUT event or overwriting the timesheet', async () => {
    const shift = await createActiveShift();
    const auth = `Bearer ${tokenFor(worker)}`;
    const clockInTimestamp = new Date(Date.now() - 120_000).toISOString();
    const clockOutTimestamp = new Date(Date.now() - 60_000).toISOString();

    const clockIn = await request(app)
      .post('/clock/in')
      .set('Authorization', auth)
      .send({
        houseId: house.id,
        shiftId: shift.id,
        timestamp: clockInTimestamp,
        latitude: house.latitude,
        longitude: house.longitude,
        accuracy: 12,
      });
    expect(clockIn.status).toBe(200);

    const firstClockOut = await request(app)
      .post('/clock/out')
      .set('Authorization', auth)
      .send({ houseId: house.id, shiftId: shift.id, timestamp: clockOutTimestamp });
    expect(firstClockOut.status).toBe(200);

    const firstTimesheet = await prisma.timesheet.findUnique({ where: { shiftId: shift.id } });
    const firstClockOutAt = firstTimesheet.clockOutAt;
    expect(firstClockOutAt).toBeTruthy();
    expect(firstClockOutAt.toISOString()).toBe(clockOutTimestamp);

    await new Promise((resolve) => setTimeout(resolve, 25));

    const secondClockOut = await request(app)
      .post('/clock/out')
      .set('Authorization', auth)
      .send({ houseId: house.id, shiftId: shift.id });
    expect(secondClockOut.status).toBe(409);
    expect(secondClockOut.body).toEqual(expect.objectContaining({
      success: false,
      message: 'Already clocked out for this shift',
    }));

    const outEvents = await prisma.clockEvent.findMany({
      where: { workerId: worker.id, shiftId: shift.id, type: 'OUT' },
      orderBy: { timestamp: 'asc' },
    });
    expect(outEvents).toHaveLength(1);

    const storedTimesheet = await prisma.timesheet.findUnique({ where: { shiftId: shift.id } });
    expect(storedTimesheet.clockOutAt.toISOString()).toBe(firstClockOutAt.toISOString());
  });
});
