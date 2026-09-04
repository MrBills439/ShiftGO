const prisma = require('../lib/prisma');
const { evaluateLocation, isValidCoordinate } = require('./geofenceService');
const { attendanceConfigFor } = require('../config/attendance');
const notificationService = require('./notificationService');

// ── Reason / verification codes ────────────────────────────────────────────────
// Rejections (no attendance state changes):
const REASONS = Object.freeze({
  FORBIDDEN: 'FORBIDDEN',
  SHIFT_CANCELLED: 'SHIFT_CANCELLED',
  OUTSIDE_SHIFT_WINDOW: 'OUTSIDE_SHIFT_WINDOW',
  LOCATION_REQUIRED: 'LOCATION_REQUIRED',
  INVALID_COORDINATES: 'INVALID_COORDINATES',
  STALE_LOCATION: 'STALE_LOCATION',
  GPS_ACCURACY_INSUFFICIENT: 'GPS_ACCURACY_INSUFFICIENT',
  OUTSIDE_GEOFENCE: 'OUTSIDE_GEOFENCE',
});

// ClockEvent.verification / AuditLog.action strings:
const VERIFICATION = Object.freeze({
  CLOCK_IN_GEOFENCE_VERIFIED: 'CLOCK_IN_GEOFENCE_VERIFIED',
  CLOCK_IN_OUTSIDE_GEOFENCE: 'CLOCK_IN_OUTSIDE_GEOFENCE',
  MANUAL_ONSITE_CLOCK_OUT: 'MANUAL_ONSITE_CLOCK_OUT',
  MANUAL_OFFSITE_CLOCK_OUT: 'MANUAL_OFFSITE_CLOCK_OUT',
  CLOCK_OUT_LOCATION_UNKNOWN: 'CLOCK_OUT_LOCATION_UNKNOWN',
  AUTO_CLOCK_OUT_AFTER_SHIFT_EXIT: 'AUTO_CLOCK_OUT_AFTER_SHIFT_EXIT',
});

const PROMPTS = Object.freeze({
  LEFT_GEOFENCE_STILL_WORKING: 'LEFT_GEOFENCE_STILL_WORKING',
  SHIFT_ENDED_STILL_ONSITE: 'SHIFT_ENDED_STILL_ONSITE',
  SHIFT_ENDED_AND_LEFT: 'SHIFT_ENDED_AND_LEFT',
});

const REJECT_MESSAGES = {
  FORBIDDEN: 'This shift is not assigned to you.',
  SHIFT_CANCELLED: 'This shift has been cancelled.',
  OUTSIDE_SHIFT_WINDOW: 'You can only clock in around your scheduled shift time.',
  LOCATION_REQUIRED: 'We could not read your location. Enable location access and try again.',
  INVALID_COORDINATES: 'Your device reported an invalid location. Try again in the open.',
  STALE_LOCATION: 'Your location reading is out of date. Try again.',
  GPS_ACCURACY_INSUFFICIENT: 'Your GPS signal is too weak to verify you are at the service. Move to open sky and try again.',
  OUTSIDE_GEOFENCE: 'You appear to be outside the service location. Move closer and try again.',
};

function gpsConfidence(accuracy) {
  if (accuracy == null) return 'UNRELIABLE';
  const value = Number(accuracy);
  if (!Number.isFinite(value) || value > 100) return 'UNRELIABLE';
  if (value <= 25) return 'HIGH';
  if (value <= 50) return 'MEDIUM';
  return 'LOW';
}

function reject(code, extra = {}) {
  return { rejected: code, message: REJECT_MESSAGES[code] || 'Clock action rejected.', ...extra };
}

function locationSourceFor(method, locationSource) {
  if (locationSource === 'OFFLINE_SYNC') return 'OFFLINE_SYNC';
  return method === 'AUTO' ? 'GPS' : 'MANUAL';
}

