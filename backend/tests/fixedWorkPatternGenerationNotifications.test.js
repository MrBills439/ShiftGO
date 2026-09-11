process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-access-secret';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test-refresh-secret';
process.env.RATE_LIMIT_DISABLED = 'true';

const { PrismaClient } = require('@prisma/client');
const prisma = require('../src/lib/prisma');
const testPrisma = new PrismaClient();
const { generateFixedWorkPatternShifts } = require('../src/services/fixedWorkPatternGenerationService');

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const MON_FRI_9_5 = [1, 2, 3, 4, 5].map((weekday) => ({ weekday, startTime: '09:00', endTime: '17:00' }));

// Recurring Fixed Work Patterns V1 — Phase 4: generation-triggered assignment
// notifications. Covers items 8-21 of the Phase 4 test list. Manual (HTTP)
// notifications live in tests/fixedShiftAssignmentNotifications.test.js;
// Phase 2's own generation-correctness suite (untouched except its one
// updated notification-count assertion) lives in
// tests/fixedWorkPatternGeneration.test.js.

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
// horizonDays is always measured from TODAY, never from `fromDate` — widen it
// to actually reach a future single target date, with `padDays` keeping the
// window tight so a single-weekday pattern yields exactly one occurrence.
function horizonDaysTo(fromStr, dateStr, padDays = 0) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [ty, tm, td] = fromStr.split('-').map(Number);
  const days = Math.round((Date.UTC(y, m - 1, d) - Date.UTC(ty, tm - 1, td)) / 86_400_000);
  return days + padDays;
}

