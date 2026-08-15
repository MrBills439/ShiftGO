const { PrismaClient } = require('@prisma/client');
const { isInsideGeofence } = require('./geofenceService');
const notificationService = require('./notificationService');

const prisma = new PrismaClient();

function gpsConfidence(accuracy) {
  if (accuracy == null) return 'UNRELIABLE';
  const value = Number(accuracy);
  if (!Number.isFinite(value) || value > 100) return 'UNRELIABLE';
  if (value <= 25) return 'HIGH';
  if (value <= 50) return 'MEDIUM';
  return 'LOW';
}

function clockEventLocationData(method, metadata = {}) {
  const confidence = gpsConfidence(metadata.accuracy);
  const source = method === 'AUTO'
    ? 'GPS'
    : metadata.locationSource === 'OFFLINE_SYNC'
      ? 'OFFLINE_SYNC'
      : 'MANUAL';

  return {
    ...(metadata.accuracy != null ? { accuracy: Number(metadata.accuracy) } : {}),
    gpsConfidence: confidence,
    locationSource: source,
  };
}

function forbidden(message = 'Shift does not belong to your agency') {
  return { forbidden: true, message };
}

async function getActiveShift(workerId, houseId) {
  const now = new Date();
  return prisma.shift.findFirst({
    where: {
      workerId,
      houseId,
      status: { in: ['SCHEDULED', 'IN_PROGRESS'] },
      startTime: { lte: now },
      endTime: { gte: now },
    },
  });
}

async function clockIn(workerId, houseId, shiftId, method, metadata = {}) {
  const agencyId = metadata.agencyId;
  const shift = await prisma.shift.findFirst({
    where: { id: shiftId, houseId, workerId, ...(agencyId ? { agencyId } : {}) },
  });
  if (!shift) return forbidden();

  const eventTimestamp = metadata.timestamp ? new Date(metadata.timestamp) : undefined;
  const existing = await prisma.clockEvent.findFirst({
    where: { workerId, shiftId, type: 'IN' },
  });
  if (existing) return { alreadyClockedIn: true };

  const event = await prisma.clockEvent.create({
    data: {
      workerId,
      agencyId: shift.agencyId,
      houseId,
      shiftId,
      type: 'IN',
      method,
      ...(eventTimestamp ? { timestamp: eventTimestamp } : {}),
      ...clockEventLocationData(method, metadata),
    },
  });

  await prisma.shift.update({
    where: { id: shiftId },
    data: { status: 'IN_PROGRESS' },
  });

  await prisma.timesheet.upsert({
    where: { shiftId },
    create: { agencyId: shift.agencyId, workerId, houseId, shiftId, clockInAt: event.timestamp },
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

async function clockOut(workerId, houseId, shiftId, method, metadata = {}) {
  const agencyId = metadata.agencyId;
  const shift = await prisma.shift.findFirst({
    where: { id: shiftId, houseId, workerId, ...(agencyId ? { agencyId } : {}) },
  });
  if (!shift) return forbidden();

  const eventTimestamp = metadata.timestamp ? new Date(metadata.timestamp) : undefined;
  const result = await prisma.$transaction(async (tx) => {
    const timesheet = await tx.timesheet.findUnique({ where: { shiftId } });
    if (timesheet?.clockOutAt) return { alreadyClockedOut: true };

    const existingClockOut = await tx.clockEvent.findFirst({
      where: { workerId, shiftId, type: 'OUT' },
    });
    if (existingClockOut) return { alreadyClockedOut: true };

    const clockIn = await tx.clockEvent.findFirst({
      where: { workerId, shiftId, type: 'IN' },
    });
    if (!clockIn) return { notClockedIn: true };

    const event = await tx.clockEvent.create({
      data: {
        workerId,
        agencyId: shift.agencyId,
        houseId,
        shiftId,
        type: 'OUT',
        method,
        ...(eventTimestamp ? { timestamp: eventTimestamp } : {}),
        ...clockEventLocationData(method, metadata),
      },
    });

    await tx.shift.update({
      where: { id: shiftId },
      data: { status: 'COMPLETED' },
    });

    const clockInTime = clockIn.timestamp;
    const clockOutTime = event.timestamp;
    const totalHours = (clockOutTime - clockInTime) / (1000 * 60 * 60);

    const updatedTimesheet = await tx.timesheet.upsert({
      where: { shiftId },
      create: { agencyId: shift.agencyId, workerId, houseId, shiftId, clockOutAt: clockOutTime, totalHours },
      update: { clockOutAt: clockOutTime, totalHours },
    });

    return { event, timesheet: updatedTimesheet };
  });

  if (result.alreadyClockedOut || result.notClockedIn) return result;

  const { event, timesheet } = result;

  const house = await prisma.house.findUnique({ where: { id: houseId } });
  if (house?.autoConfirm) {
    await prisma.timesheet.update({
      where: { id: timesheet.id },
      data: { status: 'APPROVED', autoConfirmed: true, confirmedAt: new Date(), reviewedAt: new Date() },
    });
  }

  return { event };
}

async function autoCheckin(workerId, latitude, longitude, accuracy, agencyId) {
  const confidence = gpsConfidence(accuracy);
  if (confidence === 'UNRELIABLE') {
    return [{
      skipped: true,
      reason: 'GPS accuracy unreliable',
      gpsConfidence: confidence,
      accuracy: accuracy == null ? null : Number(accuracy),
    }];
  }

  const now = new Date();
  const shifts = await prisma.shift.findMany({
    where: {
      workerId,
      ...(agencyId ? { agencyId } : {}),
      status: { in: ['SCHEDULED', 'IN_PROGRESS'] },
      startTime: { lte: now },
      endTime: { gte: now },
    },
    include: { house: true },
  });

  const results = [];
  for (const shift of shifts) {
    const { house } = shift;
    if (isInsideGeofence(latitude, longitude, house.latitude, house.longitude, house.geofenceRadius)) {
      if (confidence === 'LOW') {
        results.push({
          shiftId: shift.id,
          houseId: house.id,
          requiresManualConfirmation: true,
          gpsConfidence: confidence,
          accuracy: Number(accuracy),
          reason: 'GPS accuracy is weak; manual confirmation required',
        });
        continue;
      }

      const result = await clockIn(workerId, house.id, shift.id, 'AUTO', { accuracy, agencyId: shift.agencyId });
      results.push({ shiftId: shift.id, houseId: house.id, ...result });
    }
  }
  return results;
}

// Called by the mobile background task when a worker exits a geofence.
// Sends a clock-out prompt push notification if they are currently clocked in.
async function geofenceExit(workerId, latitude, longitude, accuracy, agencyId) {
  const confidence = gpsConfidence(accuracy);
  if (confidence === 'UNRELIABLE') {
    return [{
      skipped: true,
      reason: 'GPS accuracy unreliable',
      gpsConfidence: confidence,
      accuracy: accuracy == null ? null : Number(accuracy),
    }];
  }

  const now = new Date();
  const shifts = await prisma.shift.findMany({
    where: {
      workerId,
      ...(agencyId ? { agencyId } : {}),
      status: { in: ['SCHEDULED', 'IN_PROGRESS'] },
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

module.exports = { clockIn, clockOut, autoCheckin, geofenceExit, getActiveShift, gpsConfidence };
