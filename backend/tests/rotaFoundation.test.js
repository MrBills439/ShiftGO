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
let workerA2;
let workerB;
let houseA;
let houseB;
const createdShiftIds = [];

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

function iso(value) {
  return new Date(value).toISOString();
}

function shiftBody(workerId, houseId, start, end, shiftType) {
  return {
    workerId,
    houseId,
    date: iso(start),
    startTime: iso(start),
    endTime: iso(end),
    ...(shiftType ? { shiftType } : {}),
  };
}

describe('Rota foundation', () => {
  beforeAll(async () => {
    agencyA = await prisma.agency.create({ data: { name: `Rota Agency A ${suffix}` } });
    agencyB = await prisma.agency.create({ data: { name: `Rota Agency B ${suffix}` } });

    managerA = await prisma.user.create({
      data: {
        agencyId: agencyA.id,
        name: 'Rota Manager A',
        email: `rota-manager-a-${suffix}@shiftgo.test`,
        passwordHash: 'test-password-hash',
        role: 'MANAGER',
      },
    });
    managerB = await prisma.user.create({
      data: {
        agencyId: agencyB.id,
        name: 'Rota Manager B',
        email: `rota-manager-b-${suffix}@shiftgo.test`,
        passwordHash: 'test-password-hash',
        role: 'MANAGER',
      },
    });
    workerA = await prisma.user.create({
      data: {
        agencyId: agencyA.id,
        name: 'Rota Worker A',
        email: `rota-worker-a-${suffix}@shiftgo.test`,
        passwordHash: 'test-password-hash',
        role: 'WORKER',
      },
    });
    workerA2 = await prisma.user.create({
      data: {
        agencyId: agencyA.id,
        name: 'Rota Worker A2',
        email: `rota-worker-a2-${suffix}@shiftgo.test`,
        passwordHash: 'test-password-hash',
        role: 'WORKER',
      },
    });
    workerB = await prisma.user.create({
      data: {
        agencyId: agencyB.id,
        name: 'Rota Worker B',
        email: `rota-worker-b-${suffix}@shiftgo.test`,
        passwordHash: 'test-password-hash',
        role: 'WORKER',
      },
    });

    houseA = await prisma.house.create({
      data: {
        agencyId: agencyA.id,
        name: `Rota House A ${suffix}`,
        address: '1 Rota Street',
        latitude: 51.5,
        longitude: -0.12,
        managerId: managerA.id,
      },
    });
    houseB = await prisma.house.create({
      data: {
        agencyId: agencyB.id,
        name: `Rota House B ${suffix}`,
        address: '2 Rota Street',
        latitude: 51.6,
        longitude: -0.13,
        managerId: managerB.id,
      },
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

  it('creates a LONG_DAY shift by default', async () => {
    const start = Date.UTC(2026, 6, 6, 8, 0, 0);
    const res = await request(app)
      .post('/shifts')
      .set('Authorization', `Bearer ${tokenFor(managerA)}`)
      .send(shiftBody(workerA.id, houseA.id, start, start + 4 * 3_600_000));

    expect(res.status).toBe(201);
    expect(res.body.data.shiftType).toBe('LONG_DAY');
    createdShiftIds.push(res.body.data.id);
  });

  it('creates a WAKE_NIGHT shift', async () => {
    const start = Date.UTC(2026, 6, 7, 20, 0, 0);
    const res = await request(app)
      .post('/shifts')
      .set('Authorization', `Bearer ${tokenFor(managerA)}`)
      .send(shiftBody(workerA.id, houseA.id, start, start + 10 * 3_600_000, 'WAKE_NIGHT'));

    expect(res.status).toBe(201);
    expect(res.body.data.shiftType).toBe('WAKE_NIGHT');
    createdShiftIds.push(res.body.data.id);
  });

  it('rejects invalid shiftType', async () => {
    const start = Date.UTC(2026, 6, 8, 8, 0, 0);
    const res = await request(app)
      .post('/shifts')
      .set('Authorization', `Bearer ${tokenFor(managerA)}`)
      .send(shiftBody(workerA.id, houseA.id, start, start + 4 * 3_600_000, 'BAD_TYPE'));

    expect(res.status).toBe(400);
    expect(res.body.error.fields).toEqual(expect.objectContaining({
      shiftType: 'Shift type must be LONG_DAY, MID_DAY, WAKE_NIGHT, or SLEEP_IN',
    }));
  });

  it('rejects overlapping worker shifts', async () => {
    const start = Date.UTC(2026, 6, 9, 8, 0, 0);
    const first = await request(app)
      .post('/shifts')
      .set('Authorization', `Bearer ${tokenFor(managerA)}`)
      .send(shiftBody(workerA.id, houseA.id, start, start + 4 * 3_600_000));
    expect(first.status).toBe(201);
    createdShiftIds.push(first.body.data.id);

    const second = await request(app)
      .post('/shifts')
      .set('Authorization', `Bearer ${tokenFor(managerA)}`)
      .send(shiftBody(workerA.id, houseA.id, start + 2 * 3_600_000, start + 6 * 3_600_000));

    expect(second.status).toBe(409);
    expect(second.body.message).toBe('Worker already has an overlapping shift');
  });

  it('allows same-time shifts for different workers', async () => {
    const start = Date.UTC(2026, 6, 10, 8, 0, 0);
    const first = await request(app)
      .post('/shifts')
      .set('Authorization', `Bearer ${tokenFor(managerA)}`)
      .send(shiftBody(workerA.id, houseA.id, start, start + 4 * 3_600_000));
    const second = await request(app)
      .post('/shifts')
      .set('Authorization', `Bearer ${tokenFor(managerA)}`)
      .send(shiftBody(workerA2.id, houseA.id, start, start + 4 * 3_600_000));

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    createdShiftIds.push(first.body.data.id, second.body.data.id);
  });

  it('allows overlap if previous shift is cancelled', async () => {
    const start = Date.UTC(2026, 6, 11, 8, 0, 0);
    const cancelled = await prisma.shift.create({
      data: {
        agencyId: agencyA.id,
        houseId: houseA.id,
        workerId: workerA.id,
        createdById: managerA.id,
        date: new Date(start),
        startTime: new Date(start),
        endTime: new Date(start + 4 * 3_600_000),
        status: 'CANCELLED',
      },
    });
    createdShiftIds.push(cancelled.id);

    const res = await request(app)
      .post('/shifts')
      .set('Authorization', `Bearer ${tokenFor(managerA)}`)
      .send(shiftBody(workerA.id, houseA.id, start + 3_600_000, start + 5 * 3_600_000));

    expect(res.status).toBe(201);
    createdShiftIds.push(res.body.data.id);
  });

  it('rejects overlap across midnight', async () => {
    const start = Date.UTC(2026, 6, 12, 22, 0, 0);
    const first = await request(app)
      .post('/shifts')
      .set('Authorization', `Bearer ${tokenFor(managerA)}`)
      .send(shiftBody(workerA.id, houseA.id, start, start + 8 * 3_600_000, 'SLEEP_IN'));
    expect(first.status).toBe(201);
    createdShiftIds.push(first.body.data.id);

    const second = await request(app)
      .post('/shifts')
      .set('Authorization', `Bearer ${tokenFor(managerA)}`)
      .send(shiftBody(workerA.id, houseA.id, start + 6 * 3_600_000, start + 10 * 3_600_000, 'LONG_DAY'));

    expect(second.status).toBe(409);
    expect(second.body.message).toBe('Worker already has an overlapping shift');
  });

  it('lets a manager query weekly rota', async () => {
    const startDate = '2026-07-06';
    const res = await request(app)
      .get(`/rota/week?startDate=${startDate}`)
      .set('Authorization', `Bearer ${tokenFor(managerA)}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(expect.arrayContaining([
      expect.objectContaining({
        shiftType: 'LONG_DAY',
        status: 'SCHEDULED',
        worker: expect.objectContaining({ id: workerA.id }),
        house: expect.objectContaining({ id: houseA.id }),
      }),
      expect.objectContaining({
        shiftType: 'WAKE_NIGHT',
        worker: expect.objectContaining({ id: workerA.id }),
      }),
    ]));
  });

  it('lets a worker query only their own rota', async () => {
    const res = await request(app)
      .get('/rota/me')
      .set('Authorization', `Bearer ${tokenFor(workerA)}`);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    expect(res.body.data.every((item) => item.worker.id === workerA.id)).toBe(true);
    expect(res.body.data.map((item) => item.worker.id)).not.toContain(workerA2.id);
  });

  it('keeps rota data isolated by agency', async () => {
    const start = Date.UTC(2026, 6, 14, 8, 0, 0);
    const shiftB = await prisma.shift.create({
      data: {
        agencyId: agencyB.id,
        houseId: houseB.id,
        workerId: workerB.id,
        createdById: managerB.id,
        date: new Date(start),
        startTime: new Date(start),
        endTime: new Date(start + 4 * 3_600_000),
        shiftType: 'MID_DAY',
      },
    });
    createdShiftIds.push(shiftB.id);

    const res = await request(app)
      .get('/rota/week?startDate=2026-07-13')
      .set('Authorization', `Bearer ${tokenFor(managerA)}`);

    expect(res.status).toBe(200);
    expect(res.body.data.map((item) => item.shiftId)).not.toContain(shiftB.id);
  });
});