async function getActiveShift(workerId, houseId) {
  const now = new Date();
  return prisma.shift.findFirst({
    where: {
      workerId,
      houseId,
      status: { in: ['SCHEDULED', 'CLAIMED', 'IN_PROGRESS'] },
      startTime: { lte: now },
      endTime: { gte: now },
    },
  });
}

// ── CLOCK IN ─────────────────────────────────────────────────────────────────
async function clockIn(workerId, houseId, shiftId, method, metadata = {}) {
  const {
    agencyId, timestamp, latitude, longitude, accuracy, capturedAt,
    mockLocationSuspected, locationSource,
  } = metadata;

  const shift = await prisma.shift.findFirst({
    where: { id: shiftId, houseId, workerId, ...(agencyId ? { agencyId } : {}) },
    include: { house: true },
  });
  if (!shift) return reject(REASONS.FORBIDDEN);
  if (shift.status === 'CANCELLED') return reject(REASONS.SHIFT_CANCELLED);

  const cfg = attendanceConfigFor(shift.house);
  const now = timestamp ? new Date(timestamp) : new Date();
  const nowMs = now.getTime();
  if (
    nowMs < shift.startTime.getTime() - cfg.shiftWindowGraceMs ||
    nowMs > shift.endTime.getTime() + cfg.shiftWindowGraceMs
  ) {
    return reject(REASONS.OUTSIDE_SHIFT_WINDOW);
  }

  // Idempotency — an existing IN means this shift is already clocked in.
  const existingIn = await prisma.clockEvent.findFirst({ where: { workerId, shiftId, type: 'IN' } });
  if (existingIn) return { alreadyClockedIn: true, event: existingIn };

  // Location is mandatory and verified on the server.
  if (latitude == null || longitude == null) return reject(REASONS.LOCATION_REQUIRED);

  const geo = evaluateLocation({
    latitude, longitude, accuracy, capturedAt, house: shift.house, now: nowMs,
  });
  if (!geo.ok) return reject(geo.code, { geo }); // INVALID_COORDINATES | STALE_LOCATION
  if (!geo.accuracySufficient) return reject(REASONS.GPS_ACCURACY_INSUFFICIENT, { geo });
  if (!geo.withinGeofence) return reject(REASONS.OUTSIDE_GEOFENCE, { geo });

  const suspicious = !!mockLocationSuspected;

  const result = await prisma.$transaction(async (tx) => {
    // Serialise all clock actions for this shift so concurrent taps / retries /
    // two devices can never both insert. Lock is released at transaction end.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`clock:${shiftId}`}, 0))`;

    const dupe = await tx.clockEvent.findFirst({ where: { workerId, shiftId, type: 'IN' } });
    if (dupe) return { alreadyClockedIn: true, event: dupe };

    const event = await tx.clockEvent.create({
      data: {
        workerId,
        agencyId: shift.agencyId,
        houseId,
        shiftId,
        type: 'IN',
        method,
        ...(timestamp ? { timestamp: now } : {}),
        capturedAt: capturedAt ? new Date(capturedAt) : null,
        latitude,
        longitude,
        accuracy: accuracy != null ? Number(accuracy) : null,
        gpsConfidence: gpsConfidence(accuracy),
        locationSource: locationSourceFor(method, locationSource),
        distanceMeters: geo.distanceMeters,
        geofenceRadius: geo.radiusM,
        withinGeofence: true,
        locationStatusResult: 'ONSITE',
        verification: VERIFICATION.CLOCK_IN_GEOFENCE_VERIFIED,
        mockLocationSuspected: suspicious,
      },
    });

    await tx.shift.update({ where: { id: shiftId }, data: { status: 'IN_PROGRESS' } });

    await tx.timesheet.upsert({
      where: { shiftId },
      create: {
        agencyId: shift.agencyId, workerId, houseId, shiftId,
        clockInAt: event.timestamp,
        clockInLocationStatus: 'ONSITE',
        needsReview: suspicious,
        reviewReason: suspicious ? 'Mock location suspected at clock-in' : null,
      },
      update: {
        clockInAt: event.timestamp,
        clockInLocationStatus: 'ONSITE',
        ...(suspicious ? { needsReview: true, reviewReason: 'Mock location suspected at clock-in' } : {}),
      },
    });

    await tx.attendanceMonitor.upsert({
      where: { shiftId },
      create: {
        agencyId: shift.agencyId, shiftId, workerId, houseId,
        locationStatus: 'ONSITE',
        lastLatitude: latitude, lastLongitude: longitude,
        lastAccuracy: accuracy != null ? Number(accuracy) : null,
        lastDistanceMeters: geo.distanceMeters,
        lastReadingAt: now,
      },
      update: {
        locationStatus: 'ONSITE', closedAt: null,
        lastLatitude: latitude, lastLongitude: longitude,
        lastAccuracy: accuracy != null ? Number(accuracy) : null,
        lastDistanceMeters: geo.distanceMeters, lastReadingAt: now,
        consecutiveOutsideCount: 0,
        geofenceExitConfirmedAt: null, stillWorkingConfirmedAt: null,
        exitPromptSnoozedUntil: null, shiftEndPromptedAt: null, shiftEndAckAt: null,
        autoClockOutGraceStartedAt: null, autoClockOutReminderSentAt: null,
      },
    });

    return { event, monitorStarted: true, geo };
  });

  if (!result.alreadyClockedIn) {
    const worker = await prisma.user.findUnique({ where: { id: workerId }, select: { fcmToken: true } });
    if (worker?.fcmToken) {
      notificationService
        .send(worker.fcmToken, { title: 'Clocked in', body: `You're clocked in at ${shift.house.name}.` })
        .catch(() => {});
    }
  }
  return result;
}

