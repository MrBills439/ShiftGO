/**
 * Year-end cycle reset for the PTO engine.
 *
 * At the close of an accrual cycle:
 *   1. Freeze Gross Available  = min(carriedOver + accruedToDate, ceiling)
 *   2. Remaining               = Gross Available - Approved Taken
 *      (pending requests do NOT roll over — they belong to the old cycle and
 *      must be re-submitted or approved before reset; this is a policy choice)
 *   3. New Carry-Over          = clamp(Remaining, 0, carryOverCap)
 *   4. Forfeited               = max(Remaining - New Carry-Over, 0)
 *   5. Accrued resets to 0; a fresh cycle starts at `cycleEndDate`.
 */

const { computeBalance, round2 } = require('./accrualEngine');

/**
 * Pure computation — no DB. Returns the numbers plus the ledger entries that
 * should be written to persist the reset.
 *
 * @param {{
 *   profile: import('./accrualEngine').AccrualProfile,
 *   carriedOverHours?: number,
 *   totalWorkedHours?: number,
 *   leaveRequests?: import('./accrualEngine').LeaveRequestLike[],
 *   cycleEndDate?: Date|string,
 * }} input
 */
function computeYearEndReset({
  profile,
  carriedOverHours = 0,
  totalWorkedHours = 0,
  leaveRequests = [],
  cycleEndDate = new Date(),
}) {
  const end = cycleEndDate instanceof Date ? cycleEndDate : new Date(cycleEndDate);

  const balance = computeBalance({
    profile,
    carriedOverHours,
    totalWorkedHours,
    leaveRequests,
    asOf: end,
  });

  const remaining = round2(balance.grossAvailable - balance.approvedTaken);
  const cap = profile.carryOverCapHours;
  const newCarryOver = round2(
    Math.max(0, cap == null ? remaining : Math.min(remaining, cap))
  );
  const forfeitedHours = round2(Math.max(0, remaining - newCarryOver));

  const ledgerEntries = [
    {
      type: 'RESET',
      hours: round2(-balance.accruedToDate),
      description: `Year-end reset: cleared ${balance.accruedToDate}h accrued for cycle ending ${end.toISOString().slice(0, 10)}`,
      effectiveAt: end,
    },
    {
      type: 'CARRY_OVER',
      hours: newCarryOver,
      description:
        forfeitedHours > 0
          ? `Carried over ${newCarryOver}h (cap ${cap ?? '∞'}h); forfeited ${forfeitedHours}h`
          : `Carried over ${newCarryOver}h into the new cycle`,
      effectiveAt: end,
    },
  ];

  return {
    previousCycle: {
      grossAvailable: balance.grossAvailable,
      approvedTaken: balance.approvedTaken,
      pendingScheduled: balance.pendingScheduled,
      remaining,
    },
    carryOverCapHours: cap ?? null,
    carriedOverHours: newCarryOver,
    forfeitedHours,
    nextCycle: {
      cycleStartDate: end.toISOString(),
      carriedOverHours: newCarryOver,
      accruedHours: 0,
    },
    ledgerEntries,
  };
}

/**
 * Persisting wrapper: runs {@link computeYearEndReset} for one user and writes
 * the new LeaveBalance + ledger entries in a transaction.
 *
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {{
 *   userId: string,
 *   agencyId: string,
 *   profile: import('./accrualEngine').AccrualProfile,
 *   currentCarriedOverHours: number,
 *   totalWorkedHours: number,
 *   leaveRequests: import('./accrualEngine').LeaveRequestLike[],
 *   cycleEndDate?: Date,
 * }} input
 */
async function applyYearEndReset(prisma, input) {
  const {
    userId,
    agencyId,
    profile,
    currentCarriedOverHours,
    totalWorkedHours,
    leaveRequests,
    cycleEndDate = new Date(),
  } = input;

  const result = computeYearEndReset({
    profile,
    carriedOverHours: currentCarriedOverHours,
    totalWorkedHours,
    leaveRequests,
    cycleEndDate,
  });

  await prisma.$transaction([
    prisma.leaveBalance.upsert({
      where: { userId },
      create: {
        agencyId,
        userId,
        cycleStartDate: cycleEndDate,
        carriedOverHours: result.carriedOverHours,
        accruedHours: 0,
        lastAccrualAt: cycleEndDate,
      },
      update: {
        cycleStartDate: cycleEndDate,
        carriedOverHours: result.carriedOverHours,
        accruedHours: 0,
        lastAccrualAt: cycleEndDate,
      },
    }),
    prisma.leaveLedgerEntry.createMany({
      data: result.ledgerEntries.map((e) => ({
        agencyId,
        userId,
        type: e.type,
        hours: e.hours,
        description: e.description,
        effectiveAt: e.effectiveAt,
      })),
    }),
  ]);

  return result;
}

module.exports = { computeYearEndReset, applyYearEndReset };
