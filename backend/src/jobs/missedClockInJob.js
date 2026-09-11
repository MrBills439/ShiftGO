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
      // Location-Backed Shift V1: FIXED (Location-backed) shifts have no clock-in
      // path yet, so a missed-clock-in alert for one would be meaningless. Only
      // care ROTA shifts are checked.
      kind: 'ROTA',
    },
    select: {
      id: true,
      agencyId: true,
      workerId: true,
      house: { select: { name: true } },
      clockEvents: { where: { type: 'IN' }, select: { id: true } },
    },
  });

  // One dedup query for the whole batch instead of one per shift. A missed
  // shift matches for ~10 minutes of ticks, so any prior alert is recent; the
  // 30-minute window keeps the scan tiny while covering every earlier tick.
  const candidates = shifts.filter((s) => s.clockEvents.length === 0);
  const alertedShiftIds = new Set();
  if (candidates.length > 0) {
    const priorAlerts = await prisma.notification.findMany({
      where: {
        type: 'MISSED_CLOCK_IN',
        userId: { in: candidates.map((s) => s.workerId) },
        createdAt: { gte: new Date(now.getTime() - 30 * 60 * 1000) },
      },
      select: { data: true },
    });
    for (const n of priorAlerts) {
      const sid = n.data && n.data.shiftId;
      if (sid) alertedShiftIds.add(sid);
    }
  }

  let alerted = 0;
  for (const shift of candidates) {
    if (alertedShiftIds.has(shift.id)) continue;

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