// ── CLOCK OUT ────────────────────────────────────────────────────────────────
// Location is captured for the record but NEVER blocks a clock-out.
async function clockOut(workerId, houseId, shiftId, method, metadata = {}) {
  const {
    agencyId, timestamp, latitude, longitude, accuracy, capturedAt,
    mockLocationSuspected, locationSource, autoReason,
  } = metadata;

  const shift = await prisma.shift.findFirst({
    where: { id: shiftId, houseId, workerId, ...(agencyId ? { agencyId } : {}) },
    include: { house: true },
  });
  if (!shift) return reject(REASONS.FORBIDDEN);

  const now = timestamp ? new Date(timestamp) : new Date();
  const nowMs = now.getTime();

  let geo = null;
  let locationStatus = 'UNKNOWN';
  if (isValidCoordinate(latitude, longitude)) {
    geo = evaluateLocation({ latitude, longitude, accuracy, capturedAt, house: shift.house, now: nowMs });
    if (geo.ok && geo.accuracySufficient) {
      locationStatus = geo.withinGeofence ? 'ONSITE' : 'OFFSITE';
    }
  }

  const verification =
    method === 'AUTO' ? VERIFICATION.AUTO_CLOCK_OUT_AFTER_SHIFT_EXIT
      : locationStatus === 'ONSITE' ? VERIFICATION.MANUAL_ONSITE_CLOCK_OUT
        : locationStatus === 'OFFSITE' ? VERIFICATION.MANUAL_OFFSITE_CLOCK_OUT
          : VERIFICATION.CLOCK_OUT_LOCATION_UNKNOWN;

  const suspicious = !!mockLocationSuspected;

  const result = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`clock:${shiftId}`}, 0))`;

    const ts = await tx.timesheet.findUnique({ where: { shiftId } });
    if (ts?.clockOutAt) return { alreadyClockedOut: true };
    const existingOut = await tx.clockEvent.findFirst({ where: { workerId, shiftId, type: 'OUT' } });
    if (existingOut) return { alreadyClockedOut: true };
    const clockInEvt = await tx.clockEvent.findFirst({ where: { workerId, shiftId, type: 'IN' } });
    if (!clockInEvt) return { notClockedIn: true };

    const event = await tx.clockEvent.create({
      data: {
        workerId, agencyId: shift.agencyId, houseId, shiftId,
        type: 'OUT', method,
        ...(timestamp ? { timestamp: now } : {}),
        capturedAt: capturedAt ? new Date(capturedAt) : null,
        latitude: geo ? latitude : null,
        longitude: geo ? longitude : null,
        accuracy: accuracy != null ? Number(accuracy) : null,
        gpsConfidence: gpsConfidence(accuracy),
        locationSource: locationSourceFor(method, locationSource),
        distanceMeters: geo ? geo.distanceMeters : null,
        geofenceRadius: geo ? geo.radiusM : null,
        withinGeofence: geo && geo.accuracySufficient ? geo.withinGeofence : null,
        locationStatusResult: locationStatus,
        verification,
        mockLocationSuspected: suspicious,
      },
    });

    await tx.shift.update({ where: { id: shiftId }, data: { status: 'COMPLETED' } });

    const totalHours = (event.timestamp - clockInEvt.timestamp) / 3_600_000;
    const needsReview =
      !!ts?.needsReview || suspicious || method === 'AUTO' || locationStatus === 'OFFSITE';
    const reviewReason = ts?.reviewReason
      || (method === 'AUTO' ? (autoReason || 'Automatic clock-out after post-shift geofence exit')
        : locationStatus === 'OFFSITE' ? 'Worker clocked out away from the service (off-site)'
          : suspicious ? 'Mock location suspected' : null);

    const timesheet = await tx.timesheet.upsert({
      where: { shiftId },
      create: {
        agencyId: shift.agencyId, workerId, houseId, shiftId,
        clockOutAt: event.timestamp, totalHours,
        clockOutLocationStatus: locationStatus, clockOutMethod: method,
        needsReview, reviewReason,
      },
      update: {
        clockOutAt: event.timestamp, totalHours,
        clockOutLocationStatus: locationStatus, clockOutMethod: method,
        needsReview, reviewReason,
      },
    });

    await closeMonitor(shiftId, 'CLOCK_OUT', tx, { closedAt: event.timestamp, locationStatus });

    return { event, timesheet, verification, locationStatus };
  });

  if (result.alreadyClockedOut || result.notClockedIn) return result;

  if (shift.house.autoConfirm && result.timesheet && !result.timesheet.needsReview) {
    await prisma.timesheet.update({
      where: { id: result.timesheet.id },
      data: { status: 'APPROVED', autoConfirmed: true, confirmedAt: new Date(), reviewedAt: new Date() },
    });
  }

  const worker = await prisma.user.findUnique({ where: { id: workerId }, select: { fcmToken: true } });
  if (worker?.fcmToken) {
    notificationService
      .send(worker.fcmToken, {
        title: method === 'AUTO' ? 'Clocked out automatically' : 'Clocked out',
        body:
          method === 'AUTO'
            ? `Your shift at ${shift.house.name} ended and you'd left the service, so you were clocked out.`
            : `You're clocked out of ${shift.house.name}.`,
      })
      .catch(() => {});
  }
  return result;
}

