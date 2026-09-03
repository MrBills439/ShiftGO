const prisma = require('../../lib/prisma');
const { computeBalance, canRequest, leaveHoursForRange, round2 } = require('./accrualEngine');
const { applyYearEndReset } = require('./yearEndReset');

// Used when a worker has no LeaveAccrualProfile row yet: nobody accrues anything
// and negative balances are disallowed, so leave simply can't be over-booked
// until HR configures a real policy.
const DEFAULT_PROFILE = {
  method: 'FLAT_RATE',
  payPeriod: 'MONTHLY',
  flatRateHours: 0,
  hourlyAccrualRate: 0,
  lumpSumHours: 0,
  accrualStartDate: new Date(0),
  balanceCeilingHours: null,
  carryOverCapHours: null,
  allowNegativeBalance: false,
};

const DEFAULT_DAILY_HOURS = 7.5; // a standard care support shift

function dailyHoursFor(user) {
  // contractedHours is a weekly figure; spread over a 5-day week.
  if (user?.contractedHours && user.contractedHours > 0) {
    return round2(user.contractedHours / 5);
  }
  return DEFAULT_DAILY_HOURS;
}

async function getProfile(userId) {
  const row = await prisma.leaveAccrualProfile.findUnique({ where: { userId } });
  return { profile: row ?? { ...DEFAULT_PROFILE }, configured: Boolean(row) };
}

const PROFILE_FIELDS = [
  'method',
  'payPeriod',
  'flatRateHours',
  'hourlyAccrualRate',
  'lumpSumHours',
  'accrualStartDate',
  'balanceCeilingHours',
  'carryOverCapHours',
  'allowNegativeBalance',
];

/** Create or update a worker's accrual policy (HR / manager action). */
async function updateProfile(userId, agencyId, patch) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { agencyId: true } });
  if (!user) throw new Error('WORKER_NOT_FOUND');
  if (user.agencyId !== agencyId) throw new Error('CROSS_AGENCY_ACCESS');

  const data = {};
  for (const key of PROFILE_FIELDS) {
    if (patch[key] !== undefined) {
      data[key] = key === 'accrualStartDate' && patch[key] ? new Date(patch[key]) : patch[key];
    }
  }

  return prisma.leaveAccrualProfile.upsert({
    where: { userId },
    create: { userId, agencyId, ...data },
    update: data,
  });
}

async function getOrCreateBalance(userId, agencyId, profile) {
  const existing = await prisma.leaveBalance.findUnique({ where: { userId } });
  if (existing) return existing;
  return prisma.leaveBalance.create({
    data: {
      userId,
      agencyId,
      cycleStartDate: profile.accrualStartDate ?? new Date(),
      carriedOverHours: 0,
      accruedHours: 0,
    },
  });
}

/**
 * Actual hours worked in the current cycle — sum of non-rejected timesheet
 * hours since the cycle start. Feeds the HOURLY accrual method.
 */
async function workedHoursSince(userId, since) {
  const rows = await prisma.timesheet.findMany({
    where: {
      workerId: userId,
      status: { not: 'REJECTED' },
      clockInAt: { gte: since },
    },
    select: { totalHours: true },
  });
  return round2(rows.reduce((sum, r) => sum + (r.totalHours || 0), 0));
}

/** Leave requests that affect balance (any status; the engine filters). */
async function relevantLeaveRequests(userId, agencyId, since) {
  return prisma.leaveRequest.findMany({
    where: { workerId: userId, agencyId, startDate: { gte: since } },
    select: { status: true, totalHours: true },
  });
}

/**
 * Full Net-Usable-Balance breakdown for one worker.
 * @returns the {@link computeBalance} result plus cycle + policy context.
 */
async function getBalanceSummary(userId, agencyId, asOf = new Date()) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, agencyId: true, contractedHours: true },
  });
  if (!user) throw new Error('WORKER_NOT_FOUND');
  if (user.agencyId !== agencyId) throw new Error('CROSS_AGENCY_ACCESS');

  const { profile, configured } = await getProfile(userId);
  const balance = await getOrCreateBalance(userId, agencyId, profile);
  const cycleStart = balance.cycleStartDate ?? profile.accrualStartDate ?? new Date(0);

  const [totalWorkedHours, leaveRequests] = await Promise.all([
    workedHoursSince(userId, cycleStart),
    relevantLeaveRequests(userId, agencyId, cycleStart),
  ]);

  const summary = computeBalance({
    profile,
    carriedOverHours: balance.carriedOverHours,
    totalWorkedHours,
    leaveRequests,
    asOf,
  });

  return {
    ...summary,
    cycleStartDate: cycleStart,
    totalWorkedHours,
    dailyHours: dailyHoursFor(user),
    hasConfiguredProfile: configured,
  };
}

/**
 * Run the year-end reset for one worker: cap carry-over, zero the accrued
 * balance, and start a fresh cycle. Delegates the maths to yearEndReset.js.
 */
async function runYearEndReset(userId, agencyId, cycleEndDate = new Date()) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, agencyId: true },
  });
  if (!user) throw new Error('WORKER_NOT_FOUND');
  if (user.agencyId !== agencyId) throw new Error('CROSS_AGENCY_ACCESS');

  const { profile } = await getProfile(userId);
  const balance = await getOrCreateBalance(userId, agencyId, profile);
  const cycleStart = balance.cycleStartDate ?? profile.accrualStartDate ?? new Date(0);

  const [totalWorkedHours, leaveRequests] = await Promise.all([
    workedHoursSince(userId, cycleStart),
    relevantLeaveRequests(userId, agencyId, cycleStart),
  ]);

  return applyYearEndReset(prisma, {
    userId,
    agencyId,
    profile,
    currentCarriedOverHours: balance.carriedOverHours,
    totalWorkedHours,
    leaveRequests,
    cycleEndDate,
  });
}

/**
 * Enforcement check for a new/expanded leave request.
 * @returns {{ allowed: boolean, requestedHours: number, shortfallHours: number, balance: object }}
 */
async function assertCanRequest(userId, agencyId, startDate, endDate) {
  const summary = await getBalanceSummary(userId, agencyId);
  const requestedHours = leaveHoursForRange(startDate, endDate, summary.dailyHours);
  const verdict = canRequest({ balance: summary, requestedHours });
  return {
    allowed: verdict.allowed,
    requestedHours,
    shortfallHours: verdict.shortfallHours,
    balance: summary,
  };
}

module.exports = {
  DEFAULT_PROFILE,
  dailyHoursFor,
  getProfile,
  updateProfile,
  workedHoursSince,
  getBalanceSummary,
  assertCanRequest,
  runYearEndReset,
};
