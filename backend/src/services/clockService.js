const { PrismaClient } = require('@prisma/client');
const { isInsideGeofence } = require('./geofenceService');
const notificationService = require('./notificationService');

const prisma = new PrismaClient();

async function getActiveShift(workerId, houseId) {
  const now = new Date();
  return prisma.shift.findFirst({
    where: {
      workerId,
      houseId,
      startTime: { lte: now },
      endTime: { gte: now },
    },
  });
}

async function clockIn(workerId, houseId, shiftId, method) {
  const existing = await prisma.clockEvent.findFirst({
    where: { workerId, shiftId, type: 'IN' },
  });
  if (existing) return { alreadyClockedIn: true };

  const event = await prisma.clockEvent.create({
    data: { workerId, houseId, shiftId, type: 'IN', method },
  });

  await prisma.timesheet.upsert({
    where: { shiftId },
    create: { workerId, houseId, shiftId, clockInAt: event.timestamp },
    update: { clockInAt: event.timestamp },
  });

  const worker = await prisma.user.findUnique({ where: { id: workerId } });
  const house = await prisma.house.findUnique({ where: { id: houseId } });
  if (worker?.fcmToken) {
    await notificationService.send(worker.fcmToken, {
      title: 'Clocked In',
      body: `You've been clocked in at ${house?.name}`,
    });
  }

  return { event };
}

async function clockOut(workerId, houseId, shiftId, method) {
  const clockIn = await prisma.clockEvent.findFirst({
    where: { workerId, shiftId, type: 'IN' },
  });
  if (!clockIn) return { notClockedIn: true };

  const event = await prisma.clockEvent.create({
    data: { workerId, houseId, shiftId, type: 'OUT', method },
  });

  const clockInTime = clockIn.timestamp;
  const clockOutTime = event.timestamp;
  const totalHours = (clockOutTime - clockInTime) / (1000 * 60 * 60);

  const timesheet = await prisma.timesheet.upsert({
    where: { shiftId },
    create: { workerId, houseId, shiftId, clockOutAt: clockOutTime, totalHours },
    update: { clockOutAt: clockOutTime, totalHours },
  });

  const house = await prisma.house.findUnique({ where: { id: houseId } });
  if (house?.autoConfirm) {
    await prisma.timesheet.update({
      where: { id: timesheet.id },
      data: { autoConfirmed: true, confirmedAt: new Date() },
    });
  }

  return { event };
}

async function autoCheckin(workerId, latitude, longitude) {
  const now = new Date();
  const shifts = await prisma.shift.findMany({
    where: {
      workerId,
      startTime: { lte: now },
      endTime: { gte: now },
    },
    include: { house: true },
  });

  const results = [];
  for (const shift of shifts) {
    const { house } = shift;
    if (isInsideGeofence(latitude, longitude, house.latitude, house.longitude, house.geofenceRadius)) {
      const result = await clockIn(workerId, house.id, shift.id, 'AUTO');
      results.push({ shiftId: shift.id, houseId: house.id, ...result });
    }
  }
  return results;
}

// Called by the mobile background task when a worker exits a geofence.
// Sends a clock-out prompt push notification if they are currently clocked in.
async function geofenceExit(workerId, latitude, longitude) {
  const now = new Date();
  const shifts = await prisma.shift.findMany({
    where: {
      workerId,
      startTime: { lte: now },
      endTime:   { gte: now },
    },
    include: { house: true },
  });

  const prompted = [];
  for (const shift of shifts) {
    const { house } = shift;

    // Only act if the worker is OUTSIDE this geofence
    if (isInsideGeofence(latitude, longitude, house.latitude, house.longitude, house.geofenceRadius)) {
      continue;
    }

    // Only prompt if they have an active clock-in with no clock-out
    const hasIn  = await prisma.clockEvent.findFirst({ where: { workerId, shiftId: shift.id, type: 'IN' } });
    const hasOut = await prisma.clockEvent.findFirst({ where: { workerId, shiftId: shift.id, type: 'OUT' } });
    if (!hasIn || hasOut) continue;

    const worker = await prisma.user.findUnique({ where: { id: workerId } });
    if (worker?.fcmToken) {
      await notificationService.sendClockOutPrompt(worker, house);
    }
    prompted.push({ shiftId: shift.id, houseId: house.id });
  }
  return prompted;
}

module.exports = { clockIn, clockOut, autoCheckin, geofenceExit, getActiveShift };