// ── PERIODIC LOCATION REPORT (only while clocked in) ─────────────────────────
async function reportLocation(workerId, shiftId, reading = {}, agencyId) {
  const { latitude, longitude, accuracy, capturedAt } = reading;

  const monitor = await prisma.attendanceMonitor.findFirst({
    where: { shiftId, workerId, closedAt: null, ...(agencyId ? { agencyId } : {}) },
    include: { shift: { include: { house: true } } },
  });
  if (!monitor) return { active: false, reason: 'NOT_MONITORED' };

  const shift = monitor.shift;

  // Reconcile: closed by another device / admin, or shift cancelled.
  const ts = await prisma.timesheet.findUnique({ where: { shiftId } });
  if (ts?.clockOutAt || shift.status === 'CANCELLED' || shift.status === 'COMPLETED') {
    await closeMonitor(shiftId, ts?.clockOutAt ? 'CLOSED_ELSEWHERE' : 'SHIFT_CANCELLED');
    return {
      active: false,
      reason: shift.status === 'CANCELLED' ? 'SHIFT_CANCELLED' : 'ALREADY_CLOSED',
    };
  }

  const cfg = attendanceConfigFor(shift.house);
  const now = Date.now();
  const geo = evaluateLocation({ latitude, longitude, accuracy, capturedAt, house: shift.house, now });

  // Unusable reading — acknowledge but do not move the state machine.
  if (!geo.ok || !geo.accuracySufficient) {
    return {
      active: true,
      accepted: false,
      code: geo.code || REASONS.GPS_ACCURACY_INSUFFICIENT,
      locationStatus: monitor.locationStatus,
    };
  }

  const shiftEnded = now > shift.endTime.getTime();
  const windowFresh =
    monitor.lastReadingAt && now - monitor.lastReadingAt.getTime() <= cfg.exitConfirmWindowMs;

  const data = {
    lastLatitude: latitude,
    lastLongitude: longitude,
    lastAccuracy: accuracy != null ? Number(accuracy) : null,
    lastDistanceMeters: geo.distanceMeters,
    lastReadingAt: new Date(now),
  };
  const audits = [];

  if (geo.withinGeofence) {
    if (monitor.locationStatus !== 'ONSITE' || monitor.geofenceExitConfirmedAt) {
      audits.push('WORKER_RETURNED_ONSITE');
    }
    Object.assign(data, {
      locationStatus: 'ONSITE',
      consecutiveOutsideCount: 0,
      geofenceExitConfirmedAt: null,
      autoClockOutGraceStartedAt: null,
      autoClockOutReminderSentAt: null,
      // A genuine return onsite ends the uncertain-exit episode — allow a fresh
      // review flag if the worker leaves again later.
      flaggedForReviewAt: null,
    });
  } else {
    const count = (windowFresh ? monitor.consecutiveOutsideCount : 0) + 1;
    data.consecutiveOutsideCount = count;
    const alreadyConfirmed = !!monitor.geofenceExitConfirmedAt;
    const nowConfirmed = alreadyConfirmed || count >= cfg.exitConfirmReadings;
    if (nowConfirmed) {
      data.locationStatus = 'OFFSITE';
      if (!alreadyConfirmed) {
        data.geofenceExitConfirmedAt = new Date(now);
        audits.push('GEOFENCE_EXIT_CONFIRMED');
      }
      if (shiftEnded && !monitor.stillWorkingConfirmedAt && !monitor.autoClockOutGraceStartedAt) {
        data.autoClockOutGraceStartedAt = new Date(now);
      }
    }
  }

  await prisma.attendanceMonitor.update({ where: { id: monitor.id }, data });

  const state = { ...monitor, ...data };
  const snoozed =
    state.exitPromptSnoozedUntil && new Date(state.exitPromptSnoozedUntil).getTime() > now;
  const exitConfirmed = !!state.geofenceExitConfirmedAt;

  let prompt = null;
  if (shiftEnded && exitConfirmed && !state.shiftEndAckAt) {
    prompt = PROMPTS.SHIFT_ENDED_AND_LEFT;
  } else if (shiftEnded && !state.shiftEndAckAt) {
    prompt = PROMPTS.SHIFT_ENDED_STILL_ONSITE;
  } else if (exitConfirmed && !state.stillWorkingConfirmedAt && !snoozed) {
    prompt = PROMPTS.LEFT_GEOFENCE_STILL_WORKING;
  }

  return {
    active: true,
    accepted: true,
    locationStatus: state.locationStatus,
    withinGeofence: geo.withinGeofence,
    distanceMeters: geo.distanceMeters,
    prompt,
    audits,
    reportIntervalMs: cfg.locationReportIntervalMs,
  };
}