describe('Recurring Fixed Work Patterns V1 — Phase 4 generation notifications', () => {
  let agency, hr, locationA, todayStr;

  const makeUser = (name, status = 'ACTIVE') =>
    testPrisma.user.create({
      data: { agencyId: agency.id, name, email: `${name.toLowerCase().replace(/\s+/g, '-')}-${suffix}@shiftgo.test`, passwordHash: 'x', role: 'WORKER', status },
    });

  const makePattern = (workerId, overrides = {}) =>
    testPrisma.fixedWorkPattern.create({
      data: {
        agencyId: agency.id, workerId, locationId: locationA.id,
        effectiveFrom: new Date('2000-01-01T00:00:00.000Z'), createdById: hr.id, status: 'ACTIVE',
        days: { create: MON_FRI_9_5 },
        ...overrides,
      },
    });

  beforeAll(async () => {
    agency = await testPrisma.agency.create({ data: { name: `FWP Notify Agency ${suffix}`, timezone: 'Europe/London' } });
    hr = await testPrisma.user.create({
      data: { agencyId: agency.id, name: 'FWP Notify HR', email: `fwp-notify-hr-${suffix}@shiftgo.test`, passwordHash: 'x', role: 'HR' },
    });
    locationA = await testPrisma.location.create({ data: { agencyId: agency.id, name: `FWP Notify Office ${suffix}`, type: 'OFFICE', active: true } });
    todayStr = ymdStr((() => {
      const now = new Date();
      return { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1, day: now.getUTCDate() };
    })());
  });

  afterAll(async () => {
    await testPrisma.notification.deleteMany({ where: { agencyId: agency.id } });
    await testPrisma.shift.deleteMany({ where: { agencyId: agency.id } });
    await testPrisma.fixedWorkPatternDay.deleteMany({ where: { pattern: { agencyId: agency.id } } });
    await testPrisma.fixedWorkPattern.deleteMany({ where: { agencyId: agency.id } });
    await testPrisma.location.deleteMany({ where: { agencyId: agency.id } });
    await testPrisma.user.deleteMany({ where: { agencyId: agency.id } });
    await testPrisma.agency.deleteMany({ where: { id: agency.id } });
    await testPrisma.$disconnect();
    // This file's own copy of the shared `../src/lib/prisma` singleton (used
    // above for the generation service itself and for `jest.spyOn`) —
    // released explicitly rather than left open for the rest of the process.
    await prisma.$disconnect();
  });

  it('8/9. a generated FIXED shift attempts assignment notification exactly once, with correct content', async () => {
    const w = await makeUser('FWP Notify Basic');
    const pattern = await makePattern(w.id);
    const result = await generateFixedWorkPatternShifts({ agencyId: agency.id, patternId: pattern.id, horizonDays: 6 });
    expect(result.generated).toBeGreaterThan(0);

    const notifs = await testPrisma.notification.findMany({ where: { userId: w.id, type: 'SHIFT_ASSIGNED' } });
    expect(notifs.length).toBe(result.generated); // exactly one per generated shift
    expect(notifs[0].body).toContain(locationA.name);
  });

  it('10/11. a second generation run sends zero new notifications (SKIPPED_DUPLICATE sends none)', async () => {
    const w = await makeUser('FWP Notify SecondRun');
    const pattern = await makePattern(w.id);
    const first = await generateFixedWorkPatternShifts({ agencyId: agency.id, patternId: pattern.id, horizonDays: 6 });
    const countAfterFirst = await testPrisma.notification.count({ where: { userId: w.id, type: 'SHIFT_ASSIGNED' } });
    const second = await generateFixedWorkPatternShifts({ agencyId: agency.id, patternId: pattern.id, horizonDays: 6 });
    expect(second.generated).toBe(0);
    expect(second.skippedDuplicate).toBe(first.generated);
    const countAfterSecond = await testPrisma.notification.count({ where: { userId: w.id, type: 'SHIFT_ASSIGNED' } });
    expect(countAfterSecond).toBe(countAfterFirst);
  });

  it('12. an occurrence skipped for approved leave sends no notification', async () => {
    const w = await makeUser('FWP Notify LeaveSkip');
    const pattern = await makePattern(w.id, { days: { create: [{ weekday: 1, startTime: '09:00', endTime: '17:00' }] } });
    let monday = todayStr;
    while (isoWeekday(monday) !== 1) monday = addDaysStr(monday, 1);
    await testPrisma.leaveRequest.create({
      data: { agencyId: agency.id, workerId: w.id, status: 'APPROVED', startDate: new Date(`${monday}T00:00:00.000Z`), endDate: new Date(`${monday}T23:59:59.000Z`) },
    });
    // A window containing exactly this one Monday — otherwise a later,
    // unblocked Monday within the horizon would generate normally and notify,
    // which is correct behaviour but would defeat this test's "sends none" check.
    const result = await generateFixedWorkPatternShifts({ agencyId: agency.id, patternId: pattern.id, fromDate: monday, horizonDays: horizonDaysTo(todayStr, monday) });
    expect(result.skippedLeave).toBe(1);
    const notifCount = await testPrisma.notification.count({ where: { userId: w.id, type: 'SHIFT_ASSIGNED' } });
    expect(notifCount).toBe(0);
  });

  it('13. an occurrence skipped for a manual overlap sends no notification', async () => {
    const w = await makeUser('FWP Notify ConflictSkip');
    const pattern = await makePattern(w.id, { days: { create: [{ weekday: 1, startTime: '09:00', endTime: '17:00' }] } });
    let monday = todayStr;
    while (isoWeekday(monday) !== 1) monday = addDaysStr(monday, 1);
    await testPrisma.shift.create({
      data: {
        agencyId: agency.id, workerId: w.id, createdById: hr.id, kind: 'FIXED', locationId: locationA.id,
        startTime: new Date(`${monday}T10:00:00.000Z`), endTime: new Date(`${monday}T15:00:00.000Z`), date: new Date(`${monday}T00:00:00.000Z`),
      },
    });
    // A window containing exactly this one Monday, for the same reason as
    // the leave-skip test above.
    const result = await generateFixedWorkPatternShifts({ agencyId: agency.id, patternId: pattern.id, fromDate: monday, horizonDays: horizonDaysTo(todayStr, monday) });
    expect(result.skippedConflict).toBe(1);
    const notifCount = await testPrisma.notification.count({ where: { userId: w.id, type: 'SHIFT_ASSIGNED' } });
    expect(notifCount).toBe(0); // the manual shift's own (unrelated, controller-side) notification isn't counted here — nothing was generated
  });

  it('14. a cancelled generated occurrence sends no notification on the next run', async () => {
    const w = await makeUser('FWP Notify CancelledSkip');
    const pattern = await makePattern(w.id);
    await generateFixedWorkPatternShifts({ agencyId: agency.id, patternId: pattern.id, horizonDays: 6 });
    const [oneShift] = await testPrisma.shift.findMany({ where: { fixedWorkPatternId: pattern.id }, take: 1 });
    await testPrisma.shift.update({ where: { id: oneShift.id }, data: { status: 'CANCELLED', cancelledAt: new Date(), cancellationReason: 'test' } });
    const countBefore = await testPrisma.notification.count({ where: { userId: w.id, type: 'SHIFT_ASSIGNED' } });

    const result = await generateFixedWorkPatternShifts({ agencyId: agency.id, patternId: pattern.id, horizonDays: 6 });
    expect(result.generated).toBe(0);
    const countAfter = await testPrisma.notification.count({ where: { userId: w.id, type: 'SHIFT_ASSIGNED' } });
    expect(countAfter).toBe(countBefore);
  });

  it('15. a manually edited generated occurrence sends no notification on the next run', async () => {
    const w = await makeUser('FWP Notify EditedSkip');
    const pattern = await makePattern(w.id);
    await generateFixedWorkPatternShifts({ agencyId: agency.id, patternId: pattern.id, horizonDays: 6 });
    const [oneShift] = await testPrisma.shift.findMany({ where: { fixedWorkPatternId: pattern.id }, take: 1 });
    await testPrisma.shift.update({ where: { id: oneShift.id }, data: { startTime: new Date(oneShift.startTime.getTime() + 3_600_000), endTime: new Date(oneShift.endTime.getTime() + 3_600_000) } });
    const countBefore = await testPrisma.notification.count({ where: { userId: w.id, type: 'SHIFT_ASSIGNED' } });

    await generateFixedWorkPatternShifts({ agencyId: agency.id, patternId: pattern.id, horizonDays: 6 });
    const countAfter = await testPrisma.notification.count({ where: { userId: w.id, type: 'SHIFT_ASSIGNED' } });
    expect(countAfter).toBe(countBefore);
  });

  it('16/17. in a concurrent-generation race, the winner sends exactly one notification and the P2002 loser sends none', async () => {
    const w = await makeUser('FWP Notify Concurrency');
    const pattern = await makePattern(w.id, { days: { create: [{ weekday: 1, startTime: '09:00', endTime: '17:00' }, { weekday: 2, startTime: '09:00', endTime: '17:00' }, { weekday: 3, startTime: '09:00', endTime: '17:00' }, { weekday: 4, startTime: '09:00', endTime: '17:00' }, { weekday: 5, startTime: '09:00', endTime: '17:00' }, { weekday: 6, startTime: '09:00', endTime: '17:00' }, { weekday: 7, startTime: '09:00', endTime: '17:00' }] } });

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

    await Promise.all([
      generateFixedWorkPatternShifts({ agencyId: agency.id, patternId: pattern.id, fromDate: todayStr, horizonDays: 0 }),
      generateFixedWorkPatternShifts({ agencyId: agency.id, patternId: pattern.id, fromDate: todayStr, horizonDays: 0 }),
    ]);
    spy.mockRestore();

    const shifts = await testPrisma.shift.findMany({ where: { fixedWorkPatternId: pattern.id } });
    expect(shifts.length).toBe(1); // proven again here for this occurrence — see Phase 2's own concurrency test for the primary proof

    // The generation service awaits its notification attempt inline before
    // moving to the next occurrence, so by the time both calls above have
    // resolved, any notification write has already happened — no extra wait
    // needed here.
    const notifCount = await testPrisma.notification.count({ where: { userId: w.id, type: 'SHIFT_ASSIGNED' } });
    expect(notifCount).toBe(1);
  });

  it('18/19. a notification failure after a successful generated create preserves the Shift and is never classified as an error', async () => {
    const w = await makeUser('FWP Notify FailureSafe');
    const pattern = await makePattern(w.id, { days: { create: [{ weekday: 1, startTime: '09:00', endTime: '17:00' }] } });

    const spy = jest.spyOn(prisma.notification, 'create').mockRejectedValueOnce(new Error('simulated notification failure'));
    const result = await generateFixedWorkPatternShifts({ agencyId: agency.id, patternId: pattern.id, horizonDays: 20 });
    spy.mockRestore();

    expect(result.generated).toBeGreaterThan(0); // the shift creation itself is unaffected
    expect(result.errors).toEqual([]); // notification failure is NOT a generation error
    const shifts = await testPrisma.shift.findMany({ where: { fixedWorkPatternId: pattern.id } });
    expect(shifts.length).toBe(result.generated); // the Shift row survives the notification failure
  });

  it('20. the notification failure log event is emitted, without crashing the generation call', async () => {
    const logger = require('../src/lib/logger');
    const warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => {});
    const w = await makeUser('FWP Notify FailureLogged');
    const pattern = await makePattern(w.id, { days: { create: [{ weekday: 1, startTime: '09:00', endTime: '17:00' }] } });

    const spy = jest.spyOn(prisma.notification, 'create').mockRejectedValueOnce(new Error('simulated notification failure'));
    await expect(generateFixedWorkPatternShifts({ agencyId: agency.id, patternId: pattern.id, horizonDays: 20 })).resolves.toBeTruthy();
    spy.mockRestore();

    expect(warnSpy).toHaveBeenCalledWith('FIXED_SHIFT_ASSIGNMENT_NOTIFICATION_FAILED', expect.objectContaining({
      patternId: pattern.id, message: expect.any(String),
    }));
    warnSpy.mockRestore();
  });

  it('21. no notification is ever sent for an occurrence whose Shift creation itself failed', async () => {
    const sabotaged = await makeUser('FWP Notify Sabotaged');
    const control = await makeUser('FWP Notify Control');
    const patternSabotaged = await makePattern(sabotaged.id, { days: { create: [{ weekday: 1, startTime: '09:00', endTime: '17:00' }] } });
    const patternControl = await makePattern(control.id, { days: { create: [{ weekday: 1, startTime: '09:00', endTime: '17:00' }] } });

    const originalCreate = prisma.shift.create.bind(prisma.shift);
    const spy = jest.spyOn(prisma.shift, 'create').mockImplementation(async (args) => {
      if (args.data.fixedWorkPatternId === patternSabotaged.id) throw new Error('simulated shift creation failure');
      return originalCreate(args);
    });
    const result = await generateFixedWorkPatternShifts({ agencyId: agency.id, horizonDays: 6 });
    spy.mockRestore();

    expect(result.errors.length).toBeGreaterThanOrEqual(1);
    const sabotagedNotifs = await testPrisma.notification.count({ where: { userId: sabotaged.id, type: 'SHIFT_ASSIGNED' } });
    expect(sabotagedNotifs).toBe(0); // the failed occurrence never reached the notification line
    const controlNotifs = await testPrisma.notification.count({ where: { userId: control.id, type: 'SHIFT_ASSIGNED' } });
    expect(controlNotifs).toBeGreaterThan(0); // the unaffected pattern still generated + notified normally
    void patternControl;
  });
});
