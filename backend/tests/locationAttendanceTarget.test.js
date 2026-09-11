process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-access-secret';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test-refresh-secret';
process.env.RATE_LIMIT_DISABLED = 'true';

// Location Attendance Target V1 — internal refactor guard.
//
// Introduces attendanceTargetFor(shift) and threads it through geofence
// evaluation + attendance config + clock/attendance messages. Care ROTA
// attendance must be behaviourally identical: House wins, House geofence is
// authoritative, locationId stays NULL everywhere.

const request = require('supertest');
const { PrismaClient } = require('@prisma/client');
const app = require('../src/app');
const { signAccess } = require('../src/utils/jwt');
const { attendanceTargetFor } = require('../src/services/attendanceTargetService');
const { evaluateLocation } = require('../src/services/geofenceService');
const { attendanceConfigFor, ATTENDANCE_DEFAULTS } = require('../src/config/attendance');

const prisma = new PrismaClient();
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const tokenFor = (u) => signAccess({ id: u.id, agencyId: u.agencyId, role: u.role, status: u.status, name: u.name, email: u.email });
const as = (u) => ({
  post: (p, b) => request(app).post(p).set('Authorization', `Bearer ${tokenFor(u)}`).send(b || {}),
});

const LAT = 51.5;
const LNG = -0.12;
const OUTSIDE_LAT = 51.51; // ~1.1 km north
const RADIUS = 50;
const HOUR = 3_600_000;

let agency, manager, worker, house, location;

beforeAll(async () => {
  agency = await prisma.agency.create({ data: { name: `LAT ${suffix}` } });
  manager = await prisma.user.create({
    data: { agencyId: agency.id, role: 'MANAGER', name: 'LAT Mgr', email: `lat-mgr-${suffix}@t.test`, passwordHash: 'x' },
  });
  worker = await prisma.user.create({
    data: { agencyId: agency.id, role: 'WORKER', name: 'LAT Wkr', email: `lat-wkr-${suffix}@t.test`, passwordHash: 'x' },
  });
  house = await prisma.house.create({
    data: {
      agencyId: agency.id, name: `LAT House ${suffix}`, address: '1 Test St',
      latitude: LAT, longitude: LNG, geofenceRadius: RADIUS, managerId: manager.id,
    },
  });
  location = await prisma.location.create({
    data: {
      agencyId: agency.id, name: `LAT Office ${suffix}`, type: 'OFFICE',
      latitude: LAT, longitude: LNG, geofenceRadius: RADIUS, timezone: 'Europe/London',
    },
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

// A plain reading captured "now".
const reading = (lat, lng) => ({ latitude: lat, longitude: lng, accuracy: 10, capturedAt: new Date().toISOString() });

describe('attendanceTargetFor resolver', () => {
  test('1. resolves a HOUSE target from shift.house', () => {
    const t = attendanceTargetFor({ house, location: null });
    expect(t).toEqual({
      type: 'HOUSE',
      id: house.id,
      name: house.name,
      latitude: LAT,
      longitude: LNG,
      geofenceRadius: RADIUS,
      timezone: null,
    });
  });

  test('2. HOUSE wins when both house and location are present', () => {
    const t = attendanceTargetFor({ house, location });
    expect(t.type).toBe('HOUSE');
    expect(t.id).toBe(house.id);
    expect(t.name).toBe(house.name);
  });

  test('3. resolves a LOCATION target internally when there is no house', () => {
    const t = attendanceTargetFor({ house: null, location });
    expect(t).toEqual({
      type: 'LOCATION',
      id: location.id,
      name: location.name,
      latitude: LAT,
      longitude: LNG,
      geofenceRadius: RADIUS,
      timezone: 'Europe/London',
    });
  });

  test('returns null when neither a house nor a location is loaded', () => {
    expect(attendanceTargetFor({ house: null, location: null })).toBeNull();
    expect(attendanceTargetFor({})).toBeNull();
  });
});

describe('geofence evaluation is unchanged for a HOUSE target and identical for a LOCATION target', () => {
  const houseTarget = () => attendanceTargetFor({ house, location: null });
  const locationTarget = () => attendanceTargetFor({ house: null, location });

  test('4. HOUSE target — onsite reading classifies ONSITE with the House radius', () => {
    const geo = evaluateLocation({ ...reading(LAT, LNG), target: houseTarget() });
    expect(geo.ok).toBe(true);
    expect(geo.accuracySufficient).toBe(true);
    expect(geo.withinGeofence).toBe(true);
    expect(geo.locationStatus).toBe('ONSITE');
    expect(geo.radiusM).toBe(RADIUS);
    expect(typeof geo.distanceMeters).toBe('number');
  });

  test('4b. HOUSE target — a reading ~1 km away classifies OFFSITE', () => {
    const geo = evaluateLocation({ ...reading(OUTSIDE_LAT, LNG), target: houseTarget() });
    expect(geo.ok).toBe(true);
    expect(geo.withinGeofence).toBe(false);
    expect(geo.locationStatus).toBe('OFFSITE');
    expect(geo.distanceMeters).toBeGreaterThan(RADIUS);
  });

  test('5. LOCATION target with the same coords + radius produces byte-identical output', () => {
    for (const [lat, lng] of [[LAT, LNG], [OUTSIDE_LAT, LNG]]) {
      const now = Date.now();
      const h = evaluateLocation({ ...reading(lat, lng), target: houseTarget(), now });
      const l = evaluateLocation({ ...reading(lat, lng), target: locationTarget(), now });
      expect(l).toEqual(h);
    }
  });

  test('attendanceConfigFor: a HOUSE target passes the House radius through; a target with no radius falls back to the default', () => {
    expect(attendanceConfigFor(houseTarget()).geofenceRadiusM).toBe(RADIUS);
    expect(attendanceConfigFor({ geofenceRadius: null }).geofenceRadiusM).toBe(ATTENDANCE_DEFAULTS.defaultGeofenceRadiusM);
    // Full config object is otherwise the defaults, unchanged.
    expect(attendanceConfigFor(houseTarget())).toEqual({ ...ATTENDANCE_DEFAULTS, geofenceRadiusM: RADIUS });
  });
});

describe('care clock-in / clock-out still runs on the House and never writes locationId', () => {
  test('6-10. full cycle: 200s, ClockEvent/AttendanceMonitor/Timesheet carry houseId, locationId stays null', async () => {
    const now = Date.now();
    const shift = await prisma.shift.create({
      data: {
        agencyId: agency.id, houseId: house.id, workerId: worker.id, createdById: manager.id,
        date: new Date(now), startTime: new Date(now - HOUR), endTime: new Date(now + HOUR),
        status: 'SCHEDULED',
      },
    });

    const inRes = await as(worker).post('/clock/in', {
      houseId: house.id, shiftId: shift.id, latitude: LAT, longitude: LNG, accuracy: 10,
    });
    expect(inRes.status).toBe(200);

    // reportLocation path (refactored to use the resolved target) still responds active.
    const rep = await as(worker).post('/clock/location', {
      shiftId: shift.id, latitude: LAT, longitude: LNG, accuracy: 10, capturedAt: new Date().toISOString(),
    });
    expect(rep.status).toBe(200);
    expect(rep.body.data.active).toBe(true);

    const outRes = await as(worker).post('/clock/out', {
      houseId: house.id, shiftId: shift.id, latitude: LAT, longitude: LNG, accuracy: 10,
    });
    expect(outRes.status).toBe(200);

    const events = await prisma.clockEvent.findMany({ where: { shiftId: shift.id } });
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
