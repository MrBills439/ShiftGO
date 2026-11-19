/**
 * Agency-timezone wall time <-> UTC rules around UK daylight-saving changes,
 * for times the server turns into shifts itself (fixed work patterns).
 * Mirrors web/lib/shiftTime.test.ts, which covers the shift forms.
 */
process.env.NODE_ENV = 'test';
process.env.RATE_LIMIT_DISABLED = 'true';

const { PrismaClient } = require('@prisma/client');
const { resolveWallTime, ymdInZone } = require('../src/lib/agencyTime');
const { generateFixedWorkPatternShifts, RESULT } = require('../src/services/fixedWorkPatternGenerationService');

const LON = 'Europe/London';
const iso = (r) => (r.status === 'ok' ? r.instant.toISOString() : r);

describe('resolveWallTime (Europe/London)', () => {
  test('winter: wall time equals UTC', () => {
    expect(iso(resolveWallTime(LON, 2026, 11, 19, 9, 0))).toBe('2026-11-19T09:00:00.000Z');
  });
  test('summer: 09:00 BST is 08:00 UTC', () => {
    expect(iso(resolveWallTime(LON, 2026, 7, 1, 9, 0))).toBe('2026-07-01T08:00:00.000Z');
  });
  test('spring forward: 01:30 on 29 Mar 2026 does not exist', () => {
    expect(resolveWallTime(LON, 2026, 3, 29, 1, 30)).toEqual({ status: 'nonexistent' });
    expect(iso(resolveWallTime(LON, 2026, 3, 29, 0, 30))).toBe('2026-03-29T00:30:00.000Z');
    expect(iso(resolveWallTime(LON, 2026, 3, 29, 2, 0))).toBe('2026-03-29T01:00:00.000Z');
  });
  test('fall back: 01:30 on 25 Oct 2026 happens twice', () => {
    const r = resolveWallTime(LON, 2026, 10, 25, 1, 30);
    expect(r.status).toBe('ambiguous');
    expect(r.earlier.toISOString()).toBe('2026-10-25T00:30:00.000Z'); // BST
    expect(r.later.toISOString()).toBe('2026-10-25T01:30:00.000Z');   // GMT
  });
});

describe('fixed work pattern generation across daylight-saving changes', () => {
  const prisma = new PrismaClient();
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  let agency; let hr; let worker; let location;

  // Last Sunday of a month in the NEXT year (generation never looks back).
  const lastSunday = (year, month) => {
    const d = new Date(Date.UTC(year, month, 0));
    while (d.getUTCDay() !== 0) d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
  };
  const year = new Date().getUTCFullYear() + 1;
  const springSunday = lastSunday(year, 3);
  const autumnSunday = lastSunday(year, 10);
  const todayStr = (() => { const t = ymdInZone(LON, new Date()); return `${t.year}-${String(t.month).padStart(2, '0')}-${String(t.day).padStart(2, '0')}`; })();
  const horizonTo = (d) => Math.round((Date.parse(`${d}T00:00:00Z`) - Date.parse(`${todayStr}T00:00:00Z`)) / 86_400_000) + 1;

  beforeAll(async () => {
    agency = await prisma.agency.create({ data: { name: `DST ${suffix}`, timezone: LON } });
    hr = await prisma.user.create({ data: { agencyId: agency.id, role: 'HR', name: 'DST HR', email: `dst-hr-${suffix}@shiftgo.test`, passwordHash: 'x' } });
    worker = await prisma.user.create({ data: { agencyId: agency.id, role: 'WORKER', name: 'DST W', email: `dst-w-${suffix}@shiftgo.test`, passwordHash: 'x' } });
    location = await prisma.location.create({ data: { agencyId: agency.id, name: `DST Office ${suffix}`, type: 'OFFICE' } });
  });

  afterAll(async () => {
    await prisma.shift.deleteMany({ where: { agencyId: agency.id } });
    await prisma.fixedWorkPatternDay.deleteMany({ where: { pattern: { agencyId: agency.id } } });
    await prisma.fixedWorkPattern.deleteMany({ where: { agencyId: agency.id } });
    await prisma.location.deleteMany({ where: { agencyId: agency.id } });
    await prisma.user.deleteMany({ where: { agencyId: agency.id } });
    await prisma.agency.deleteMany({ where: { id: agency.id } });
    await prisma.$disconnect();
  });

  const sundayPattern = (startTime, endTime) => prisma.fixedWorkPattern.create({
    data: {
      agencyId: agency.id, workerId: worker.id, locationId: location.id, createdById: hr.id, status: 'ACTIVE',
      effectiveFrom: new Date('2000-01-01T00:00:00.000Z'),
      days: { create: [{ weekday: 7, startTime, endTime }] },
    },
  });

  test('a start time skipped by the clocks going forward is reported, not guessed', async () => {
    const p = await sundayPattern('01:30', '05:00');
    const r = await generateFixedWorkPatternShifts({ agencyId: agency.id, patternId: p.id, fromDate: springSunday, horizonDays: horizonTo(springSunday) });
    const occ = r.occurrences.find((o) => o.date === springSunday);
    expect(occ.status).toBe(RESULT.SKIPPED_NONEXISTENT_TIME);
    expect(r.skippedNonexistentTime).toBe(1);
    expect(await prisma.shift.count({ where: { fixedWorkPatternId: p.id } })).toBe(0);
  });

  test('a start time repeated by the clocks going back uses the first (BST) occurrence', async () => {
    const p = await sundayPattern('01:30', '05:00');
    await generateFixedWorkPatternShifts({ agencyId: agency.id, patternId: p.id, fromDate: autumnSunday, horizonDays: horizonTo(autumnSunday) });
    const shift = await prisma.shift.findFirst({ where: { fixedWorkPatternId: p.id } });
    const expected = resolveWallTime(LON, ...autumnSunday.split('-').map(Number), 1, 30);
    expect(expected.status).toBe('ambiguous');
    expect(shift.startTime.toISOString()).toBe(expected.earlier.toISOString());
    // 05:00 GMT on the same day: 4.5 real hours after 01:30 BST.
    expect((shift.endTime - shift.startTime) / 3_600_000).toBe(4.5);
  });
});

