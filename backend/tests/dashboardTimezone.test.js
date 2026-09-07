process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-access-secret';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test-refresh-secret';

const { PrismaClient } = require('@prisma/client');
const dashboardService = require('../src/services/dashboardService');

const prisma = new PrismaClient();
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

// A fixed reference instant: 02:00 UTC on 2025-07-15.
//  - Europe/London (BST, +1): 03:00 on the 15th        -> agency day 2025-07-15
//  - Pacific/Auckland (NZST, +12): 14:00 on the 15th    -> agency day 2025-07-15
const NOW = new Date('2025-07-15T02:00:00Z');

let agencyLondon;
let agencyAuckland;
let hrLondon;
let hrAuckland;
let houseLondon;
let houseAuckland;

async function mkShift(agencyId, houseId, createdById, startISO) {
  const start = new Date(startISO);
  const end = new Date(start.getTime() + 8 * 3600 * 1000);
  return prisma.shift.create({
    data: {
      agencyId, houseId, createdById,
      workerId: null,
      startTime: start, endTime: end, date: start,
      status: 'OPEN',
    },
  });
}

beforeAll(async () => {
  agencyLondon = await prisma.agency.create({ data: { name: `TZ London ${suffix}`, timezone: 'Europe/London' } });
  agencyAuckland = await prisma.agency.create({ data: { name: `TZ Auckland ${suffix}`, timezone: 'Pacific/Auckland' } });

  hrLondon = await prisma.user.create({
    data: { agencyId: agencyLondon.id, name: 'HR London', email: `tz-hr-l-${suffix}@shiftgo.test`, passwordHash: 'x', role: 'HR' },
  });
  hrAuckland = await prisma.user.create({
    data: { agencyId: agencyAuckland.id, name: 'HR Auckland', email: `tz-hr-a-${suffix}@shiftgo.test`, passwordHash: 'x', role: 'HR' },
  });

  houseLondon = await prisma.house.create({
    data: { agencyId: agencyLondon.id, name: `London House ${suffix}`, address: '1 St', latitude: 51.5, longitude: -0.12 },
  });
  houseAuckland = await prisma.house.create({
    data: { agencyId: agencyAuckland.id, name: `Auckland House ${suffix}`, address: '1 St', latitude: -36.8, longitude: 174.7 },
  });
});

afterAll(async () => {
  const ids = [agencyLondon.id, agencyAuckland.id];
  await prisma.shift.deleteMany({ where: { agencyId: { in: ids } } });
  await prisma.house.deleteMany({ where: { agencyId: { in: ids } } });
  await prisma.user.deleteMany({ where: { agencyId: { in: ids } } });
  await prisma.agency.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
});

describe('dashboard "today" respects the agency timezone', () => {
  test('Europe/London: a 23:30Z record on the 14th counts as "today" (15th, BST); a 22:30Z one does not', async () => {
    const inDay = await mkShift(agencyLondon.id, houseLondon.id, hrLondon.id, '2025-07-14T23:30:00Z'); // local 00:30 on 15th
    const prevDay = await mkShift(agencyLondon.id, houseLondon.id, hrLondon.id, '2025-07-14T22:30:00Z'); // local 23:30 on 14th

    const summary = await dashboardService.getTodaySummary(hrLondon, agencyLondon.id, NOW);

    expect(summary.timezone).toBe('Europe/London');
    const ids = summary.todayShifts.map((s) => s.id);
    expect(ids).toContain(inDay.id);
    expect(ids).not.toContain(prevDay.id);
    expect(summary.coverage.scheduled).toBe(1);
  });

  test('Pacific/Auckland: the agency-day boundary is 12 hours earlier in UTC', async () => {
    const inDay = await mkShift(agencyAuckland.id, houseAuckland.id, hrAuckland.id, '2025-07-14T12:30:00Z'); // local 00:30 on 15th
    const prevDay = await mkShift(agencyAuckland.id, houseAuckland.id, hrAuckland.id, '2025-07-14T11:00:00Z'); // local 23:00 on 14th

    const summary = await dashboardService.getTodaySummary(hrAuckland, agencyAuckland.id, NOW);

    expect(summary.timezone).toBe('Pacific/Auckland');
    const ids = summary.todayShifts.map((s) => s.id);
    expect(ids).toContain(inDay.id);
    expect(ids).not.toContain(prevDay.id);
    expect(summary.coverage.scheduled).toBe(1);
  });

  test('agency isolation holds across timezones — neither summary sees the other agency\'s shifts', async () => {
    const londonSummary = await dashboardService.getTodaySummary(hrLondon, agencyLondon.id, NOW);
    const aucklandSummary = await dashboardService.getTodaySummary(hrAuckland, agencyAuckland.id, NOW);

    const londonIds = new Set(londonSummary.todayShifts.map((s) => s.id));
    const aucklandIds = new Set(aucklandSummary.todayShifts.map((s) => s.id));

    for (const id of londonIds) expect(aucklandIds.has(id)).toBe(false);
    expect(londonSummary.coverage.scheduled).toBe(1);
    expect(aucklandSummary.coverage.scheduled).toBe(1);
  });

  test('an agency with no timezone configured falls back to the pilot default', async () => {
    // Force a NULL-ish value past the schema default to prove the resolver guard.
    const legacy = await prisma.agency.create({ data: { name: `TZ legacy ${suffix}`, timezone: '' } });
    const hr = await prisma.user.create({
      data: { agencyId: legacy.id, name: 'HR Legacy', email: `tz-hr-legacy-${suffix}@shiftgo.test`, passwordHash: 'x', role: 'HR' },
    });
    try {
      const summary = await dashboardService.getTodaySummary(hr, legacy.id, NOW);
      expect(summary.timezone).toBe('Europe/London');
    } finally {
      await prisma.user.deleteMany({ where: { agencyId: legacy.id } });
      await prisma.agency.delete({ where: { id: legacy.id } });
    }
  });
});
