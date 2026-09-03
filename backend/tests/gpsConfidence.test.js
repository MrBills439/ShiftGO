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

describe('GPS confidence attendance rules', () => {
  beforeAll(async () => {
    agency = await prisma.agency.create({ data: { name: `GPS Test Agency ${suffix}` } });

    manager = await prisma.user.create({
      data: {
        agencyId: agency.id,
        name: 'GPS Test Manager',
        email: `gps-manager-${suffix}@shiftgo.test`,
        passwordHash: 'test-password-hash',
        role: 'MANAGER',
      },
    });

    worker = await prisma.user.create({
      data: {
        agencyId: agency.id,
        name: 'GPS Test Worker',
        email: `gps-worker-${suffix}@shiftgo.test`,
        passwordHash: 'test-password-hash',
        role: 'WORKER',
      },
    });

    house = await prisma.house.create({
      data: {
        agencyId: agency.id,
        name: `GPS Test House ${suffix}`,
        address: '25 GPS Street',
        latitude: 51.5,
        longitude: -0.12,
        geofenceRadius: 80,
        managerId: manager.id,
      },
    });
  });

  afterAll(async () => {
    if (agency) await prisma.auditLog.deleteMany({ where: { agencyId: agency.id } });
    await prisma.timesheet.deleteMany({ where: { workerId: worker?.id } });
    await prisma.clockEvent.deleteMany({ where: { workerId: worker?.id } });
    await prisma.shift.deleteMany({ where: { houseId: house?.id } });
    if (house) await prisma.house.delete({ where: { id: house.id } });
    await prisma.user.deleteMany({ where: { id: { in: [manager?.id, worker?.id].filter(Boolean) } } });
    if (agency) await prisma.agency.delete({ where: { id: agency.id } });
    await prisma.$disconnect();
  });

  it('accepts high accuracy automatic GPS clock-in', async () => {
    const shift = await createActiveShift();

    const res = await request(app)
      .post('/clock/auto-checkin')
      .set('Authorization', `Bearer ${tokenFor(worker)}`)
      .send({ latitude: house.latitude, longitude: house.longitude, accuracy: 20 });

    expect(res.status).toBe(200);
    expect(res.body.data[0]).toEqual(expect.objectContaining({
      shiftId: shift.id,
      houseId: house.id,
    }));

    const event = await prisma.clockEvent.findFirst({
      where: { workerId: worker.id, shiftId: shift.id, type: 'IN' },
    });
    expect(event).toEqual(expect.objectContaining({
      accuracy: 20,
      gpsConfidence: 'HIGH',
      locationSource: 'GPS',
    }));
  });

  it('requires manual confirmation for low accuracy automatic GPS clock-in', async () => {
    const shift = await createActiveShift();

    const res = await request(app)
      .post('/clock/auto-checkin')
      .set('Authorization', `Bearer ${tokenFor(worker)}`)
      .send({ latitude: house.latitude, longitude: house.longitude, accuracy: 75 });

    expect(res.status).toBe(200);
    const result = res.body.data.find((item) => item.shiftId === shift.id);
    expect(result).toEqual(expect.objectContaining({
      shiftId: shift.id,
      houseId: house.id,
      requiresManualConfirmation: true,
      gpsConfidence: 'LOW',
    }));

    const eventCount = await prisma.clockEvent.count({
      where: { workerId: worker.id, shiftId: shift.id, type: 'IN' },
    });
    expect(eventCount).toBe(0);
  });

  it('rejects missing accuracy for automatic GPS clock-in', async () => {
    const res = await request(app)
      .post('/clock/auto-checkin')
      .set('Authorization', `Bearer ${tokenFor(worker)}`)
      .send({ latitude: house.latitude, longitude: house.longitude });

    expect(res.status).toBe(400);
    expect(res.body.error.fields).toEqual(expect.objectContaining({
      accuracy: 'Accuracy is required',
    }));
  });

  it('allows manual fallback with a reason while marking poor GPS as manual and unreliable', async () => {
    const shift = await createActiveShift();

    const res = await request(app)
      .post('/clock/in')
      .set('Authorization', `Bearer ${tokenFor(worker)}`)
      .send({
        houseId: house.id,
        shiftId: shift.id,
        latitude: house.latitude,
        longitude: house.longitude,
        accuracy: 150,
        reason: 'GPS weak but worker confirmed arrival',
      });

    expect(res.status).toBe(200);

    const event = await prisma.clockEvent.findFirst({
      where: { workerId: worker.id, shiftId: shift.id, type: 'IN' },
    });
    expect(event).toEqual(expect.objectContaining({
      accuracy: 150,
      gpsConfidence: 'UNRELIABLE',
      locationSource: 'MANUAL',
    }));
  });
});
