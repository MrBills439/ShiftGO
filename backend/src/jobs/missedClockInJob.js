const prisma = require('../lib/prisma');
const { createAndSend } = require('../services/notificationService');

// A missed clock-in only makes sense for a shift that still has an assigned
// worker who is expected to turn up.
const ALERTABLE_STATUSES = ['SCHEDULED', 'CLAIMED', 'IN_PROGRESS'];

/**
 * Runs every 5 minutes. Finds shifts that started 5–15 minutes ago whose
 * assigned worker has not clocked in, and sends that worker exactly ONE
 * MISSED_CLOCK_IN alert — an in-app Notification row plus a push attempt via
 * createAndSend. Re-running the job (the same missed shift matches on several
 * consecutive ticks) does not produce a second alert: it dedupes on an existing
 * MISSED_CLOCK_IN notification carrying this shiftId.
 */
async function missedClockInJob() {
  const now = new Date();
  const fiveMinsAgo = new Date(now.getTime() - 5 * 60 * 1000);
  const fifteenMinsAgo = new Date(now.getTime() - 15 * 60 * 1000);

  const shifts = await prisma.shift.findMany({
    where: {
      startTime: { gte: fifteenMinsAgo, lte: fiveMinsAgo },
      workerId: { not: null },
      status: { in: ALERTABLE_STATUSES },
    },
    select: {
      id: true,
      agencyId: true,
      workerId: true,
      house: { select: { name: true } },
      clockEvents: { where: { type: 'IN' }, select: { id: true } },
    },
  });

  let alerted = 0;
  for (const shift of shifts) {
    if (shift.clockEvents.length > 0) continue;

    const existing = await prisma.notification.findFirst({
      where: {
        agencyId: shift.agencyId,
        userId: shift.workerId,
        type: 'MISSED_CLOCK_IN',
        data: { path: ['shiftId'], equals: shift.id },
      },
      select: { id: true },
    });
    if (existing) continue;

    try {
      await createAndSend(
        shift.workerId,
        'MISSED_CLOCK_IN',
        'Missed clock-in',
        `Your shift at ${shift.house.name} has started but you haven't clocked in.`,
        { shiftId: shift.id },
      );
      alerted += 1;
    } catch (err) {
      console.error('[MissedClockIn] notify failed for shift', shift.id, err.message);
    }
  }

  if (shifts.length > 0) {
    console.log(`[MissedClockIn] Checked ${shifts.length} shift(s), sent ${alerted} new alert(s)`);
  }
}

module.exports = { missedClockInJob };
