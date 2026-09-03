process.env.NODE_ENV = 'test';

const {
  completedPeriods,
  accruedToDate,
  grossAvailable,
  summariseUsage,
  computeBalance,
  canRequest,
  leaveHoursForRange,
} = require('../src/services/leave/accrualEngine');
const { computeYearEndReset } = require('../src/services/leave/yearEndReset');

const baseProfile = {
  method: 'FLAT_RATE',
  payPeriod: 'MONTHLY',
  flatRateHours: 10,
  hourlyAccrualRate: 0,
  lumpSumHours: 0,
  accrualStartDate: '2026-01-01T00:00:00.000Z',
  balanceCeilingHours: null,
  carryOverCapHours: null,
  allowNegativeBalance: false,
};

describe('completedPeriods', () => {
  test('monthly: counts only fully elapsed months', () => {
    expect(completedPeriods('2026-01-01', '2026-01-31', 'MONTHLY')).toBe(0);
    expect(completedPeriods('2026-01-01', '2026-02-01', 'MONTHLY')).toBe(1);
    expect(completedPeriods('2026-01-15', '2026-04-10', 'MONTHLY')).toBe(2); // 15 Feb, 15 Mar
    expect(completedPeriods('2026-01-15', '2026-04-20', 'MONTHLY')).toBe(3);
  });

  test('weekly / biweekly: integer number of spans', () => {
    expect(completedPeriods('2026-01-01', '2026-01-08', 'WEEKLY')).toBe(1);
    expect(completedPeriods('2026-01-01', '2026-01-21', 'WEEKLY')).toBe(2); // 20 days -> 2 full weeks
    expect(completedPeriods('2026-01-01', '2026-01-29', 'BIWEEKLY')).toBe(2);
  });

  test('guards against reversed / equal / invalid dates', () => {
    expect(completedPeriods('2026-02-01', '2026-01-01', 'MONTHLY')).toBe(0);
    expect(completedPeriods('2026-01-01', '2026-01-01', 'MONTHLY')).toBe(0);
    expect(completedPeriods('nonsense', '2026-01-01', 'MONTHLY')).toBe(0);
  });
});

describe('accruedToDate', () => {
  test('FLAT_RATE = completed periods x flat rate', () => {
    const asOf = new Date('2026-04-01T00:00:00.000Z'); // 3 completed months
    expect(accruedToDate({ profile: baseProfile, asOf })).toBe(30);
  });

  test('HOURLY = worked hours x hourly rate', () => {
    const profile = { ...baseProfile, method: 'HOURLY', hourlyAccrualRate: 0.0385 };
    expect(accruedToDate({ profile, totalWorkedHours: 1000 })).toBe(38.5);
  });

  test('LUMP_SUM = the awarded amount, ignoring time and worked hours', () => {
    const profile = { ...baseProfile, method: 'LUMP_SUM', lumpSumHours: 224 };
    expect(accruedToDate({ profile, totalWorkedHours: 5000, asOf: new Date('2099-01-01') })).toBe(224);
  });

  test('never negative', () => {
    const profile = { ...baseProfile, method: 'HOURLY', hourlyAccrualRate: -1 };
    expect(accruedToDate({ profile, totalWorkedHours: 100 })).toBe(0);
  });
});

describe('grossAvailable + balance ceiling', () => {
  test('carried over + accrued when uncapped', () => {
    expect(grossAvailable({ carriedOverHours: 12, accrued: 30 })).toEqual({
      raw: 42,
      value: 42,
      ceilingApplied: false,
    });
  });

  test('caps at the ceiling and flags it', () => {
    const r = grossAvailable({ carriedOverHours: 20, accrued: 40, balanceCeilingHours: 50 });
    expect(r.value).toBe(50);
    expect(r.ceilingApplied).toBe(true);
    expect(r.raw).toBe(60);
  });
});

describe('summariseUsage', () => {
  test('only APPROVED and PENDING consume balance', () => {
    const rows = [
      { status: 'APPROVED', totalHours: 15 },
      { status: 'APPROVED', totalHours: 7.5 },
      { status: 'PENDING', totalHours: 22.5 },
      { status: 'REJECTED', totalHours: 100 },
      { status: 'CANCELLED', totalHours: 100 },
    ];
    expect(summariseUsage(rows)).toEqual({ approvedTaken: 22.5, pendingScheduled: 22.5 });
  });
});

