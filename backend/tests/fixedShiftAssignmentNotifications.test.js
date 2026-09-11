process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-access-secret';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test-refresh-secret';
process.env.RATE_LIMIT_DISABLED = 'true';

const request = require('supertest');
const { PrismaClient } = require('@prisma/client');
const appPrisma = require('../src/lib/prisma');
const app = require('../src/app');
const { signAccess } = require('../src/utils/jwt');

const prisma = new PrismaClient();
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

// Recurring Fixed Work Patterns V1 — Phase 4: manual (HTTP) shift-assignment
// notifications, now target-aware. Covers items 1-7 of the Phase 4 test list.
// Generation-triggered notifications (items 8-21) live in
// tests/fixedWorkPatternGenerationNotifications.test.js.

describe('Manual shift assignment notifications — target-aware (Phase 4)', () => {
  let agency;
  let hr;
  let workerRota;
  let workerFixed;
  let workerNoToken;
  let house;
  let locationA;
  let locationNY;

  function tokenFor(user) {
    return signAccess({ id: user.id, agencyId: user.agencyId, role: user.role, name: user.name, email: user.email });
  }

  const makeUser = (name, fcmToken = 'test-fcm-token') =>
    prisma.user.create({
      data: {
        agencyId: agency.id, name, email: `${name.toLowerCase().replace(/\s+/g, '-')}-${suffix}@shiftgo.test`,
        passwordHash: 'x', role: 'WORKER', fcmToken,
      },
    });

  beforeAll(async () => {
    agency = await prisma.agency.create({ data: { name: `Notify Agency ${suffix}`, timezone: 'Europe/London' } });
    hr = await prisma.user.create({
      data: { agencyId: agency.id, name: 'Notify HR', email: `notify-hr-${suffix}@shiftgo.test`, passwordHash: 'x', role: 'HR' },
    });
    workerRota = await makeUser('Notify Rota Worker');
    workerFixed = await makeUser('Notify Fixed Worker');
    workerNoToken = await makeUser('Notify NoToken Worker', null);

    house = await prisma.house.create({
      data: { agencyId: agency.id, name: `Notify House ${suffix}`, address: '1 Test St', latitude: 51.5, longitude: -0.1 },
    });
    locationA = await prisma.location.create({
      data: { agencyId: agency.id, name: `Notify Head Office ${suffix}`, type: 'OFFICE', active: true },
    });
    locationNY = await prisma.location.create({
      data: { agencyId: agency.id, name: `Notify NY Office ${suffix}`, type: 'OFFICE', active: true, timezone: 'America/New_York' },
    });
  });

  afterAll(async () => {
    await prisma.notification.deleteMany({ where: { agencyId: agency.id } });
    await prisma.auditLog.deleteMany({ where: { agencyId: agency.id } });
    await prisma.shift.deleteMany({ where: { agencyId: agency.id } });
    await prisma.house.deleteMany({ where: { agencyId: agency.id } });
    await prisma.location.deleteMany({ where: { agencyId: agency.id } });
    await prisma.user.deleteMany({ where: { agencyId: agency.id } });
    await prisma.agency.deleteMany({ where: { id: agency.id } });
    await prisma.$disconnect();
    // This file's own copy of the shared `../src/lib/prisma` singleton (used
    // above for `jest.spyOn(appPrisma.notification, 'create')`) — released
    // explicitly rather than left open for the rest of the Jest process.
    await appPrisma.$disconnect();
  });

  function farFutureIsoDate(daysFromNow, hour) {
    const d = new Date(Date.now() + daysFromNow * 86_400_000);
    d.setUTCHours(hour, 0, 0, 0);
    return d;
  }

  it('1. manual ROTA assignment notifies the worker', async () => {
    const start = farFutureIsoDate(40, 9);
    const end = farFutureIsoDate(40, 17);
    const res = await request(app).post('/shifts').set('Authorization', `Bearer ${tokenFor(hr)}`).send({
      kind: 'ROTA', houseId: house.id, workerId: workerRota.id,
      startTime: start.toISOString(), endTime: end.toISOString(), date: start.toISOString(),
    });
    expect(res.status).toBe(201);
    await new Promise((r) => setTimeout(r, 50)); // notification fires non-blocking, after the response
    const notif = await prisma.notification.findFirst({ where: { userId: workerRota.id, type: 'SHIFT_ASSIGNED' }, orderBy: { createdAt: 'desc' } });
    expect(notif).toBeTruthy();
  });

  it('2/3. manual FIXED assignment now notifies, using the Location name', async () => {
    const start = farFutureIsoDate(41, 9);
    const end = farFutureIsoDate(41, 17);
    const res = await request(app).post('/shifts').set('Authorization', `Bearer ${tokenFor(hr)}`).send({
      kind: 'FIXED', locationId: locationA.id, workerId: workerFixed.id,
      startTime: start.toISOString(), endTime: end.toISOString(), date: start.toISOString(),
    });
    expect(res.status).toBe(201);
    await new Promise((r) => setTimeout(r, 50));
    const notif = await prisma.notification.findFirst({ where: { userId: workerFixed.id, type: 'SHIFT_ASSIGNED' }, orderBy: { createdAt: 'desc' } });
    expect(notif).toBeTruthy();
    expect(notif.body).toContain(locationA.name);
  });

  it('4. ROTA message still uses the House name', async () => {
    const notif = await prisma.notification.findFirst({ where: { userId: workerRota.id, type: 'SHIFT_ASSIGNED' }, orderBy: { createdAt: 'desc' } });
    expect(notif.body).toContain(house.name);
  });

  it('5. FIXED message shows the Location\'s own local time, not raw UTC', async () => {
    const w = await makeUser('Notify NY Worker');
    // 14:00 UTC — a wall-clock time that reads differently in America/New_York
    // (EDT/EST, UTC-4/-5) than in UTC, so getting the timezone wrong would
    // produce a different, wrong hour in the message.
    const start = farFutureIsoDate(42, 14);
    const end = farFutureIsoDate(42, 18);
    const res = await request(app).post('/shifts').set('Authorization', `Bearer ${tokenFor(hr)}`).send({
      kind: 'FIXED', locationId: locationNY.id, workerId: w.id,
      startTime: start.toISOString(), endTime: end.toISOString(), date: start.toISOString(),
    });
    expect(res.status).toBe(201);
    await new Promise((r) => setTimeout(r, 50));
    const notif = await prisma.notification.findFirst({ where: { userId: w.id, type: 'SHIFT_ASSIGNED' }, orderBy: { createdAt: 'desc' } });
    const expectedLocal = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'America/New_York', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
    }).format(start);
    expect(notif.body).toContain(expectedLocal);
  });

  it('6. a worker with no FCM token still gets a Notification row, and shift creation never fails', async () => {
    const start = farFutureIsoDate(43, 9);
    const end = farFutureIsoDate(43, 17);
    const res = await request(app).post('/shifts').set('Authorization', `Bearer ${tokenFor(hr)}`).send({
      kind: 'FIXED', locationId: locationA.id, workerId: workerNoToken.id,
      startTime: start.toISOString(), endTime: end.toISOString(), date: start.toISOString(),
    });
    expect(res.status).toBe(201);
    await new Promise((r) => setTimeout(r, 50));
    const notif = await prisma.notification.findFirst({ where: { userId: workerNoToken.id, type: 'SHIFT_ASSIGNED' } });
    expect(notif).toBeTruthy(); // the DB row is written regardless of push delivery
  });

  it('7. a notification failure never rolls back the manually-created FIXED shift', async () => {
    const w = await makeUser('Notify FailureSafe Worker');
    const start = farFutureIsoDate(44, 9);
    const end = farFutureIsoDate(44, 17);

    const spy = jest.spyOn(appPrisma.notification, 'create').mockRejectedValueOnce(new Error('simulated notification failure'));
    const res = await request(app).post('/shifts').set('Authorization', `Bearer ${tokenFor(hr)}`).send({
      kind: 'FIXED', locationId: locationA.id, workerId: w.id,
      startTime: start.toISOString(), endTime: end.toISOString(), date: start.toISOString(),
    });
    expect(res.status).toBe(201); // the HTTP response already succeeded before the async notification even runs
    await new Promise((r) => setTimeout(r, 50));
    spy.mockRestore();

    const shift = await prisma.shift.findFirst({ where: { workerId: w.id, kind: 'FIXED' } });
    expect(shift).toBeTruthy();
    expect(shift.id).toBe(res.body.data.id);
  });
});
