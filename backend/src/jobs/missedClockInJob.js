const prisma = require('../lib/prisma');
const { sendMissedClockInAlert } = require('../services/notificationService');

// Runs every 5 minutes. Finds shifts that started 5-15 mins ago with no clock-in event.
async function missedClockInJob() {
  const now = new Date();
  const fiveMinsAgo  = new Date(now - 5  * 60 * 1000);
  const fifteenMinsAgo = new Date(now - 15 * 60 * 1000);

  const shifts = await prisma.shift.findMany({
    where: {
      startTime: { gte: fifteenMinsAgo, lte: fiveMinsAgo },
    },
    include: {
      worker: true,
      house: true,
      clockEvents: { where: { type: 'IN' } },
    },
  });

  for (const shift of shifts) {
    if (shift.clockEvents.length > 0) continue;
    try {
      await sendMissedClockInAlert(shift.worker, shift.house);
    } catch (err) {
      console.error('[MissedClockIn] notify failed', err.message);
    }
  }

  if (shifts.length > 0) {
    console.log(`[MissedClockIn] Checked ${shifts.length} shifts, alerted workers with no clock-in`);
  }
}

module.exports = { missedClockInJob };