describe('computeBalance — Net Usable Balance', () => {
  test('net = gross - approved - pending', () => {
    const asOf = new Date('2026-04-01T00:00:00.000Z'); // 3 months -> 30h accrued
    const b = computeBalance({
      profile: baseProfile,
      carriedOverHours: 10,
      leaveRequests: [
        { status: 'APPROVED', totalHours: 8 },
        { status: 'PENDING', totalHours: 5 },
      ],
      asOf,
    });
    expect(b.accruedToDate).toBe(30);
    expect(b.grossAvailable).toBe(40);
    expect(b.approvedTaken).toBe(8);
    expect(b.pendingScheduled).toBe(5);
    expect(b.netUsableBalance).toBe(27);
  });

  test('ceiling reduces gross before usage is subtracted', () => {
    const asOf = new Date('2027-01-01T00:00:00.000Z'); // 12 months -> 120h accrued
    const b = computeBalance({
      profile: { ...baseProfile, balanceCeilingHours: 80 },
      carriedOverHours: 40,
      leaveRequests: [{ status: 'APPROVED', totalHours: 10 }],
      asOf,
    });
    expect(b.ceilingApplied).toBe(true);
    expect(b.grossAvailable).toBe(80);
    expect(b.netUsableBalance).toBe(70);
  });
});

describe('canRequest — negative balance flag', () => {
  const balance = { netUsableBalance: 12, allowNegativeBalance: false };

  test('allows a request within balance', () => {
    expect(canRequest({ balance, requestedHours: 12 })).toEqual({
      allowed: true,
      shortfallHours: 0,
      reason: null,
    });
  });

  test('blocks an over-request when negatives are disallowed', () => {
    const v = canRequest({ balance, requestedHours: 20 });
    expect(v.allowed).toBe(false);
    expect(v.shortfallHours).toBe(8);
    expect(v.reason).toBe('INSUFFICIENT_BALANCE');
  });

  test('permits going negative when the profile allows it', () => {
    const v = canRequest({ balance: { ...balance, allowNegativeBalance: true }, requestedHours: 999 });
    expect(v.allowed).toBe(true);
  });
});

describe('leaveHoursForRange', () => {
  test('counts weekdays only, x daily hours', () => {
    // Mon 2026-03-02 .. Fri 2026-03-06 = 5 weekdays
    expect(leaveHoursForRange('2026-03-02', '2026-03-06', 7.5)).toBe(37.5);
    // includes a weekend: Fri .. next Mon = Fri + Mon = 2 weekdays
    expect(leaveHoursForRange('2026-03-06', '2026-03-09', 8)).toBe(16);
    // single weekend day = 0
    expect(leaveHoursForRange('2026-03-07', '2026-03-08', 8)).toBe(0);
  });

  test('reversed range = 0', () => {
    expect(leaveHoursForRange('2026-03-10', '2026-03-01', 8)).toBe(0);
  });
});

describe('computeYearEndReset — carry-over cap + accrued reset', () => {
  const profile = {
    ...baseProfile,
    method: 'LUMP_SUM',
    lumpSumHours: 100,
    carryOverCapHours: 40,
  };

  test('caps carry-over, forfeits the rest, zeroes accrued', () => {
    const r = computeYearEndReset({
      profile,
      carriedOverHours: 10,
      leaveRequests: [{ status: 'APPROVED', totalHours: 20 }],
      cycleEndDate: '2026-12-31T00:00:00.000Z',
    });
    // gross = 10 carried + 100 lump = 110 ; remaining = 110 - 20 approved = 90
    expect(r.previousCycle.grossAvailable).toBe(110);
    expect(r.previousCycle.remaining).toBe(90);
    // capped at 40, forfeit 50
    expect(r.carriedOverHours).toBe(40);
    expect(r.forfeitedHours).toBe(50);
    expect(r.nextCycle.accruedHours).toBe(0);
    expect(r.nextCycle.carriedOverHours).toBe(40);
    // ledger: a RESET (negative accrued) and a CARRY_OVER (+40)
    const types = r.ledgerEntries.map((e) => e.type).sort();
    expect(types).toEqual(['CARRY_OVER', 'RESET']);
    expect(r.ledgerEntries.find((e) => e.type === 'RESET').hours).toBe(-100);
    expect(r.ledgerEntries.find((e) => e.type === 'CARRY_OVER').hours).toBe(40);
  });

  test('uncapped carry-over rolls the whole remaining balance', () => {
    const r = computeYearEndReset({
      profile: { ...profile, carryOverCapHours: null },
      carriedOverHours: 0,
      leaveRequests: [],
      cycleEndDate: '2026-12-31T00:00:00.000Z',
    });
    expect(r.carriedOverHours).toBe(100);
    expect(r.forfeitedHours).toBe(0);
  });

  test('never carries a negative balance forward', () => {
    const r = computeYearEndReset({
      profile: { ...profile, lumpSumHours: 10, carryOverCapHours: 40 },
      carriedOverHours: 0,
      leaveRequests: [{ status: 'APPROVED', totalHours: 25 }],
      cycleEndDate: '2026-12-31T00:00:00.000Z',
    });
    expect(r.previousCycle.remaining).toBe(-15);
    expect(r.carriedOverHours).toBe(0);
    expect(r.forfeitedHours).toBe(0);
  });
});
