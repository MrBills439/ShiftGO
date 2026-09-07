process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-access-secret';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test-refresh-secret';
process.env.RATE_LIMIT_DISABLED = 'true';

const request = require('supertest');
const { PrismaClient } = require('@prisma/client');
const app = require('../src/app');
const { signAccess } = require('../src/utils/jwt');
const { agencyDayRange } = require('../src/lib/agencyTime');

const prisma = new PrismaClient();
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const tokenFor = (u) => signAccess({ id: u.id, agencyId: u.agencyId, role: u.role, status: u.status, name: u.name, email: u.email });
const get = (u) => request(app).get('/dashboard/today').set('Authorization', `Bearer ${tokenFor(u)}`);
const hrs = (h) => new Date(Date.now() + h * 3600_000);
// Noon of the agency's current day (Europe/London default) — deterministically
// "today" regardless of the wall-clock hour the suite runs at.
const noonToday = () => new Date(agencyDayRange('Europe/London', new Date()).start.getTime() + 12 * 3600_000);

let agencyA;
let agencyB;
let hrA;
let managerA;
let tlA;
let houseA1;
let houseA2;
let houseB;

async function mkUser(agencyId, role, tag) {
  return prisma.user.create({ data: { agencyId, role, name: `OS ${tag}`, email: `os-${tag}-${suffix}@shiftgo.test`, passwordHash: 'x' } });
}
async function mkHouse(agencyId, tag, managerId = null) {
  return prisma.house.create({ data: { agencyId, name: `OS House ${tag} ${suffix}`, address: '1 St', latitude: 51.5, longitude: -0.12, managerId } });
}
async function mkOpenShift({ agencyId, houseId, start = hrs(3), status = 'OPEN', workerId = null, eligibleRoles = [] }) {
  return prisma.shift.create({
    data: {
      agencyId, houseId, workerId, createdById: hrA.id,
      startTime: start, endTime: new Date(start.getTime() + 8 * 3600_000), date: start,
      status, eligibleRoles,
    },
  });
}

beforeAll(async () => {
  agencyA = await prisma.agency.create({ data: { name: `OS A ${suffix}` } });
  agencyB = await prisma.agency.create({ data: { name: `OS B ${suffix}` } });
  hrA = await mkUser(agencyA.id, 'HR', 'hrA');
  managerA = await mkUser(agencyA.id, 'MANAGER', 'mgrA');
  tlA = await mkUser(agencyA.id, 'TEAM_LEADER', 'tlA');
  houseA1 = await mkHouse(agencyA.id, 'A1', managerA.id);
  houseA2 = await mkHouse(agencyA.id, 'A2');
  houseB = await mkHouse(agencyB.id, 'B');
  await prisma.houseTeamLeader.create({ data: { houseId: houseA2.id, teamLeaderId: tlA.id } });
});

afterEach(async () => {
  await prisma.shiftClaim.deleteMany({ where: { shift: { agencyId: { in: [agencyA.id, agencyB.id] } } } });
  await prisma.shift.deleteMany({ where: { agencyId: { in: [agencyA.id, agencyB.id] } } });
});

afterAll(async () => {
  await prisma.houseTeamLeader.deleteMany({ where: { teamLeaderId: tlA.id } });
  await prisma.house.deleteMany({ where: { agencyId: { in: [agencyA.id, agencyB.id] } } });
  await prisma.user.deleteMany({ where: { agencyId: { in: [agencyA.id, agencyB.id] } } });
  await prisma.agency.deleteMany({ where: { id: { in: [agencyA.id, agencyB.id] } } });
  await prisma.$disconnect();
});

describe('HR dashboard — open / cover shifts', () => {
  test('HR sees every OPEN shift in the agency; assigned and cancelled shifts are excluded', async () => {
    const s1 = await mkOpenShift({ agencyId: agencyA.id, houseId: houseA1.id, start: noonToday() });
    const s2 = await mkOpenShift({ agencyId: agencyA.id, houseId: houseA2.id, start: hrs(5 * 24) });
    await mkOpenShift({ agencyId: agencyA.id, houseId: houseA1.id, start: hrs(6), status: 'CANCELLED' });
    await mkOpenShift({ agencyId: agencyA.id, houseId: houseA1.id, start: hrs(7), status: 'SCHEDULED', workerId: managerA.id });

    const res = await get(hrA);
    expect(res.status).toBe(200);
    const ids = res.body.data.openShifts.map((s) => s.id);
    expect(ids).toEqual(expect.arrayContaining([s1.id, s2.id]));
    expect(res.body.data.openShifts).toHaveLength(2);
    const one = res.body.data.openShifts.find((s) => s.id === s1.id);
    expect(one).toMatchObject({ status: 'OPEN', claimCount: 0 });
    expect(one.house).toMatchObject({ id: houseA1.id });
    expect(Array.isArray(one.eligibleRoles)).toBe(true);
    expect(typeof one.href).toBe('string');
    expect(res.body.data.openShiftsToday).toBeGreaterThanOrEqual(1);
  });

  test('a manager only sees open shifts in the houses they manage', async () => {
    await mkOpenShift({ agencyId: agencyA.id, houseId: houseA1.id, start: hrs(3) });
    await mkOpenShift({ agencyId: agencyA.id, houseId: houseA2.id, start: hrs(4) });

    const res = await get(managerA);
    const houseIds = res.body.data.openShifts.map((s) => s.house?.id);
    expect(houseIds).toContain(houseA1.id);
    expect(houseIds).not.toContain(houseA2.id);
  });

  test('a team leader only sees open shifts in their assigned house', async () => {
    await mkOpenShift({ agencyId: agencyA.id, houseId: houseA1.id, start: hrs(3) });
    await mkOpenShift({ agencyId: agencyA.id, houseId: houseA2.id, start: hrs(4) });

    const res = await get(tlA);
    const houseIds = res.body.data.openShifts.map((s) => s.house?.id);
    expect(houseIds).toEqual([houseA2.id]);
  });

  test('claim count is reflected and another agency\'s open shifts never appear', async () => {
    const s = await mkOpenShift({ agencyId: agencyA.id, houseId: houseA1.id, start: hrs(3), eligibleRoles: ['WORKER'] });
    await prisma.shiftClaim.create({ data: { shiftId: s.id, workerId: managerA.id } });
    await mkOpenShift({ agencyId: agencyB.id, houseId: houseB.id, start: hrs(3) });

    const res = await get(hrA);
    const mine = res.body.data.openShifts.find((x) => x.id === s.id);
    expect(mine.claimCount).toBe(1);
    // nothing from agency B
    expect(res.body.data.openShifts.every((x) => x.house?.id !== houseB.id)).toBe(true);
  });
});
