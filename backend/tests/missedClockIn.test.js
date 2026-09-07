process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-access-secret';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test-refresh-secret';

const { PrismaClient } = require('@prisma/client');
const { missedClockInJob } = require('../src/jobs/missedClockInJob');

const prisma = new PrismaClient();
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

let agencyA;
let agencyB;
let hrA;
let workerA1;
let workerA2;
let houseA;
let hrB;
let workerB;
let houseB;

// A shift that started 8 minutes ago is inside the job's 5–15 minute window.
function startedMinsAgo(mins) {
  return new Date(Date.now() - mins * 60 * 1000);
}

async function mkUser(agencyId, role, tag) {
  return prisma.user.create({
    data: {
      agencyId,
      name: tag,
      email: `${tag}-${suffix}@shiftgo.test`.toLowerCase(),
      passwordHash: 'x',
      role,
    },
  });
}

async function mkShift({ agencyId, houseId, workerId = null, createdById, status = 'SCHEDULED', start = startedMinsAgo(8) }) {
  return prisma.shift.create({
    data: {
      agencyId,
      houseId,
      workerId,
      createdById,
      startTime: start,
      endTime: new Date(start.getTime() + 8 * 60 * 60 * 1000),
      date: start,
      status,
    },
  });
}

function missedNotifs(where) {
  return prisma.notification.findMany({ where: { type: 'MISSED_CLOCK_IN', ...where } });
}

beforeAll(async () => {
  agencyA = await prisma.agency.create({ data: { name: `MCI A ${suffix}` } });
  agencyB = await prisma.agency.create({ data: { name: `MCI B ${suffix}` } });
  hrA = await mkUser(agencyA.id, 'HR', 'mci-hrA');
  workerA1 = await mkUser(agencyA.id, 'WORKER', 'mci-wA1');
  workerA2 = await mkUser(agencyA.id, 'WORKER', 'mci-wA2');
  hrB = await mkUser(agencyB.id, 'HR', 'mci-hrB');
  workerB = await mkUser(agencyB.id, 'WORKER', 'mci-wB');
  houseA = await prisma.house.create({
    data: { agencyId: agencyA.id, name: `MCI House A ${suffix}`, address: '1 A', latitude: 51.5, longitude: -0.1 },
  });
  houseB = await prisma.house.create({
    data: { agencyId: agencyB.id, name: `MCI House B ${suffix}`, address: '1 B', latitude: 52, longitude: -1 },
  });
});

afterEach(async () => {
  const ids = [agencyA.id, agencyB.id];
  await prisma.notification.deleteMany({ where: { agencyId: { in: ids } } });
  await prisma.clockEvent.deleteMany({ where: { agencyId: { in: ids } } });
  await prisma.shift.deleteMany({ where: { agencyId: { in: ids } } });
});

afterAll(async () => {
  await prisma.house.deleteMany({ where: { agencyId: { in: [agencyA.id, agencyB.id] } } });
  await prisma.user.deleteMany({ where: { agencyId: { in: [agencyA.id, agencyB.id] } } });
  await prisma.agency.deleteMany({ where: { id: { in: [agencyA.id, agencyB.id] } } });
  await prisma.$disconnect();
});

describe('missedClockInJob', () => {
  test('first run creates exactly one MISSED_CLOCK_IN notification for the right worker/shift', async () => {
    const shift = await mkShift({ agencyId: agencyA.id, houseId: houseA.id, workerId: workerA1.id, createdById: hrA.id });

    await missedClockInJob();

    const notifs = await missedNotifs({ agencyId: agencyA.id });
    expect(notifs).toHaveLength(1);
    const n = notifs[0];
    expect(n.userId).toBe(workerA1.id);
    expect(n.agencyId).toBe(agencyA.id);
    expect(n.data).toMatchObject({ shiftId: shift.id });
    expect(n.title).toMatch(/missed clock-in/i);
    expect(n.body).toContain(houseA.name);
  });

  test('repeated runs do not create a second notification for the same shift', async () => {
    await mkShift({ agencyId: agencyA.id, houseId: houseA.id, workerId: workerA1.id, createdById: hrA.id });

    await missedClockInJob();
    await missedClockInJob();
    await missedClockInJob();

    const notifs = await missedNotifs({ agencyId: agencyA.id });
    expect(notifs).toHaveLength(1);
  });

  test('cancelled shifts do not alert', async () => {
    await mkShift({ agencyId: agencyA.id, houseId: houseA.id, workerId: workerA1.id, createdById: hrA.id, status: 'CANCELLED' });
    await missedClockInJob();
    expect(await missedNotifs({ agencyId: agencyA.id })).toHaveLength(0);
  });

  test('unassigned (open) shifts do not alert', async () => {
    await mkShift({ agencyId: agencyA.id, houseId: houseA.id, workerId: null, createdById: hrA.id, status: 'OPEN' });
    await missedClockInJob();
    expect(await missedNotifs({ agencyId: agencyA.id })).toHaveLength(0);
  });

  test('a shift that has already been clocked into does not alert', async () => {
    const shift = await mkShift({ agencyId: agencyA.id, houseId: houseA.id, workerId: workerA1.id, createdById: hrA.id });
    await prisma.clockEvent.create({
      data: { agencyId: agencyA.id, workerId: workerA1.id, houseId: houseA.id, shiftId: shift.id, type: 'IN', method: 'MANUAL' },
    });
    await missedClockInJob();
    expect(await missedNotifs({ agencyId: agencyA.id })).toHaveLength(0);
  });

  test('each missed shift for a worker gets its own single alert', async () => {
    const s1 = await mkShift({ agencyId: agencyA.id, houseId: houseA.id, workerId: workerA1.id, createdById: hrA.id, start: startedMinsAgo(7) });
    const s2 = await mkShift({ agencyId: agencyA.id, houseId: houseA.id, workerId: workerA2.id, createdById: hrA.id, start: startedMinsAgo(9) });

    await missedClockInJob();
    await missedClockInJob();

    const notifs = await missedNotifs({ agencyId: agencyA.id });
    expect(notifs).toHaveLength(2);
    expect(notifs.map((n) => n.data.shiftId).sort()).toEqual([s1.id, s2.id].sort());
  });

  test('agency isolation: agency B alerts land on agency B only', async () => {
    await mkShift({ agencyId: agencyA.id, houseId: houseA.id, workerId: workerA1.id, createdById: hrA.id });
    await mkShift({ agencyId: agencyB.id, houseId: houseB.id, workerId: workerB.id, createdById: hrB.id });

    await missedClockInJob();

    const a = await missedNotifs({ agencyId: agencyA.id });
    const b = await missedNotifs({ agencyId: agencyB.id });
    expect(a).toHaveLength(1);
    expect(a[0].userId).toBe(workerA1.id);
    expect(b).toHaveLength(1);
    expect(b[0].userId).toBe(workerB.id);
    expect(b[0].agencyId).toBe(agencyB.id);
  });
});
