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
let workerA;
let workerB;
let teamLeader;
let house;

function tokenFor(user) {
  return signAccess({
    id: user.id,
    role: user.role,
    name: user.name,
    email: user.email,
  });
}

async function createScheduledShift(overrides = {}) {
  const now = Date.now();
  return prisma.shift.create({
    data: {
      agencyId: agency.id,
      houseId: house.id,
      createdById: manager.id,
      date: new Date(now + 86_400_000),
      startTime: new Date(now + 86_400_000),
      endTime: new Date(now + 90_000_000),
      status: 'SCHEDULED',
      ...overrides,
    },
  });
}

async function openShift(shift, eligibleRoles) {
  const res = await request(app)
    .post(`/shifts/${shift.id}/open`)
    .set('Authorization', `Bearer ${tokenFor(manager)}`)
    .send(eligibleRoles ? { eligibleRoles } : {});
  return res;
}

describe('Open-shift broadcast + claim flow', () => {
  beforeAll(async () => {
    agency = await prisma.agency.create({ data: { name: `Open Shift Agency ${suffix}` } });

    manager = await prisma.user.create({
      data: {
        agencyId: agency.id,
        name: 'Open Shift Manager',
        email: `open-shift-manager-${suffix}@shiftgo.test`,
        passwordHash: 'test-password-hash',
        role: 'MANAGER',
      },
    });

    workerA = await prisma.user.create({
      data: {
        agencyId: agency.id,
        name: 'Open Shift Worker A',
        email: `open-shift-worker-a-${suffix}@shiftgo.test`,
        passwordHash: 'test-password-hash',
        role: 'WORKER',
      },
    });

    workerB = await prisma.user.create({
      data: {
        agencyId: agency.id,
        name: 'Open Shift Worker B',
        email: `open-shift-worker-b-${suffix}@shiftgo.test`,
        passwordHash: 'test-password-hash',
        role: 'WORKER',
      },
    });

    teamLeader = await prisma.user.create({
      data: {
        agencyId: agency.id,
        name: 'Open Shift Team Leader',
        email: `open-shift-team-leader-${suffix}@shiftgo.test`,
        passwordHash: 'test-password-hash',
        role: 'TEAM_LEADER',
      },
    });

    house = await prisma.house.create({
      data: {
        agencyId: agency.id,
        name: `Open Shift House ${suffix}`,
        address: '1 Open Shift Street',
        latitude: 51.5,
        longitude: -0.12,
        managerId: manager.id,
      },
    });
  });

  afterAll(async () => {
    if (agency) await prisma.notification.deleteMany({ where: { agencyId: agency.id } });
    if (agency) await prisma.auditLog.deleteMany({ where: { agencyId: agency.id } });
    await prisma.shiftClaim.deleteMany({ where: { shift: { houseId: house?.id } } });
    await prisma.shift.deleteMany({ where: { houseId: house?.id } });
    if (house) await prisma.house.delete({ where: { id: house.id } });
    await prisma.user.deleteMany({
      where: { id: { in: [manager?.id, workerA?.id, workerB?.id, teamLeader?.id].filter(Boolean) } },
    });
    if (agency) await prisma.agency.delete({ where: { id: agency.id } });
    await prisma.$disconnect();
  });

  it('claiming an open shift creates a ShiftClaim, updates status/workerId, and notifies both sides', async () => {
    const shift = await createScheduledShift();
    const openRes = await openShift(shift);
    expect(openRes.status).toBe(200);
    expect(openRes.body.data.status).toBe('OPEN');

    const claimRes = await request(app)
      .post(`/shifts/${shift.id}/claim`)
      .set('Authorization', `Bearer ${tokenFor(workerA)}`)
      .send();

    expect(claimRes.status).toBe(201);
    expect(claimRes.body.data.shift).toEqual(expect.objectContaining({
      id: shift.id,
      status: 'CLAIMED',
      workerId: workerA.id,
    }));
    expect(claimRes.body.data.claim).toEqual(expect.objectContaining({
      shiftId: shift.id,
      workerId: workerA.id,
      status: 'CLAIMED',
    }));

    const claimRow = await prisma.shiftClaim.findUnique({
      where: { shiftId_workerId: { shiftId: shift.id, workerId: workerA.id } },
    });
    expect(claimRow).toBeTruthy();

    await new Promise((resolve) => setTimeout(resolve, 150));

    const claimerNotification = await prisma.notification.findFirst({
      where: { userId: workerA.id, type: 'SHIFT_CLAIMED_YOU', data: { path: ['shiftId'], equals: shift.id } },
    });
    expect(claimerNotification).toBeTruthy();

    const otherNotification = await prisma.notification.findFirst({
      where: { userId: workerB.id, type: 'SHIFT_CLAIMED_OTHER', data: { path: ['shiftId'], equals: shift.id } },
    });
    expect(otherNotification).toBeTruthy();
  });

  it('returns 409 for the second worker when two workers claim the same shift concurrently', async () => {
    const shift = await createScheduledShift();
    await openShift(shift);

    const [resA, resB] = await Promise.all([
      request(app).post(`/shifts/${shift.id}/claim`).set('Authorization', `Bearer ${tokenFor(workerA)}`).send(),
      request(app).post(`/shifts/${shift.id}/claim`).set('Authorization', `Bearer ${tokenFor(workerB)}`).send(),
    ]);

    const statuses = [resA.status, resB.status].sort();
    expect(statuses).toEqual([201, 409]);

    const winner = resA.status === 201 ? resA : resB;
    expect(winner.body.data.shift.workerId).toEqual(expect.any(String));

    const claims = await prisma.shiftClaim.findMany({ where: { shiftId: shift.id } });
    expect(claims).toHaveLength(1);
  });

  it('rejects a claim from a worker whose role is not eligible', async () => {
    const shift = await createScheduledShift();
    await openShift(shift, ['WORKER']);

    const res = await request(app)
      .post(`/shifts/${shift.id}/claim`)
      .set('Authorization', `Bearer ${tokenFor(teamLeader)}`)
      .send();

    expect(res.status).toBe(403);
  });

  it('rejects a claim that overlaps the worker\'s existing shift', async () => {
    const shift = await createScheduledShift();
    await openShift(shift);

    // workerA already has a shift covering the same window
    await createScheduledShift({ workerId: workerA.id, status: 'SCHEDULED' });

    const res = await request(app)
      .post(`/shifts/${shift.id}/claim`)
      .set('Authorization', `Bearer ${tokenFor(workerA)}`)
      .send();

    expect(res.status).toBe(409);
  });
});
