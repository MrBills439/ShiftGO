const { PrismaClient } = require('@prisma/client');
const { send } = require('../services/notificationService');

const prisma = new PrismaClient();

// Runs every minute. Finds shifts that ended in the last 2 minutes where the worker
// is still clocked in (has an IN event but no OUT event), then auto-clocks them out.
async function autoClockOutJob() {
  const now = new Date();
  const twoMinsAgo = new Date(now - 2 * 60 * 1000);

  const shifts = await prisma.shift.findMany({
    where: {
      endTime: { gte: twoMinsAgo, lte: now },
    },
    include: {
      worker: true,
      house: true,
      clockEvents: true,
    },
  });

  for (const shift of shifts) {
    const hasClockIn  = shift.clockEvents.some((e) => e.type === 'IN');
    const hasClockOut = shift.clockEvents.some((e) => e.type === 'OUT');

    if (!hasClockIn || hasClockOut) continue;

    try {
      const event = await prisma.clockEvent.create({
        data: {
          workerId: shift.workerId,
          agencyId: shift.agencyId,
          houseId:  shift.houseId,
          shiftId:  shift.id,
          type:     'OUT',
          method:   'AUTO',
          timestamp: now,
        },
      });

      const clockInEvent = shift.clockEvents.find((e) => e.type === 'IN');
      const totalHours   = clockInEvent
        ? (now - new Date(clockInEvent.timestamp)) / (1000 * 60 * 60)
        : null;

      const timesheet = await prisma.timesheet.upsert({
        where: { shiftId: shift.id },
        create: {
          workerId:   shift.workerId,
          agencyId:   shift.agencyId,
          houseId:    shift.houseId,
          shiftId:    shift.id,
          clockOutAt: now,
          totalHours,
        },
        update: { clockOutAt: now, totalHours },
      });

      if (shift.house.autoConfirm) {
        await prisma.timesheet.update({
          where: { id: timesheet.id },
          data:  { autoConfirmed: true, confirmedAt: now },
        });
      }

      if (shift.worker.fcmToken) {
        await send(shift.worker.fcmToken, {
          title: 'Shift ended — clocked out',
          body:  `Your shift at ${shift.house.name} has ended. You have been clocked out automatically.`,
        });
      }

      console.log(`[AutoClockOut] Worker ${shift.worker.name} clocked out of ${shift.house.name}`);
    } catch (err) {
      console.error('[AutoClockOut] failed for shift', shift.id, err.message);
    }
  }
}

module.exports = { autoClockOutJob };