describe('Schedule week uses agency days, not UTC days', () => {
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-access-secret';
  process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test-refresh-secret';
  const request = require('supertest');
  const app = require('../src/app');
  const { signAccess } = require('../src/utils/jwt');
  const prisma = new PrismaClient();
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  let agency; let hr; let house;

  beforeAll(async () => {
    agency = await prisma.agency.create({ data: { name: `Week ${suffix}`, timezone: LON } });
    hr = await prisma.user.create({ data: { agencyId: agency.id, role: 'HR', name: 'Week HR', email: `week-hr-${suffix}@shiftgo.test`, passwordHash: 'x' } });
    house = await prisma.house.create({ data: { agencyId: agency.id, name: `Week House ${suffix}`, address: 'x', latitude: 51, longitude: 0 } });
  });
  afterAll(async () => {
    await prisma.shift.deleteMany({ where: { agencyId: agency.id } });
    await prisma.house.deleteMany({ where: { agencyId: agency.id } });
    await prisma.user.deleteMany({ where: { agencyId: agency.id } });
    await prisma.agency.deleteMany({ where: { id: agency.id } });
    await prisma.$disconnect();
  });

  test('a shift at 00:30 BST on Monday (23:30 UTC Sunday) is in that Monday\'s week', async () => {
    const mk = (startIso, endIso) => prisma.shift.create({ data: {
      agencyId: agency.id, houseId: house.id, createdById: hr.id, status: 'OPEN',
      startTime: new Date(startIso), endTime: new Date(endIso), date: new Date(startIso),
    } });
    const mondayEarly = await mk('2026-07-05T23:30:00Z', '2026-07-06T07:30:00Z'); // Mon 6 Jul 00:30 BST
    const sundayLate = await mk('2026-07-12T23:30:00Z', '2026-07-13T07:30:00Z');  // Mon 13 Jul 00:30 BST: next week
    const token = signAccess({ id: hr.id, agencyId: agency.id, role: 'HR', status: 'ACTIVE', name: hr.name, email: hr.email });
    const res = await request(app).get('/rota/week').query({ startDate: '2026-07-06' }).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const ids = res.body.data.map((s) => s.shiftId);
    expect(ids).toContain(mondayEarly.id);
    expect(ids).not.toContain(sundayLate.id);
  });
});

describe('server-written times use the agency timezone (server runs in UTC)', () => {
  const { shiftStartLabel, formatInZone } = require('../src/lib/agencyZone');
  test('a 09:00 BST shift reads 09:00 in notifications, not 08:00', () => {
    expect(shiftStartLabel('2026-07-01T08:00:00Z', LON)).toMatch(/09:00/);
    expect(shiftStartLabel('2026-11-19T09:00:00Z', LON)).toMatch(/09:00/);
    expect(formatInZone('2026-07-01T16:00:00Z', LON, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })).toBe('17:00');
  });
});