// ── "Yes, still working" (from either prompt) ────────────────────────────────
async function confirmStillWorking(workerId, shiftId, agencyId) {
  const monitor = await prisma.attendanceMonitor.findFirst({
    where: { shiftId, workerId, closedAt: null, ...(agencyId ? { agencyId } : {}) },
    include: { shift: { include: { house: true } } },
  });
  if (!monitor) return { active: false, reason: 'NOT_MONITORED' };

  const cfg = attendanceConfigFor(monitor.shift.house);
  const now = new Date();
  const shiftEnded = now.getTime() > monitor.shift.endTime.getTime();

  await prisma.attendanceMonitor.update({
    where: { id: monitor.id },
    data: {
      stillWorkingConfirmedAt: now,
      exitPromptSnoozedUntil: new Date(now.getTime() + cfg.offsitePromptSnoozeMs),
      autoClockOutGraceStartedAt: null,
      autoClockOutReminderSentAt: null,
      ...(shiftEnded ? { shiftEndAckAt: now } : {}),
      locationStatus: monitor.locationStatus === 'ONSITE' ? 'ONSITE' : 'OFFSITE',
    },
  });

  return {
    active: true,
    snoozedUntil: new Date(now.getTime() + cfg.offsitePromptSnoozeMs).toISOString(),
    shiftEndedAcknowledged: shiftEnded,
  };
}

