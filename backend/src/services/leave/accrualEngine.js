/**
 * PTO / Leave accrual engine — pure functions, no database access.
 *
 * Terminology (all values are in HOURS):
 *   Accrued To Date   = f(method): completed periods x flat rate
 *                                | worked hours x hourly rate
 *                                | lump sum awarded
 *   Gross Available   = Carried Over + Accrued To Date, capped at Balance Ceiling
 *   Net Usable        = Gross Available - Approved Taken - Pending Scheduled
 *
 * @typedef {'FLAT_RATE'|'HOURLY'|'LUMP_SUM'} AccrualMethod
 * @typedef {'WEEKLY'|'BIWEEKLY'|'MONTHLY'} PayPeriod
 *
 * @typedef {Object} AccrualProfile
 * @property {AccrualMethod} method
 * @property {PayPeriod} payPeriod          cadence used by FLAT_RATE
 * @property {number} flatRateHours         hours awarded per completed pay period
 * @property {number} hourlyAccrualRate     leave hours earned per hour worked
 * @property {number} lumpSumHours          annual hours granted upfront
 * @property {Date|string} accrualStartDate anchor date accrual counts from
 * @property {number|null} balanceCeilingHours  hard cap on Gross Available (null = uncapped)
 * @property {number|null} carryOverCapHours    max hours that roll into the next cycle (null = uncapped)
 * @property {boolean} allowNegativeBalance can leave be requested beyond Net Usable?
 *
 * @typedef {Object} LeaveRequestLike
 * @property {string} status   PENDING | APPROVED | REJECTED | CANCELLED
 * @property {number} totalHours
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function toDate(value) {
  return value instanceof Date ? value : new Date(value);
}

/**
 * Number of *fully completed* pay periods between `startDate` and `asOf`.
 * A period only counts once its entire span has elapsed.
 */
function completedPeriods(startDate, asOf, payPeriod) {
  const start = toDate(startDate);
  const end = toDate(asOf);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) return 0;

  if (payPeriod === 'MONTHLY') {
    let months =
      (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
    // Not a whole month yet if we haven't reached the same day-of-month.
    if (end.getDate() < start.getDate()) months -= 1;
    return Math.max(0, months);
  }

  const spanDays = payPeriod === 'BIWEEKLY' ? 14 : 7; // default WEEKLY
  const elapsedDays = Math.floor((end.getTime() - start.getTime()) / MS_PER_DAY);
  return Math.max(0, Math.floor(elapsedDays / spanDays));
}

/**
 * Accrued To Date for the current cycle.
 * @param {{ profile: AccrualProfile, totalWorkedHours?: number, asOf?: Date|string }} input
 * @returns {number} hours (>= 0)
 */
function accruedToDate({ profile, totalWorkedHours = 0, asOf = new Date() }) {
  switch (profile.method) {
    case 'HOURLY':
      return Math.max(0, round2(totalWorkedHours * (profile.hourlyAccrualRate || 0)));
    case 'LUMP_SUM':
      return Math.max(0, round2(profile.lumpSumHours || 0));
    case 'FLAT_RATE':
    default: {
      const periods = completedPeriods(profile.accrualStartDate, asOf, profile.payPeriod || 'MONTHLY');
      return Math.max(0, round2(periods * (profile.flatRateHours || 0)));
    }
  }
}

/**
 * Gross Available = Carried Over + Accrued To Date, capped at the ceiling.
 * @returns {{ raw: number, value: number, ceilingApplied: boolean }}
 */
function grossAvailable({ carriedOverHours = 0, accrued = 0, balanceCeilingHours = null }) {
  const raw = round2(carriedOverHours + accrued);
  if (balanceCeilingHours == null) return { raw, value: raw, ceilingApplied: false };
  const value = round2(Math.min(raw, balanceCeilingHours));
  return { raw, value, ceilingApplied: value < raw };
}

/**
 * Split leave history into hours already taken vs. hours pending.
 * REJECTED / CANCELLED requests never consume balance.
 * @param {LeaveRequestLike[]} leaveRequests
 */
function summariseUsage(leaveRequests = []) {
  let approvedTaken = 0;
  let pendingScheduled = 0;
  for (const r of leaveRequests) {
    const hrs = Number(r.totalHours) || 0;
    if (r.status === 'APPROVED') approvedTaken += hrs;
    else if (r.status === 'PENDING') pendingScheduled += hrs;
  }
  return { approvedTaken: round2(approvedTaken), pendingScheduled: round2(pendingScheduled) };
}

/**
 * Full balance breakdown for one worker.
 * @param {{
 *   profile: AccrualProfile,
 *   carriedOverHours?: number,
 *   totalWorkedHours?: number,
 *   leaveRequests?: LeaveRequestLike[],
 *   asOf?: Date|string,
 * }} input
 */
function computeBalance({
  profile,
  carriedOverHours = 0,
  totalWorkedHours = 0,
  leaveRequests = [],
  asOf = new Date(),
}) {
  const accrued = accruedToDate({ profile, totalWorkedHours, asOf });
  const gross = grossAvailable({
    carriedOverHours,
    accrued,
    balanceCeilingHours: profile.balanceCeilingHours ?? null,
  });
  const { approvedTaken, pendingScheduled } = summariseUsage(leaveRequests);
  const netUsableBalance = round2(gross.value - approvedTaken - pendingScheduled);

  return {
    method: profile.method,
    asOf: toDate(asOf).toISOString(),
    carriedOverHours: round2(carriedOverHours),
    accruedToDate: accrued,
    grossAvailableRaw: gross.raw,
    grossAvailable: gross.value,
    ceilingApplied: gross.ceilingApplied,
    balanceCeilingHours: profile.balanceCeilingHours ?? null,
    approvedTaken,
    pendingScheduled,
    netUsableBalance,
    allowNegativeBalance: Boolean(profile.allowNegativeBalance),
  };
}

/**
 * Can this worker book `requestedHours` more leave?
 * @param {{ balance: ReturnType<typeof computeBalance>, requestedHours: number }} input
 * @returns {{ allowed: boolean, shortfallHours: number, reason: string|null }}
 */
function canRequest({ balance, requestedHours }) {
  const hrs = Number(requestedHours) || 0;
  if (balance.allowNegativeBalance) {
    return { allowed: true, shortfallHours: 0, reason: null };
  }
  const remainingAfter = round2(balance.netUsableBalance - hrs);
  if (remainingAfter >= 0) {
    return { allowed: true, shortfallHours: 0, reason: null };
  }
  return {
    allowed: false,
    shortfallHours: Math.abs(remainingAfter),
    reason: 'INSUFFICIENT_BALANCE',
  };
}

/**
 * Hours a date range consumes: weekdays (Mon–Fri) in [start, end] inclusive,
 * multiplied by the worker's daily hours. Weekends are not counted.
 */
function leaveHoursForRange(start, end, dailyHours) {
  const s = toDate(start);
  const e = toDate(end);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime()) || e < s) return 0;

  const cursor = new Date(s.getFullYear(), s.getMonth(), s.getDate());
  const last = new Date(e.getFullYear(), e.getMonth(), e.getDate());
  let weekdays = 0;
  while (cursor <= last) {
    const dow = cursor.getDay();
    if (dow !== 0 && dow !== 6) weekdays += 1;
    cursor.setDate(cursor.getDate() + 1);
  }
  return round2(weekdays * (dailyHours || 0));
}

module.exports = {
  round2,
  completedPeriods,
  accruedToDate,
  grossAvailable,
  summariseUsage,
  computeBalance,
  canRequest,
  leaveHoursForRange,
};
