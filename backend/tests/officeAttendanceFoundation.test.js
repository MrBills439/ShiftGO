process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-access-secret';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test-refresh-secret';
process.env.RATE_LIMIT_DISABLED = 'true';

// Office Attendance Foundation V1 — schema-foundation regression guard.
//
// This task ONLY adds additive, unused columns/relations:
//   Shift.kind (default ROTA), Shift.locationId, and nullable ClockEvent/
//   AttendanceMonitor/Timesheet.locationId + Location back-relations.
// It must NOT change any behaviour. These tests pin the invariants that would
// break if a future change accidentally started using the foundation fields, or
// if the migration were not truly additive.

const request = require('supertest');
const { PrismaClient } = require('@prisma/client');
const app = require('../src/app');
const { signAccess } = require('../src/utils/jwt');

const prisma = new PrismaClient();
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const tokenFor = (u) => signAccess({ id: u.id, agencyId: u.agencyId, role: u.role, status: u.status, name: u.name, email: u.email });
const as = (u) => ({
  get: (p) => request(app).get(p).set('Authorization', `Bearer ${tokenFor(u)}`),
  post: (p, b) => request(app).post(p).set('Authorization', `Bearer ${tokenFor(u)}`).send(b || {}),
});

const HOUSE_LAT = 51.5;
const HOUSE_LNG = -0.12;
const HOUR = 3_600_000;

let agency, manager, worker, house, location;

beforeAll(async () => {
  agency = await prisma.agency.create({ data: { name: `OAF ${suffix}` } });
  manager = await prisma.user.create({
    data: { agencyId: agency.id, role: 'MANAGER', name: 'OAF Mgr', email: `oaf-mgr-${suffix}@t.test`, passwordHash: 'x' },
  });
  worker = await prisma.user.create({
    data: { agencyId: agency.id, role: 'WORKER', name: 'OAF Wkr', email: `oaf-wkr-${suffix}@t.test`, passwordHash: 'x' },
  });
  house = await prisma.house.create({
    data: {
      agencyId: agency.id, name: `OAF House ${suffix}`, address: '1 Test St',
      latitude: HOUSE_LAT, longitude: HOUSE_LNG, geofenceRadius: 50, managerId: manager.id,
    },
  });
  // A Location exists in the agency but is never linked to any attendance row.
  location = await prisma.location.create({
    data: { agencyId: agency.id, name: `OAF Office ${suffix}`, type: 'OFFICE' },
  });
});

afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { agencyId: agency.id } });
  await prisma.timesheet.deleteMany({ where: { agencyId: agency.id } });
  await prisma.attendanceMonitor.deleteMany({ where: { agencyId: agency.id } });
  await prisma.clockEvent.deleteMany({ where: { agencyId: agency.id } });
  await prisma.shift.deleteMany({ where: { agencyId: agency.id } });
  await prisma.location.deleteMany({ where: { agencyId: agency.id } });
  await prisma.house.deleteMany({ where: { agencyId: agency.id } });
  await prisma.user.deleteMany({ where: { agencyId: agency.id } });
  await prisma.agency.deleteMany({ where: { id: agency.id } });
  await prisma.$disconnect();
});

