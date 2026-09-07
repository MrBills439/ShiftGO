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
const tokenFor = (u) => signAccess({ id: u.id, agencyId: u.agencyId, role: u.role, status: u.status, name: u.name, email: u.email });

let agency;
let manager;
let worker;
let house;

beforeAll(async () => {
  agency = await prisma.agency.create({ data: { name: `ClockTx ${suffix}` } });
  manager = await prisma.user.create({ data: { agencyId: agency.id, role: 'MANAGER', name: 'Mgr', email: `ctx-mgr-${suffix}@shiftgo.test`, passwordHash: 'x' } });
  worker = await prisma.user.create({ data: { agencyId: agency.id, role: 'WORKER', name: 'Wkr', email: `ctx-wkr-${suffix}@shiftgo.test`, passwordHash: 'x' } });
  house = await prisma.house.create({ data: { agencyId: agency.id, name: `ClockTx House ${suffix}`, address: '1 St', latitude: 51.5, longitude: -0.12, managerId: manager.id } });
});

afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { agencyId: agency.id } });
  await prisma.attendanceMonitor.deleteMany({ where: { workerId: worker.id } });
  await prisma.timesheet.deleteMany({ where: { workerId: worker.id } });
  await prisma.clockEvent.deleteMany({ where: { workerId: worker.id } });
  await prisma.shift.deleteMany({ where: { houseId: house.id } });
  await prisma.house.delete({ where: { id: house.id } });
  await prisma.user.deleteMany({ where: { id: { in: [manager.id, worker.id] } } });
  await prisma.agency.delete({ where: { id: agency.id } });
  await prisma.$disconnect();
});

test('clock-in -> active (IN_PROGRESS) -> clock-out (COMPLETED) shift/timesheet transitions', async () => {
  const now = Date.now();
  const shift = await prisma.shift.create({
    data: {
      agencyId: agency.id, houseId: house.id, workerId: worker.id, createdById: manager.id,
      date: new Date(now), startTime: new Date(now - 3_600_000), endTime: new Date(now + 3_600_000),
      status: 'SCHEDULED',
    },
  });
  const auth = `Bearer ${tokenFor(worker)}`;

  // before: SCHEDULED, no timesheet
  expect((await prisma.shift.findUnique({ where: { id: shift.id } })).status).toBe('SCHEDULED');
  expect(await prisma.timesheet.findUnique({ where: { shiftId: shift.id } })).toBeNull();

  // clock in (inside geofence + shift window)
  const clockIn = await request(app).post('/clock/in').set('Authorization', auth).send({
    houseId: house.id, shiftId: shift.id,
    timestamp: new Date(now - 120_000).toISOString(),
    latitude: house.latitude, longitude: house.longitude, accuracy: 12,
  });
  expect(clockIn.status).toBe(200);

  // active: shift IN_PROGRESS, timesheet clocked in, not out
  expect((await prisma.shift.findUnique({ where: { id: shift.id } })).status).toBe('IN_PROGRESS');
  let ts = await prisma.timesheet.findUnique({ where: { shiftId: shift.id } });
  expect(ts.clockInAt).toBeTruthy();
  expect(ts.clockOutAt).toBeNull();

  // clock out
  const clockOut = await request(app).post('/clock/out').set('Authorization', auth).send({
    houseId: house.id, shiftId: shift.id, timestamp: new Date(now - 30_000).toISOString(),
  });
  expect(clockOut.status).toBe(200);

  // done: shift COMPLETED, timesheet clocked out
  expect((await prisma.shift.findUnique({ where: { id: shift.id } })).status).toBe('COMPLETED');
  ts = await prisma.timesheet.findUnique({ where: { shiftId: shift.id } });
  expect(ts.clockOutAt).toBeTruthy();

  // monitor closed (background attendance monitoring stopped)
  const monitor = await prisma.attendanceMonitor.findUnique({ where: { shiftId: shift.id } });
  expect(monitor?.closedAt).toBeTruthy();
});