// Raw live-location fields cleared on EVERY monitor-close path (manual/auto
// clock-out, admin/other-device closure, shift cancellation/reconciliation).
// The discrete clock-in/clock-out evidence on ClockEvent is untouched.
const MONITOR_CLOSE_CLEAR = {
  lastLatitude: null,
  lastLongitude: null,
  lastAccuracy: null,
  lastDistanceMeters: null,
};

/**
 * Close the open monitor for a shift and scrub its live coordinates.
 * @param client  a Prisma client or an interactive-transaction client.
 * @param extra   extra columns to set (e.g. closedAt override, locationStatus).
 */
async function closeMonitor(shiftId, reason, client = prisma, extra = {}) {
  await client.attendanceMonitor.updateMany({
    where: { shiftId, closedAt: null },
    data: { closedAt: new Date(), ...MONITOR_CLOSE_CLEAR, ...extra },
  });
  return reason;
}

// ── State snapshot for the mobile app to reconcile on launch / resume ────────
async function getAttendanceState(workerId, shiftId, agencyId) {
  const monitor = await prisma.attendanceMonitor.findFirst({
    where: { shiftId, workerId, ...(agencyId ? { agencyId } : {}) },
    include: { shift: { include: { house: true } } },
  });
  const clockIn = await prisma.clockEvent.findFirst({ where: { workerId, shiftId, type: 'IN' } });
  const clockOut = await prisma.clockEvent.findFirst({ where: { workerId, shiftId, type: 'OUT' } });

  const clockedIn = !!clockIn && !clockOut;
  const active = clockedIn && !!monitor && !monitor.closedAt;

  return {
    clockedIn,
    monitorActive: active,
    locationStatus: monitor?.locationStatus ?? 'UNKNOWN',
    geofenceExitConfirmed: !!monitor?.geofenceExitConfirmedAt,
    stillWorkingConfirmed: !!monitor?.stillWorkingConfirmedAt,
    shiftEndAcknowledged: !!monitor?.shiftEndAckAt,
    reportIntervalMs: monitor ? attendanceConfigFor(monitor.shift.house).locationReportIntervalMs : null,
  };
}

module.exports = {
  clockIn,
  clockOut,
  reportLocation,
  confirmStillWorking,
  closeMonitor,
  getAttendanceState,
  getActiveShift,
  gpsConfidence,
  REASONS,
  VERIFICATION,
  PROMPTS,
};
