process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-access-secret';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test-refresh-secret';
process.env.RATE_LIMIT_DISABLED = 'true';

const { PrismaClient } = require('@prisma/client');
const prisma = require('../src/lib/prisma');
const testPrisma = new PrismaClient(); // cleanup-only client, matches other test files' convention
const { generateFixedWorkPatternShifts, RESULT } = require('../src/services/fixedWorkPatternGenerationService');
const { ymdInZone, zonedWallTimeToUtc } = require('../src/lib/agencyTime');

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

const MON_FRI_9_5 = [1, 2, 3, 4, 5].map((weekday) => ({ weekday, startTime: '09:00', endTime: '17:00' }));
const ALL_WEEK_9_5 = [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, startTime: '09:00', endTime: '17:00' }));

function ymdStr({ year, month, day }) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
function addDaysStr(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return ymdStr({ year: dt.getUTCFullYear(), month: dt.getUTCMonth() + 1, day: dt.getUTCDate() });
}
function isoWeekday(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const jsDay = new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay();
  return jsDay === 0 ? 7 : jsDay;
}
// horizonDays is always measured from TODAY (never from `fromDate`) — when a
// test's window starts well into the future, the horizon must be widened to
// actually reach it. `padDays` keeps the window tight past the target so a
// single-weekday pattern still yields exactly one occurrence.
function horizonDaysTo(fromStr, dateStr, padDays = 6) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [ty, tm, td] = fromStr.split('-').map(Number);
  const days = Math.round((Date.UTC(y, m - 1, d) - Date.UTC(ty, tm - 1, td)) / 86_400_000);
  return days + padDays;
}