describe('Shift.kind foundation', () => {
  test('a shift created via POST /shifts defaults to kind=ROTA with locationId=null and a required houseId', async () => {
    const start = Date.now() + 2 * 24 * HOUR;
    const res = await as(manager).post('/shifts', {
      workerId: worker.id, houseId: house.id,
      date: new Date(start).toISOString(),
      startTime: new Date(start).toISOString(),
      endTime: new Date(start + 4 * HOUR).toISOString(),
    });
    expect(res.status).toBe(201);

    const fresh = await prisma.shift.findUnique({ where: { id: res.body.data.id } });
    expect(fresh.kind).toBe('ROTA');
    expect(fresh.locationId).toBeNull();
    expect(fresh.houseId).toBe(house.id);
  });

  test('Shift.houseId is still REQUIRED — a create without it is rejected', async () => {
    await expect(
      prisma.shift.create({
        data: {
          agencyId: agency.id, workerId: worker.id, createdById: manager.id,
          date: new Date(), startTime: new Date(), endTime: new Date(Date.now() + HOUR),
          // no houseId
        },
      }),
    ).rejects.toThrow();
  });

  test('a raw ROTA shift with only houseId set keeps locationId null', async () => {
    const s = await prisma.shift.create({
      data: {
        agencyId: agency.id, houseId: house.id, workerId: worker.id, createdById: manager.id,
        date: new Date(), startTime: new Date(Date.now() + 10 * HOUR), endTime: new Date(Date.now() + 14 * HOUR),
        status: 'SCHEDULED',
      },
    });
    expect(s.kind).toBe('ROTA');
    expect(s.locationId).toBeNull();
    await prisma.shift.delete({ where: { id: s.id } });
  });
});

describe('care clock-in/out still writes houseId and never locationId', () => {
  test('full clock-in → clock-out cycle: ClockEvent / AttendanceMonitor / Timesheet all carry houseId, locationId stays null', async () => {
    const now = Date.now();
    const shift = await prisma.shift.create({
      data: {
        agencyId: agency.id, houseId: house.id, workerId: worker.id, createdById: manager.id,
        date: new Date(now), startTime: new Date(now - HOUR), endTime: new Date(now + HOUR),
        status: 'SCHEDULED',
      },
    });

    const inRes = await as(worker).post('/clock/in', {
      houseId: house.id, shiftId: shift.id, latitude: HOUSE_LAT, longitude: HOUSE_LNG, accuracy: 10,
    });
    expect(inRes.status).toBe(200);

    const outRes = await as(worker).post('/clock/out', {
      houseId: house.id, shiftId: shift.id, latitude: HOUSE_LAT, longitude: HOUSE_LNG, accuracy: 10,
    });
    expect(outRes.status).toBe(200);

    const events = await prisma.clockEvent.findMany({ where: { shiftId: shift.id }, orderBy: { type: 'asc' } });
    expect(events).toHaveLength(2);
    for (const e of events) {
      expect(e.houseId).toBe(house.id);
      expect(e.locationId).toBeNull();
    }

    const monitor = await prisma.attendanceMonitor.findUnique({ where: { shiftId: shift.id } });
    expect(monitor.houseId).toBe(house.id);
    expect(monitor.locationId).toBeNull();

    const ts = await prisma.timesheet.findUnique({ where: { shiftId: shift.id } });
    expect(ts.houseId).toBe(house.id);
    expect(ts.locationId).toBeNull();
    expect(ts.totalHours).toBeGreaterThan(0);
  });
});

describe('Location back-relations exist but reference nothing', () => {
  test('Location includes shifts / clockEvents / attendanceMonitors / timesheets, all empty', async () => {
    const withRels = await prisma.location.findUnique({
      where: { id: location.id },
      include: { shifts: true, clockEvents: true, attendanceMonitors: true, timesheets: true },
    });
    expect(withRels.shifts).toEqual([]);
    expect(withRels.clockEvents).toEqual([]);
    expect(withRels.attendanceMonitors).toEqual([]);
    expect(withRels.timesheets).toEqual([]);

    // And nothing in the agency links a Location on any attendance table.
    expect(await prisma.shift.count({ where: { agencyId: agency.id, locationId: { not: null } } })).toBe(0);
    expect(await prisma.clockEvent.count({ where: { agencyId: agency.id, locationId: { not: null } } })).toBe(0);
    expect(await prisma.attendanceMonitor.count({ where: { agencyId: agency.id, locationId: { not: null } } })).toBe(0);
    expect(await prisma.timesheet.count({ where: { agencyId: agency.id, locationId: { not: null } } })).toBe(0);
  });
});