describe('Recurring Fixed Work Patterns V1 — Phase 2 generation service', () => {
  let agency, hr, workerA, workerDeactivated, locationA, house;
  let todayStr;

  const makeUser = (agencyId, role, name, status = 'ACTIVE') =>
    testPrisma.user.create({
      data: { agencyId, name, email: `${name.toLowerCase().replace(/\s+/g, '-')}-${suffix}@shiftgo.test`, passwordHash: 'x', role, status },
    });

  const makeLocation = (agencyId, name, timezone = null, active = true) =>
    testPrisma.location.create({ data: { agencyId, name: `${name} ${suffix}`, type: 'OFFICE', timezone, active } });

  const makePattern = (overrides = {}) =>
    testPrisma.fixedWorkPattern.create({
      data: {
        agencyId: agency.id,
        workerId: workerA.id,
        locationId: locationA.id,
        effectiveFrom: new Date('2000-01-01T00:00:00.000Z'),
        createdById: hr.id,
        status: 'ACTIVE',
        days: { create: MON_FRI_9_5 },
        ...overrides,
      },
      include: { days: true },
    });

  beforeAll(async () => {
    agency = await testPrisma.agency.create({ data: { name: `FWP Gen Agency ${suffix}`, timezone: 'Europe/London' } });
    hr = await makeUser(agency.id, 'HR', 'Gen HR');
    workerA = await makeUser(agency.id, 'WORKER', 'Gen Worker A');
    workerDeactivated = await makeUser(agency.id, 'WORKER', 'Gen Worker Deactivated', 'DEACTIVATED');
    locationA = await makeLocation(agency.id, 'Gen Head Office');
    house = await testPrisma.house.create({
      data: { agencyId: agency.id, name: `Gen House ${suffix}`, address: '1 Test St', latitude: 51.5, longitude: -0.1 },
    });
    todayStr = ymdStr(ymdInZone('Europe/London', new Date()));
  });

  afterAll(async () => {
    await testPrisma.shift.deleteMany({ where: { agencyId: agency.id } });
    await testPrisma.fixedWorkPatternDay.deleteMany({ where: { pattern: { agencyId: agency.id } } });
    await testPrisma.fixedWorkPattern.deleteMany({ where: { agencyId: agency.id } });
    await testPrisma.house.deleteMany({ where: { agencyId: agency.id } });
    await testPrisma.location.deleteMany({ where: { agencyId: agency.id } });
    await testPrisma.user.deleteMany({ where: { agencyId: agency.id } });
    await testPrisma.agency.deleteMany({ where: { id: agency.id } });
    await testPrisma.$disconnect();
  });

  it('1-5. an ACTIVE pattern generates FIXED shifts with the right worker/location/houseId/provenance', async () => {
    const pattern = await makePattern();
    const result = await generateFixedWorkPatternShifts({ agencyId: agency.id, patternId: pattern.id });
    expect(result.generated).toBeGreaterThan(0);

    const shifts = await testPrisma.shift.findMany({ where: { fixedWorkPatternId: pattern.id } });
    expect(shifts.length).toBe(result.generated);
    for (const s of shifts) {
      expect(s.workerId).toBe(workerA.id); // 2
      expect(s.locationId).toBe(pattern.locationId); // 3
      expect(s.houseId).toBeNull(); // 4
      expect(s.fixedWorkPatternId).toBe(pattern.id); // 5
      expect(s.kind).toBe('FIXED'); // 26
    }
  });

  it('6. only configured weekdays are generated', async () => {
    const w = await makeUser(agency.id, 'WORKER', 'Gen OnlyMonday');
    const pattern = await makePattern({ workerId: w.id, days: { create: [{ weekday: 1, startTime: '09:00', endTime: '17:00' }] } });
    const result = await generateFixedWorkPatternShifts({ agencyId: agency.id, patternId: pattern.id, horizonDays: 13 });
    expect(result.generated).toBeGreaterThan(0);
    const shifts = await testPrisma.shift.findMany({ where: { fixedWorkPatternId: pattern.id } });
    for (const s of shifts) {
      expect(isoWeekday(ymdStr({ year: s.date.getUTCFullYear(), month: s.date.getUTCMonth() + 1, day: s.date.getUTCDate() }))).toBe(1);
    }
  });

  it('7. different weekday hours are honoured', async () => {
    const w = await makeUser(agency.id, 'WORKER', 'Gen DiffHours');
    const pattern = await makePattern({
      workerId: w.id,
      days: { create: [{ weekday: 1, startTime: '09:00', endTime: '17:00' }, { weekday: 2, startTime: '08:00', endTime: '12:00' }] },
    });
    await generateFixedWorkPatternShifts({ agencyId: agency.id, patternId: pattern.id, horizonDays: 10 });
    const shifts = await testPrisma.shift.findMany({ where: { fixedWorkPatternId: pattern.id }, orderBy: { startTime: 'asc' } });
    const mondayShift = shifts.find((s) => isoWeekday(ymdStr({ year: s.date.getUTCFullYear(), month: s.date.getUTCMonth() + 1, day: s.date.getUTCDate() })) === 1);
    const tuesdayShift = shifts.find((s) => isoWeekday(ymdStr({ year: s.date.getUTCFullYear(), month: s.date.getUTCMonth() + 1, day: s.date.getUTCDate() })) === 2);
    expect((mondayShift.endTime - mondayShift.startTime) / 3_600_000).toBe(8);
    expect((tuesdayShift.endTime - tuesdayShift.startTime) / 3_600_000).toBe(4);
  });

  it('8. effectiveFrom is respected — nothing generated before it', async () => {
    const w = await makeUser(agency.id, 'WORKER', 'Gen EffFrom');
    const futureFrom = addDaysStr(todayStr, 10);
    const pattern = await makePattern({ workerId: w.id, effectiveFrom: new Date(`${futureFrom}T00:00:00.000Z`) });
    const result = await generateFixedWorkPatternShifts({ agencyId: agency.id, patternId: pattern.id, horizonDays: 20 });
    expect(result.generated).toBeGreaterThan(0);
    const shifts = await testPrisma.shift.findMany({ where: { fixedWorkPatternId: pattern.id } });
    for (const s of shifts) expect(s.date.getTime()).toBeGreaterThanOrEqual(new Date(`${futureFrom}T00:00:00.000Z`).getTime());
  });

  it('9. effectiveTo is respected — nothing generated after it', async () => {
    const w = await makeUser(agency.id, 'WORKER', 'Gen EffTo');
    const to = addDaysStr(todayStr, 5);
    const pattern = await makePattern({ workerId: w.id, effectiveTo: new Date(`${to}T00:00:00.000Z`) });
    const result = await generateFixedWorkPatternShifts({ agencyId: agency.id, patternId: pattern.id, horizonDays: 28 });
    expect(result.generated).toBeGreaterThan(0);
    const shifts = await testPrisma.shift.findMany({ where: { fixedWorkPatternId: pattern.id } });
    for (const s of shifts) expect(s.date.getTime()).toBeLessThanOrEqual(new Date(`${to}T00:00:00.000Z`).getTime());
  });

  it('10. past dates are never backfilled — generation starts no earlier than today', async () => {
    const w = await makeUser(agency.id, 'WORKER', 'Gen NoBackfill');
    const pattern = await makePattern({ workerId: w.id, effectiveFrom: new Date('2000-01-01T00:00:00.000Z') });
    const result = await generateFixedWorkPatternShifts({ agencyId: agency.id, patternId: pattern.id });
    expect(result.generated).toBeGreaterThan(0);
    const shifts = await testPrisma.shift.findMany({ where: { fixedWorkPatternId: pattern.id } });
    for (const s of shifts) expect(s.date.getTime()).toBeGreaterThanOrEqual(new Date(`${todayStr}T00:00:00.000Z`).getTime());
  });

  it('11. the horizon (default 28 days, or a custom value) is respected', async () => {
    const w = await makeUser(agency.id, 'WORKER', 'Gen Horizon');
    const pattern = await makePattern({ workerId: w.id, days: { create: ALL_WEEK_9_5.map((d) => ({ ...d })) } });
    const result = await generateFixedWorkPatternShifts({ agencyId: agency.id, patternId: pattern.id, horizonDays: 5 });
    expect(result.generated).toBeGreaterThan(0);
    const maxDate = addDaysStr(todayStr, 5);
    const shifts = await testPrisma.shift.findMany({ where: { fixedWorkPatternId: pattern.id } });
    for (const s of shifts) expect(s.date.getTime()).toBeLessThanOrEqual(new Date(`${maxDate}T00:00:00.000Z`).getTime());
  });

  it('12. an ENDED pattern is ignored', async () => {
    const w = await makeUser(agency.id, 'WORKER', 'Gen Ended');
    const pattern = await makePattern({ workerId: w.id, status: 'ENDED', effectiveTo: new Date(`${todayStr}T00:00:00.000Z`) });
    const result = await generateFixedWorkPatternShifts({ agencyId: agency.id, patternId: pattern.id });
    expect(result.patternsProcessed).toBe(0);
    const shifts = await testPrisma.shift.findMany({ where: { fixedWorkPatternId: pattern.id } });
    expect(shifts.length).toBe(0);
  });

  it('13. a SUPERSEDED pattern is ignored', async () => {
    const w = await makeUser(agency.id, 'WORKER', 'Gen Superseded');
    const pattern = await makePattern({ workerId: w.id, status: 'SUPERSEDED', effectiveTo: new Date(`${todayStr}T00:00:00.000Z`) });
    const result = await generateFixedWorkPatternShifts({ agencyId: agency.id, patternId: pattern.id });
    expect(result.patternsProcessed).toBe(0);
  });

  it('14. a DEACTIVATED worker is ignored', async () => {
    const pattern = await makePattern({ workerId: workerDeactivated.id });
    const result = await generateFixedWorkPatternShifts({ agencyId: agency.id, patternId: pattern.id });
    expect(result.patternsProcessed).toBe(1);
    expect(result.skippedInactiveWorker).toBe(1);
    const shifts = await testPrisma.shift.findMany({ where: { fixedWorkPatternId: pattern.id } });
    expect(shifts.length).toBe(0);
  });

  it('15. pattern.timezone is used when set (overrides Location/Agency)', async () => {
    const w = await makeUser(agency.id, 'WORKER', 'Gen TzPattern');
    const locNoTz = await makeLocation(agency.id, 'Gen Loc NoTz'); // no timezone — would fall back to Agency (Europe/London) if pattern.timezone were ignored
    const janMonday = (() => {
      // first Monday in January of next year — well clear of any DST transition, single fixed EST offset (-5)
      const year = new Date().getUTCFullYear() + 1;
      let d = new Date(Date.UTC(year, 0, 1));
      while (d.getUTCDay() !== 1) d = new Date(d.getTime() + 86400000);
      return ymdStr({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() });
    })();
    const pattern = await testPrisma.fixedWorkPattern.create({
      data: {
        agencyId: agency.id, workerId: w.id, locationId: locNoTz.id, timezone: 'America/New_York',
        effectiveFrom: new Date(`${janMonday}T00:00:00.000Z`), createdById: hr.id, status: 'ACTIVE',
        days: { create: [{ weekday: 1, startTime: '09:00', endTime: '17:00' }] },
      },
    });
    const result = await generateFixedWorkPatternShifts({ agencyId: agency.id, patternId: pattern.id, fromDate: janMonday, horizonDays: horizonDaysTo(todayStr, janMonday) });
    expect(result.generated).toBe(1);
    const [shift] = await testPrisma.shift.findMany({ where: { fixedWorkPatternId: pattern.id } });
    expect(shift.startTime.getUTCHours()).toBe(14); // 09:00 EST (UTC-5) -> 14:00 UTC
  });

  it('16. Location.timezone is used when pattern.timezone is unset', async () => {
    const w = await makeUser(agency.id, 'WORKER', 'Gen TzLocation');
    const locUS = await makeLocation(agency.id, 'Gen Loc US', 'America/New_York');
    const janMonday = (() => {
      const year = new Date().getUTCFullYear() + 1;
      let d = new Date(Date.UTC(year, 0, 1));
      while (d.getUTCDay() !== 1) d = new Date(d.getTime() + 86400000);
      return ymdStr({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() });
    })();
    const pattern = await testPrisma.fixedWorkPattern.create({
      data: {
        agencyId: agency.id, workerId: w.id, locationId: locUS.id, timezone: null,
        effectiveFrom: new Date(`${janMonday}T00:00:00.000Z`), createdById: hr.id, status: 'ACTIVE',
        days: { create: [{ weekday: 1, startTime: '09:00', endTime: '17:00' }] },
      },
    });
    const result = await generateFixedWorkPatternShifts({ agencyId: agency.id, patternId: pattern.id, fromDate: janMonday, horizonDays: horizonDaysTo(todayStr, janMonday) });
    expect(result.generated).toBe(1);
    const [shift] = await testPrisma.shift.findMany({ where: { fixedWorkPatternId: pattern.id } });
    expect(shift.startTime.getUTCHours()).toBe(14); // Location's America/New_York, EST -5
  });

  it('17. Agency.timezone is used when neither pattern nor Location set one', async () => {
    const w = await makeUser(agency.id, 'WORKER', 'Gen TzAgency');
    const locNoTz = await makeLocation(agency.id, 'Gen Loc NoTz Agency');
    const janMonday = (() => {
      const year = new Date().getUTCFullYear() + 1;
      let d = new Date(Date.UTC(year, 0, 1));
      while (d.getUTCDay() !== 1) d = new Date(d.getTime() + 86400000);
      return ymdStr({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() });
    })();
    const pattern = await testPrisma.fixedWorkPattern.create({
      data: {
        agencyId: agency.id, workerId: w.id, locationId: locNoTz.id, timezone: null,
        effectiveFrom: new Date(`${janMonday}T00:00:00.000Z`), createdById: hr.id, status: 'ACTIVE',
        days: { create: [{ weekday: 1, startTime: '09:00', endTime: '17:00' }] },
      },
    });
    const result = await generateFixedWorkPatternShifts({ agencyId: agency.id, patternId: pattern.id, fromDate: janMonday, horizonDays: horizonDaysTo(todayStr, janMonday) });
    expect(result.generated).toBe(1);
    const [shift] = await testPrisma.shift.findMany({ where: { fixedWorkPatternId: pattern.id } });
    expect(shift.startTime.getUTCHours()).toBe(9); // Agency's Europe/London, GMT in January = UTC+0
  });

  it('18. DST transitions are handled correctly, per occurrence', async () => {
    const w = await makeUser(agency.id, 'WORKER', 'Gen DST');
    const locUS = await makeLocation(agency.id, 'Gen Loc DST');

    // Find the next US DST transition from today (pure in-process date-math,
    // no DB calls — cheap) rather than a huge blind window, so this test hits
    // a real transition with a small, fast occurrence count. Transitions are
    // never more than ~189 days apart, so 200 days of daily scanning always
    // finds one.
    const [ty, tm, td] = todayStr.split('-').map(Number);
    let prevOffset = zonedWallTimeToUtc('America/New_York', ty, tm, td, 9, 0).getUTCHours();
    let cursor = todayStr;
    let transitionDate = null;
    for (let i = 0; i < 200 && !transitionDate; i++) {
      cursor = addDaysStr(cursor, 1);
      const [y, m, d] = cursor.split('-').map(Number);
      const offset = zonedWallTimeToUtc('America/New_York', y, m, d, 9, 0).getUTCHours();
      if (offset !== prevOffset) transitionDate = cursor;
      prevOffset = offset;
    }
    expect(transitionDate).not.toBeNull();

    const from = addDaysStr(transitionDate, -4);
    const pattern = await testPrisma.fixedWorkPattern.create({
      data: {
        agencyId: agency.id, workerId: w.id, locationId: locUS.id, timezone: 'America/New_York',
        effectiveFrom: new Date('2000-01-01T00:00:00.000Z'), createdById: hr.id, status: 'ACTIVE',
        days: { create: ALL_WEEK_9_5 },
      },
    });
    const result = await generateFixedWorkPatternShifts({
      agencyId: agency.id, patternId: pattern.id, fromDate: from, horizonDays: horizonDaysTo(todayStr, addDaysStr(transitionDate, 4), 0),
    });
    expect(result.generated).toBeGreaterThanOrEqual(8); // ~9 days, every weekday configured
    const shifts = await testPrisma.shift.findMany({ where: { fixedWorkPatternId: pattern.id }, orderBy: { date: 'asc' } });

    let sawTransition = false;
    for (const s of shifts) {
      const { year, month, day } = { year: s.date.getUTCFullYear(), month: s.date.getUTCMonth() + 1, day: s.date.getUTCDate() };
      const expected = zonedWallTimeToUtc('America/New_York', year, month, day, 9, 0);
      expect(s.startTime.getTime()).toBe(expected.getTime()); // every single occurrence individually correct
    }
    for (let i = 1; i < shifts.length; i++) {
      if (shifts[i].startTime.getUTCHours() !== shifts[i - 1].startTime.getUTCHours()) sawTransition = true;
    }
    expect(sawTransition).toBe(true); // proves a real offset change was observed across the window
  }, 15000);

  it('19. a second generation run creates zero duplicates', async () => {
    const w = await makeUser(agency.id, 'WORKER', 'Gen Idempotent');
    const pattern = await makePattern({ workerId: w.id });
    const first = await generateFixedWorkPatternShifts({ agencyId: agency.id, patternId: pattern.id });
    const countAfterFirst = await testPrisma.shift.count({ where: { fixedWorkPatternId: pattern.id } });
    const second = await generateFixedWorkPatternShifts({ agencyId: agency.id, patternId: pattern.id });
    const countAfterSecond = await testPrisma.shift.count({ where: { fixedWorkPatternId: pattern.id } });
    expect(second.generated).toBe(0);
    expect(second.skippedDuplicate).toBe(first.generated);
    expect(countAfterSecond).toBe(countAfterFirst);
  });

  it('20. a cancelled generated shift is not regenerated', async () => {
    const w = await makeUser(agency.id, 'WORKER', 'Gen CancelledSkip');
    const pattern = await makePattern({ workerId: w.id });
    await generateFixedWorkPatternShifts({ agencyId: agency.id, patternId: pattern.id });
    const [oneShift] = await testPrisma.shift.findMany({ where: { fixedWorkPatternId: pattern.id }, take: 1 });
    await testPrisma.shift.update({ where: { id: oneShift.id }, data: { status: 'CANCELLED', cancelledAt: new Date(), cancellationReason: 'test' } });

    const countBefore = await testPrisma.shift.count({ where: { fixedWorkPatternId: pattern.id } });
    const result = await generateFixedWorkPatternShifts({ agencyId: agency.id, patternId: pattern.id });
    const countAfter = await testPrisma.shift.count({ where: { fixedWorkPatternId: pattern.id } });
    expect(countAfter).toBe(countBefore);
    expect(result.generated).toBe(0);

    const reread = await testPrisma.shift.findUnique({ where: { id: oneShift.id } });
    expect(reread.status).toBe('CANCELLED');
  });

  it('21. a manually edited generated shift is not overwritten', async () => {
    const w = await makeUser(agency.id, 'WORKER', 'Gen EditedSkip');
    const pattern = await makePattern({ workerId: w.id });
    await generateFixedWorkPatternShifts({ agencyId: agency.id, patternId: pattern.id });
    const [oneShift] = await testPrisma.shift.findMany({ where: { fixedWorkPatternId: pattern.id }, take: 1 });
    const editedStart = new Date(oneShift.startTime.getTime() + 3_600_000);
    const editedEnd = new Date(oneShift.endTime.getTime() + 3_600_000);
    await testPrisma.shift.update({ where: { id: oneShift.id }, data: { startTime: editedStart, endTime: editedEnd } });

    await generateFixedWorkPatternShifts({ agencyId: agency.id, patternId: pattern.id });
    const reread = await testPrisma.shift.findUnique({ where: { id: oneShift.id } });
    expect(reread.startTime.getTime()).toBe(editedStart.getTime());
    expect(reread.endTime.getTime()).toBe(editedEnd.getTime());
    const countForThatDate = await testPrisma.shift.count({ where: { fixedWorkPatternId: pattern.id, date: oneShift.date } });
    expect(countForThatDate).toBe(1);
  });

  it('22. approved leave skips the occurrence, and only that occurrence', async () => {
    const w = await makeUser(agency.id, 'WORKER', 'Gen LeaveSkip');
    const pattern = await makePattern({ workerId: w.id, days: { create: [{ weekday: 1, startTime: '09:00', endTime: '17:00' }] } });
    // Find the first Monday the generator would target, and put approved leave on it.
    let cursor = todayStr;
    while (isoWeekday(cursor) !== 1) cursor = addDaysStr(cursor, 1);
    await testPrisma.leaveRequest.create({
      data: {
        agencyId: agency.id, workerId: w.id, status: 'APPROVED',
        startDate: new Date(`${cursor}T00:00:00.000Z`), endDate: new Date(`${cursor}T23:59:59.000Z`),
      },
    });
    const result = await generateFixedWorkPatternShifts({ agencyId: agency.id, patternId: pattern.id, horizonDays: 20 });
    expect(result.skippedLeave).toBeGreaterThanOrEqual(1);
    const onLeaveDay = await testPrisma.shift.findFirst({ where: { fixedWorkPatternId: pattern.id, date: new Date(`${cursor}T00:00:00.000Z`) } });
    expect(onLeaveDay).toBeNull();
    const leaveRequests = await testPrisma.leaveRequest.findMany({ where: { agencyId: agency.id, workerId: w.id } });
    expect(leaveRequests.length).toBe(1); // untouched, never altered
  });

  it('23-24. a manual overlapping FIXED shift is never mutated and blocks duplicate generation', async () => {
    const w = await makeUser(agency.id, 'WORKER', 'Gen ManualFixedOverlap');
    const pattern = await makePattern({ workerId: w.id, days: { create: [{ weekday: 1, startTime: '09:00', endTime: '17:00' }] } });
    let cursor = todayStr;
    while (isoWeekday(cursor) !== 1) cursor = addDaysStr(cursor, 1);
    const manual = await testPrisma.shift.create({
      data: {
        agencyId: agency.id, workerId: w.id, createdById: hr.id, kind: 'FIXED', locationId: locationA.id,
        startTime: new Date(`${cursor}T10:00:00.000Z`), endTime: new Date(`${cursor}T15:00:00.000Z`), date: new Date(`${cursor}T00:00:00.000Z`),
      },
    });
    const before = await testPrisma.shift.findUnique({ where: { id: manual.id } });

    const result = await generateFixedWorkPatternShifts({ agencyId: agency.id, patternId: pattern.id, horizonDays: 20 });
    expect(result.skippedConflict).toBeGreaterThanOrEqual(1);

    const after = await testPrisma.shift.findUnique({ where: { id: manual.id } });
    expect(after).toEqual(before); // 23: never mutated

    const shiftsThatDay = await testPrisma.shift.findMany({ where: { workerId: w.id, date: new Date(`${cursor}T00:00:00.000Z`) } });
    expect(shiftsThatDay.length).toBe(1); // 24: no duplicate created alongside it
  });

  it('25. a manual ROTA shift overlap also prevents duplicate generation', async () => {
    const w = await makeUser(agency.id, 'WORKER', 'Gen RotaOverlap');
    const pattern = await makePattern({ workerId: w.id, days: { create: [{ weekday: 1, startTime: '09:00', endTime: '17:00' }] } });
    let cursor = todayStr;
    while (isoWeekday(cursor) !== 1) cursor = addDaysStr(cursor, 1);
    await testPrisma.shift.create({
      data: {
        agencyId: agency.id, workerId: w.id, createdById: hr.id, kind: 'ROTA', houseId: house.id,
        startTime: new Date(`${cursor}T08:00:00.000Z`), endTime: new Date(`${cursor}T16:00:00.000Z`), date: new Date(`${cursor}T00:00:00.000Z`),
      },
    });
    const result = await generateFixedWorkPatternShifts({ agencyId: agency.id, patternId: pattern.id, horizonDays: 20 });
    expect(result.skippedConflict).toBeGreaterThanOrEqual(1);
    const generatedThatDay = await testPrisma.shift.findFirst({ where: { fixedWorkPatternId: pattern.id, date: new Date(`${cursor}T00:00:00.000Z`) } });
    expect(generatedThatDay).toBeNull();
  });

  it('27. every generated shift is Location-backed only (never House-backed)', async () => {
    const w = await makeUser(agency.id, 'WORKER', 'Gen LocationOnly');
    const pattern = await makePattern({ workerId: w.id });
    await generateFixedWorkPatternShifts({ agencyId: agency.id, patternId: pattern.id });
    const shifts = await testPrisma.shift.findMany({ where: { fixedWorkPatternId: pattern.id } });
    expect(shifts.length).toBeGreaterThan(0);
    for (const s of shifts) {
      expect(s.locationId).not.toBeNull();
      expect(s.houseId).toBeNull();
    }
  });

  it('28. no notifications are sent by generation', async () => {
    const w = await makeUser(agency.id, 'WORKER', 'Gen NoNotify');
    const before = await testPrisma.notification.count({ where: { userId: w.id } });
    const pattern = await makePattern({ workerId: w.id });
    const result = await generateFixedWorkPatternShifts({ agencyId: agency.id, patternId: pattern.id });
    expect(result.generated).toBeGreaterThan(0);
    const after = await testPrisma.notification.count({ where: { userId: w.id } });
    expect(after).toBe(before);
  });

  it('29. no attendance/history tables are modified by generation', async () => {
    const w = await makeUser(agency.id, 'WORKER', 'Gen NoHistoryTouch');
    const [clockBefore, tsBefore, monBefore] = await Promise.all([
      testPrisma.clockEvent.count({ where: { workerId: w.id } }),
      testPrisma.timesheet.count({ where: { workerId: w.id } }),
      testPrisma.attendanceMonitor.count({ where: { workerId: w.id } }),
    ]);
    const pattern = await makePattern({ workerId: w.id });
    await generateFixedWorkPatternShifts({ agencyId: agency.id, patternId: pattern.id });
    const [clockAfter, tsAfter, monAfter] = await Promise.all([
      testPrisma.clockEvent.count({ where: { workerId: w.id } }),
      testPrisma.timesheet.count({ where: { workerId: w.id } }),
      testPrisma.attendanceMonitor.count({ where: { workerId: w.id } }),
    ]);
    expect(clockAfter).toBe(clockBefore);
    expect(tsAfter).toBe(tsBefore);
    expect(monAfter).toBe(monBefore);
  });

  it('30. one bad occurrence does not abort generation for the rest of the batch', async () => {
    const sarah = await makeUser(agency.id, 'WORKER', 'Gen Sarah');
    const john = await makeUser(agency.id, 'WORKER', 'Gen John');
    const patternSarah = await makePattern({ workerId: sarah.id, days: { create: [{ weekday: 1, startTime: '09:00', endTime: '17:00' }, { weekday: 2, startTime: '09:00', endTime: '17:00' }] } });
    const patternJohn = await makePattern({ workerId: john.id, days: { create: [{ weekday: 1, startTime: '09:00', endTime: '17:00' }] } });

    let sabotaged = false;
    const originalCreate = prisma.shift.create.bind(prisma.shift);
    const spy = jest.spyOn(prisma.shift, 'create').mockImplementation(async (args) => {
      if (!sabotaged && args.data.fixedWorkPatternId === patternSarah.id) {
        sabotaged = true;
        throw new Error('Simulated DB failure for one occurrence');
      }
      return originalCreate(args);
    });

    const result = await generateFixedWorkPatternShifts({ agencyId: agency.id, horizonDays: 13 });
    spy.mockRestore();

    expect(result.errors.length).toBeGreaterThanOrEqual(1);
    const johnShifts = await testPrisma.shift.count({ where: { fixedWorkPatternId: patternJohn.id } });
    expect(johnShifts).toBeGreaterThan(0); // John's generation was unaffected
    const sarahShifts = await testPrisma.shift.count({ where: { fixedWorkPatternId: patternSarah.id } });
    expect(sarahShifts).toBeGreaterThan(0); // Sarah's OTHER occurrences still generated despite the one failure
  });

  it('31. the structured summary counts accurately for a fully known scenario', async () => {
    const w = await makeUser(agency.id, 'WORKER', 'Gen SummaryCounts');
    const pattern = await makePattern({ workerId: w.id, days: { create: [{ weekday: 1, startTime: '09:00', endTime: '17:00' }, { weekday: 2, startTime: '09:00', endTime: '17:00' }] } });
    const result = await generateFixedWorkPatternShifts({ agencyId: agency.id, patternId: pattern.id, fromDate: todayStr, horizonDays: 13 }); // exactly 2 calendar weeks
    const shifts = await testPrisma.shift.findMany({ where: { fixedWorkPatternId: pattern.id } });
    expect(result.generated).toBe(shifts.length);
    expect(result.patternsProcessed).toBe(1);
    expect(result.skippedDuplicate).toBe(0);
    expect(result.skippedLeave).toBe(0);
    expect(result.skippedConflict).toBe(0);
    expect(result.skippedInactiveWorker).toBe(0);
    expect(result.errors).toEqual([]);
    expect(result.occurrences.filter((o) => o.status === RESULT.GENERATED).length).toBe(result.generated);
  });

  it('33. weekly hours: a pattern already approved over the cap is not flagged for review', async () => {
    const lowCapAgency = await testPrisma.agency.create({ data: { name: `FWP LowCap ${suffix}`, timezone: 'Europe/London', maxWeeklyScheduledHours: 30 } });
    const lowHr = await makeUser(lowCapAgency.id, 'HR', 'LowCap HR');
    const lowWorker = await makeUser(lowCapAgency.id, 'WORKER', 'LowCap Worker');
    const lowLoc = await makeLocation(lowCapAgency.id, 'LowCap Loc');
    const pattern = await testPrisma.fixedWorkPattern.create({
      data: {
        agencyId: lowCapAgency.id, workerId: lowWorker.id, locationId: lowLoc.id,
        effectiveFrom: new Date('2000-01-01T00:00:00.000Z'), createdById: lowHr.id, status: 'ACTIVE',
        overrideWeeklyLimit: true, overrideReason: 'pre-approved', overrideById: lowHr.id,
        days: { create: MON_FRI_9_5 }, // 40h/week > 30h cap, but pre-approved
      },
    });
    const result = await generateFixedWorkPatternShifts({ agencyId: lowCapAgency.id, patternId: pattern.id, horizonDays: 6 });
    expect(result.generated).toBeGreaterThan(0);
    expect(result.weeklyHoursReviewRequired).toBe(0);

    await testPrisma.shift.deleteMany({ where: { agencyId: lowCapAgency.id } });
    await testPrisma.fixedWorkPatternDay.deleteMany({ where: { pattern: { agencyId: lowCapAgency.id } } });
    await testPrisma.fixedWorkPattern.deleteMany({ where: { agencyId: lowCapAgency.id } });
    await testPrisma.location.deleteMany({ where: { agencyId: lowCapAgency.id } });
    await testPrisma.user.deleteMany({ where: { agencyId: lowCapAgency.id } });
    await testPrisma.agency.deleteMany({ where: { id: lowCapAgency.id } });
  });

  it('34. weekly hours: other/manual shifts pushing an otherwise-fine pattern over the cap ARE flagged for review', async () => {
    const lowCapAgency = await testPrisma.agency.create({ data: { name: `FWP LowCap2 ${suffix}`, timezone: 'Europe/London', maxWeeklyScheduledHours: 12 } });
    const lowHr = await makeUser(lowCapAgency.id, 'HR', 'LowCap2 HR');
    const lowWorker = await makeUser(lowCapAgency.id, 'WORKER', 'LowCap2 Worker');
    const lowLoc = await makeLocation(lowCapAgency.id, 'LowCap2 Loc');
    let monday = todayStr;
    while (isoWeekday(monday) !== 1) monday = addDaysStr(monday, 1); // the next Monday on/after today — never in the past
    const cursor = addDaysStr(monday, 2); // Wednesday of that same week

    // An unrelated manual shift earlier in the same agency week (8h) — the pattern's own Monday 09-17 (8h) alone is within the 12h cap, but together they exceed it.
    await testPrisma.shift.create({
      data: {
        agencyId: lowCapAgency.id, workerId: lowWorker.id, createdById: lowHr.id, kind: 'FIXED', locationId: lowLoc.id,
        startTime: new Date(`${cursor}T09:00:00.000Z`), endTime: new Date(`${cursor}T17:00:00.000Z`), date: new Date(`${cursor}T00:00:00.000Z`),
      },
    });

    const pattern = await testPrisma.fixedWorkPattern.create({
      data: {
        agencyId: lowCapAgency.id, workerId: lowWorker.id, locationId: lowLoc.id,
        effectiveFrom: new Date(`${monday}T00:00:00.000Z`), createdById: lowHr.id, status: 'ACTIVE',
        days: { create: [{ weekday: 1, startTime: '09:00', endTime: '17:00' }] }, // 8h/week alone — within the 12h cap
      },
    });
    const result = await generateFixedWorkPatternShifts({ agencyId: lowCapAgency.id, patternId: pattern.id, fromDate: monday, horizonDays: horizonDaysTo(todayStr, monday, 0) });
    expect(result.generated).toBe(1);
    expect(result.weeklyHoursReviewRequired).toBe(1);

    await testPrisma.shift.deleteMany({ where: { agencyId: lowCapAgency.id } });
    await testPrisma.fixedWorkPatternDay.deleteMany({ where: { pattern: { agencyId: lowCapAgency.id } } });
    await testPrisma.fixedWorkPattern.deleteMany({ where: { agencyId: lowCapAgency.id } });
    await testPrisma.location.deleteMany({ where: { agencyId: lowCapAgency.id } });
    await testPrisma.user.deleteMany({ where: { agencyId: lowCapAgency.id } });
    await testPrisma.agency.deleteMany({ where: { id: lowCapAgency.id } });
  });

  // ─── Concurrency guard: @@unique([fixedWorkPatternId, date]) ─────────────
  // These prove the DB constraint added to close the TOCTOU gap, plus the
  // regressions it must never introduce for anything NULL-provenance.

  it('concurrency: two simultaneous generation calls for the same occurrence create exactly one Shift, never a generic error', async () => {
    const w = await makeUser(agency.id, 'WORKER', 'Gen Concurrency');
    const pattern = await makePattern({ workerId: w.id, days: { create: ALL_WEEK_9_5 } });
    const occurrenceDate = new Date(`${todayStr}T00:00:00.000Z`);

    // Deterministically force the race rather than hoping real network timing
    // happens to overlap: gate the occurrence-existence check (the exact
    // query fixedWorkPatternGenerationService runs before every create) so
    // BOTH concurrent calls pass it and both attempt the create — proving
    // PostgreSQL's constraint, not luck, is what prevents the duplicate.
    const originalFindFirst = prisma.shift.findFirst.bind(prisma.shift);
    let arrivals = 0;
    let releaseGate;
    const gate = new Promise((resolve) => { releaseGate = resolve; });
    const spy = jest.spyOn(prisma.shift, 'findFirst').mockImplementation(async (args) => {
      const isOccurrenceCheck = args?.where?.fixedWorkPatternId === pattern.id && 'date' in (args.where || {});
      if (isOccurrenceCheck) {
        arrivals += 1;
        if (arrivals >= 2) releaseGate();
        await gate;
      }
      return originalFindFirst(args);
    });

    const [resultA, resultB] = await Promise.all([
      generateFixedWorkPatternShifts({ agencyId: agency.id, patternId: pattern.id, fromDate: todayStr, horizonDays: 0 }),
      generateFixedWorkPatternShifts({ agencyId: agency.id, patternId: pattern.id, fromDate: todayStr, horizonDays: 0 }),
    ]);
    spy.mockRestore();

    expect(arrivals).toBeGreaterThanOrEqual(2); // the race was genuinely forced, not skipped

    // 1. only ONE Shift exists for the occurrence
    const shifts = await testPrisma.shift.findMany({ where: { fixedWorkPatternId: pattern.id, date: occurrenceDate } });
    expect(shifts.length).toBe(1);

    // 2/3. one call generated it, the competing call classified it as duplicate
    const generatedTotal = resultA.generated + resultB.generated;
    const duplicateTotal = resultA.skippedDuplicate + resultB.skippedDuplicate;
    expect(generatedTotal).toBe(1);
    expect(duplicateTotal).toBeGreaterThanOrEqual(1);

    // 4/5. neither call crashed, and neither reports a generic error for the race
    expect(resultA.errors).toEqual([]);
    expect(resultB.errors).toEqual([]);
    const raceOccurrence = [...resultA.occurrences, ...resultB.occurrences].find((o) => o.status === RESULT.SKIPPED_DUPLICATE && o.date === todayStr);
    expect(raceOccurrence).toBeTruthy();
  });

  it('regression: manually-created shifts with fixedWorkPatternId = null are unaffected by the unique constraint', async () => {
    const w = await makeUser(agency.id, 'WORKER', 'Gen NullUnaffected');
    const w2 = await makeUser(agency.id, 'WORKER', 'Gen NullUnaffected 2');
    const dateStr = todayStr;
    // Two manual (fixedWorkPatternId=null), different-worker shifts sharing
    // the exact same `date` value — must both succeed; Postgres treats every
    // NULL as distinct from every other NULL for uniqueness purposes.
    const s1 = await testPrisma.shift.create({
      data: { agencyId: agency.id, workerId: w.id, createdById: hr.id, kind: 'FIXED', locationId: locationA.id, startTime: new Date(`${dateStr}T09:00:00.000Z`), endTime: new Date(`${dateStr}T17:00:00.000Z`), date: new Date(`${dateStr}T00:00:00.000Z`) },
    });
    const s2 = await testPrisma.shift.create({
      data: { agencyId: agency.id, workerId: w2.id, createdById: hr.id, kind: 'FIXED', locationId: locationA.id, startTime: new Date(`${dateStr}T09:00:00.000Z`), endTime: new Date(`${dateStr}T17:00:00.000Z`), date: new Date(`${dateStr}T00:00:00.000Z`) },
    });
    expect(s1.fixedWorkPatternId).toBeNull();
    expect(s2.fixedWorkPatternId).toBeNull();
  });

  it('regression: multiple manual shifts on the same date remain permitted subject to the existing overlap rules', async () => {
    const w = await makeUser(agency.id, 'WORKER', 'Gen ManualOverlapRule');
    const dateStr = todayStr;
    await testPrisma.shift.create({
      data: { agencyId: agency.id, workerId: w.id, createdById: hr.id, kind: 'FIXED', locationId: locationA.id, startTime: new Date(`${dateStr}T09:00:00.000Z`), endTime: new Date(`${dateStr}T12:00:00.000Z`), date: new Date(`${dateStr}T00:00:00.000Z`) },
    });
    // Same worker, same date, NON-overlapping time window — the unique
    // constraint (scoped to fixedWorkPatternId=null, unrestricted) never
    // blocks this; only the pre-existing overlap business rule would, and it
    // doesn't apply here since the windows don't overlap.
    const s2 = await testPrisma.shift.create({
      data: { agencyId: agency.id, workerId: w.id, createdById: hr.id, kind: 'FIXED', locationId: locationA.id, startTime: new Date(`${dateStr}T13:00:00.000Z`), endTime: new Date(`${dateStr}T17:00:00.000Z`), date: new Date(`${dateStr}T00:00:00.000Z`) },
    });
    expect(s2.id).toBeTruthy();
    const sameDayCount = await testPrisma.shift.count({ where: { workerId: w.id, date: new Date(`${dateStr}T00:00:00.000Z`) } });
    expect(sameDayCount).toBe(2);
  });

  it('regression: different patterns may each generate an occurrence on the same calendar date', async () => {
    const w1 = await makeUser(agency.id, 'WORKER', 'Gen DiffPattern1');
    const w2 = await makeUser(agency.id, 'WORKER', 'Gen DiffPattern2');
    const pattern1 = await makePattern({ workerId: w1.id, days: { create: ALL_WEEK_9_5 } });
    const pattern2 = await makePattern({ workerId: w2.id, days: { create: ALL_WEEK_9_5 } });
    const [r1, r2] = await Promise.all([
      generateFixedWorkPatternShifts({ agencyId: agency.id, patternId: pattern1.id, fromDate: todayStr, horizonDays: 0 }),
      generateFixedWorkPatternShifts({ agencyId: agency.id, patternId: pattern2.id, fromDate: todayStr, horizonDays: 0 }),
    ]);
    expect(r1.generated).toBe(1);
    expect(r2.generated).toBe(1);
    const shiftsToday = await testPrisma.shift.findMany({ where: { date: new Date(`${todayStr}T00:00:00.000Z`), fixedWorkPatternId: { in: [pattern1.id, pattern2.id] } } });
    expect(shiftsToday.length).toBe(2);
  });

  it('regression: the same pattern may generate on different dates without conflict', async () => {
    const w = await makeUser(agency.id, 'WORKER', 'Gen SameDiffDates');
    const pattern = await makePattern({ workerId: w.id, days: { create: [{ weekday: 1, startTime: '09:00', endTime: '17:00' }, { weekday: 2, startTime: '09:00', endTime: '17:00' }] } });
    const result = await generateFixedWorkPatternShifts({ agencyId: agency.id, patternId: pattern.id, horizonDays: 13 });
    expect(result.generated).toBeGreaterThan(1);
    const dates = (await testPrisma.shift.findMany({ where: { fixedWorkPatternId: pattern.id }, select: { date: true } })).map((s) => s.date.getTime());
    expect(new Set(dates).size).toBe(dates.length); // every occurrence's date is unique for this pattern
  });
});
