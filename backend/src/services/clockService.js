const prisma = require('../lib/prisma');
const { evaluateLocation, isValidCoordinate } = require('./geofenceService');
const { attendanceConfigFor } = require('../config/attendance');
const { attendanceTargetFor, attendanceTargetFields } = require('./attendanceTargetService');
const notificationService = require('./notificationService');
const agencyCache = require('../lib/agencyCache');
const { resolveTimeZone, ymdInZone } = require('../lib/agencyTime');

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
  // A shift-id clock-in for a FLEXIBLE shift (FLEXIBLE sessions are only ever
  // started by clockInFlexible, never by naming an existing shift).
  UNSUPPORTED_SHIFT_KIND: 'UNSUPPORTED_SHIFT_KIND',
  // FLEXIBLE Staff Attendance V1 — location-only clock-in.
  FLEXIBLE_NOT_ENABLED: 'FLEXIBLE_NOT_ENABLED',
  FLEXIBLE_LOCATION_REQUIRED: 'FLEXIBLE_LOCATION_REQUIRED',
  LOCATION_NOT_AVAILABLE: 'LOCATION_NOT_AVAILABLE',
  LOCATION_NOT_CONFIGURED: 'LOCATION_NOT_CONFIGURED',
  CLOCK_TIME_OUT_OF_RANGE: 'CLOCK_TIME_OUT_OF_RANGE',
  ACTIVE_SESSION_EXISTS: 'ACTIVE_SESSION_EXISTS',
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
  UNSUPPORTED_SHIFT_KIND: 'This shift cannot be clocked yet.',
  FLEXIBLE_NOT_ENABLED: 'Your work pattern does not allow clocking in without a scheduled shift.',
  FLEXIBLE_LOCATION_REQUIRED: 'Choose a work location to clock in.',
  LOCATION_NOT_AVAILABLE: 'That work location is not available. Choose another location.',
  LOCATION_NOT_CONFIGURED: 'That work location has no map position set up for attendance yet. Ask HR to complete it.',
  CLOCK_TIME_OUT_OF_RANGE: 'Your device clock is too far from the current time to clock in. Check your date and time and try again.',
  ACTIVE_SESSION_EXISTS: 'You already have an active clock-in session. Clock out before starting another.',
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

/**
 * The Shift is always the authority on its own attendance target — a
 * client-supplied houseId/locationId is a consistency check only, never used
 * to pick or override the target. Returns a `reject(...)` result if the shift
 * can't be clocked, or null when it's safe to proceed.
 *  - ROTA must resolve to a HOUSE target; FIXED and FLEXIBLE to a LOCATION
 *    target — this should always hold given shiftService.assertShiftAttendanceTarget
 *    (FLEXIBLE: clockInFlexible), but is checked explicitly rather than trusted.
 *  - A client-claimed houseId/locationId that disagrees with the Shift's own
 *    stored target is treated exactly like the old "shift not found for this
 *    house" case: FORBIDDEN, not a silent override.
 * A FLEXIBLE shift is never STARTED through here (clockIn rejects it first) —
 * only clocked out / monitored, once clockInFlexible has created it.
 */
function shiftTargetRejection(shift, target, { claimedHouseId, claimedLocationId } = {}) {
  if (!target) return reject(REASONS.FORBIDDEN);
  if (shift.kind === 'ROTA' && target.type !== 'HOUSE') return reject(REASONS.FORBIDDEN);
  if ((shift.kind === 'FIXED' || shift.kind === 'FLEXIBLE') && target.type !== 'LOCATION') return reject(REASONS.FORBIDDEN);
  if (claimedHouseId && claimedHouseId !== shift.houseId) return reject(REASONS.FORBIDDEN);
  if (claimedLocationId && claimedLocationId !== shift.locationId) return reject(REASONS.FORBIDDEN);
  return null;
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

// ── CLOCK-IN RECORD WRITES (shared) ─────────────────────────────────────────
// The ClockEvent(IN) + Shift IN_PROGRESS + Timesheet + AttendanceMonitor writes
// that make up a successful clock-in, extracted verbatim from clockIn so the
// FLEXIBLE path (clockInFlexible) writes byte-identical attendance records.
// MUST run inside the caller's transaction, after its per-shift/worker lock.
async function writeClockInRecords(tx, {
  shift, workerId, method, now, timestamp, capturedAt, latitude, longitude, accuracy,
  locationSource, geo, suspicious, targetFields,
}) {
  const shiftId = shift.id;
  const event = await tx.clockEvent.create({
    data: {
      workerId,
      agencyId: shift.agencyId,
      ...targetFields,
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
      agencyId: shift.agencyId, workerId, ...targetFields, shiftId,
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
      agencyId: shift.agencyId, shiftId, workerId, ...targetFields,
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

  return event;
}

// ── CLOCK IN ─────────────────────────────────────────────────────────────────
// `houseId`/`locationId` in `metadata` are OPTIONAL consistency checks, never
// authority — the Shift's own resolved attendance target always decides what
// gets written. Existing care clients that always send `houseId` keep working
// exactly as before (their value simply has to agree with the Shift's own).
async function clockIn(workerId, shiftId, method, metadata = {}) {
  const {
    agencyId, houseId: claimedHouseId, locationId: claimedLocationId,
    timestamp, latitude, longitude, accuracy, capturedAt,
    mockLocationSuspected, locationSource,
  } = metadata;

  const shift = await prisma.shift.findFirst({
    where: { id: shiftId, workerId, ...(agencyId ? { agencyId } : {}) },
    include: { house: true, location: true },
  });
  if (!shift) return reject(REASONS.FORBIDDEN);
  if (shift.status === 'CANCELLED') return reject(REASONS.SHIFT_CANCELLED);
  // A FLEXIBLE shift only ever exists because clockInFlexible created it as
  // part of a successful clock-in — it can never be "clocked into" by id.
  if (shift.kind === 'FLEXIBLE') return reject(REASONS.UNSUPPORTED_SHIFT_KIND);

  // Resolved attendance target: HOUSE for a ROTA shift, LOCATION for a FIXED
  // one. For a care ROTA shift this is always the House, so every value below
  // is identical to before.
  const target = attendanceTargetFor(shift);
  const targetRejection = shiftTargetRejection(shift, target, { claimedHouseId, claimedLocationId });
  if (targetRejection) return targetRejection;
  const targetFields = attendanceTargetFields(target);

  const cfg = attendanceConfigFor(target);
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
    latitude, longitude, accuracy, capturedAt, target, now: nowMs,
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

    const event = await writeClockInRecords(tx, {
      shift, workerId, method, now, timestamp, capturedAt, latitude, longitude, accuracy,
      locationSource, geo, suspicious, targetFields,
    });

    return { event, monitorStarted: true, geo };
  });

  if (!result.alreadyClockedIn) {
    const worker = await prisma.user.findUnique({ where: { id: workerId }, select: { fcmToken: true } });
    if (worker?.fcmToken) {
      notificationService
        .send(worker.fcmToken, { title: 'Clocked in', body: `You're clocked in at ${target.name}.` })
        .catch(() => {});
    }
  }
  return result;
}

// ── CLOCK IN — FLEXIBLE (location-only) ─────────────────────────────────────
// FLEXIBLE Staff Attendance V1. A FLEXIBLE employee has no pre-created Shift:
// they choose an active Location of their agency and clock in, and this creates
// the Shift row (kind FLEXIBLE, locationId, houseId null, endTime null until
// clock-out) together with the ClockEvent / Timesheet / AttendanceMonitor in ONE
// transaction — so a rejected clock-in (GPS, geofence, conflict) never leaves an
// orphan Shift behind. Eligibility comes from the DB (User.workPatternType),
// never from anything the client claims about itself.
//
// Deliberately NOT applied here: the scheduled-shift window (nothing is
// scheduled), the weekly scheduled-hours ceiling (this is actual worked time,
// not an allocation) and any leave check (clock-in has never consulted leave
// for ROTA/FIXED either). No notification is sent to the manager/assignee —
// the system materialising an attendance shift is not an assignment.
async function clockInFlexible(workerId, method, metadata = {}) {
  const {
    agencyId, locationId, timestamp, latitude, longitude, accuracy, capturedAt,
    mockLocationSuspected, locationSource,
  } = metadata;

  const worker = await prisma.user.findFirst({
    where: { id: workerId, ...(agencyId ? { agencyId } : {}) },
    select: { id: true, agencyId: true, status: true, workPatternType: true, fcmToken: true },
  });
  if (!worker || worker.status !== 'ACTIVE') return reject(REASONS.FORBIDDEN);
  if (worker.workPatternType !== 'FLEXIBLE') return reject(REASONS.FLEXIBLE_NOT_ENABLED);
  if (!locationId) return reject(REASONS.FLEXIBLE_LOCATION_REQUIRED);

  // Tenant-scoped + ACTIVE. A wrong-agency, unknown or inactive Location all
  // look identical to the caller — never leaks which.
  const location = await prisma.location.findFirst({
    where: { id: locationId, agencyId: worker.agencyId, active: true },
  });
  if (!location) return reject(REASONS.LOCATION_NOT_AVAILABLE);

  const target = attendanceTargetFor({ location });
  if (target.latitude == null || target.longitude == null) return reject(REASONS.LOCATION_NOT_CONFIGURED);
  const targetFields = attendanceTargetFields(target);

  // No scheduled window bounds a FLEXIBLE clock-in, so a client-supplied
  // timestamp (offline sync) is only honoured close to server time — otherwise
  // it would be a way to backdate a session by days.
  const cfg = attendanceConfigFor(target);
  const serverNowMs = Date.now();
  const now = timestamp ? new Date(timestamp) : new Date(serverNowMs);
  const nowMs = now.getTime();
  if (Number.isNaN(nowMs) || Math.abs(nowMs - serverNowMs) > cfg.shiftWindowGraceMs) {
    return reject(REASONS.CLOCK_TIME_OUT_OF_RANGE);
  }

  // Same GPS standard as ROTA/FIXED — no weaker rules for FLEXIBLE.
  if (latitude == null || longitude == null) return reject(REASONS.LOCATION_REQUIRED);
  const geo = evaluateLocation({ latitude, longitude, accuracy, capturedAt, target, now: nowMs });
  if (!geo.ok) return reject(geo.code, { geo }); // INVALID_COORDINATES | STALE_LOCATION
  if (!geo.accuracySufficient) return reject(REASONS.GPS_ACCURACY_INSUFFICIENT, { geo });
  if (!geo.withinGeofence) return reject(REASONS.OUTSIDE_GEOFENCE, { geo });

  const suspicious = !!mockLocationSuspected;
  const agency = await agencyCache.getAgencySettings(worker.agencyId);
  // Shift.date is the calendar day in the AGENCY's timezone (one timezone per
  // agency for shift times in this release), stored as that date at UTC
  // midnight: the same convention as the forms and the pattern generator.
  const { year, month, day } = ymdInZone(resolveTimeZone(agency?.timezone), now);
  const date = new Date(Date.UTC(year, month - 1, day));

  const result = await prisma.$transaction(async (tx) => {
    // Serialise every FLEXIBLE clock-in for this worker: two simultaneous taps /
    // two devices queue here, and the loser sees the winner's committed session.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`clock:flex:${workerId}`}, 0))`;

    const openShift = await tx.shift.findFirst({
      where: { agencyId: worker.agencyId, workerId, status: 'IN_PROGRESS' },
      select: { id: true },
    });
    const openMonitor = openShift
      ? null
      : await tx.attendanceMonitor.findFirst({ where: { workerId, closedAt: null }, select: { shiftId: true } });
    if (openShift || openMonitor) {
      return { activeSessionExists: true, activeShiftId: openShift ? openShift.id : openMonitor.shiftId };
    }

    const shift = await tx.shift.create({
      data: {
        agencyId: worker.agencyId,
        houseId: null,
        locationId: location.id,
        kind: 'FLEXIBLE',
        workerId,
        createdById: workerId,
        date,
        startTime: now,
        endTime: null,
        status: 'IN_PROGRESS',
      },
    });

    const event = await writeClockInRecords(tx, {
      shift, workerId, method, now, timestamp, capturedAt, latitude, longitude, accuracy,
      locationSource, geo, suspicious, targetFields,
    });

    return { shift, event, geo };
  });

  if (result.activeSessionExists) {
    return reject(REASONS.ACTIVE_SESSION_EXISTS, { activeShiftId: result.activeShiftId });
  }

  if (worker.fcmToken) {
    notificationService
      .send(worker.fcmToken, { title: 'Clocked in', body: `You're clocked in at ${target.name}.` })
      .catch(() => {});
  }

  const { shift, event } = result;
  return {
    shiftId: shift.id,
    kind: shift.kind,
    status: shift.status,
    clockInAt: event.timestamp,
    location: { id: target.id, name: target.name },
    event,
    monitorStarted: true,
    geo: result.geo,
  };
}

/**
 * The worker's currently open FLEXIBLE session, if any — lets the mobile app
 * rediscover it after a restart (the shift id is otherwise only known from the
 * clock-in response). Agency-scoped; only ever reads the caller's own shifts.
 */
async function getActiveFlexibleSession(workerId, agencyId) {
  const shift = await prisma.shift.findFirst({
    where: { workerId, kind: 'FLEXIBLE', status: 'IN_PROGRESS', ...(agencyId ? { agencyId } : {}) },
    include: { location: { select: { id: true, name: true } } },
    orderBy: { startTime: 'desc' },
  });
  if (!shift) return null;
  const clockIn = await prisma.clockEvent.findFirst({ where: { workerId, shiftId: shift.id, type: 'IN' } });
  return {
    shiftId: shift.id,
    kind: shift.kind,
    status: shift.status,
    clockInAt: clockIn?.timestamp ?? shift.startTime,
    location: shift.location,
  };
}

// ── CLOCK OUT ────────────────────────────────────────────────────────────────
// Location is captured for the record but NEVER blocks a clock-out.
// `houseId`/`locationId` in `metadata` are OPTIONAL consistency checks, never
// authority — see clockIn.
async function clockOut(workerId, shiftId, method, metadata = {}) {
  const {
    agencyId, houseId: claimedHouseId, locationId: claimedLocationId,
    timestamp, latitude, longitude, accuracy, capturedAt,
    mockLocationSuspected, locationSource, autoReason,
  } = metadata;

  const shift = await prisma.shift.findFirst({
    where: { id: shiftId, workerId, ...(agencyId ? { agencyId } : {}) },
    include: { house: true, location: true },
  });
  if (!shift) return reject(REASONS.FORBIDDEN);

  // House wins for a care ROTA shift — identical to the previous behaviour.
  const target = attendanceTargetFor(shift);
  const targetRejection = shiftTargetRejection(shift, target, { claimedHouseId, claimedLocationId });
  if (targetRejection) return targetRejection;
  const targetFields = attendanceTargetFields(target);

  const now = timestamp ? new Date(timestamp) : new Date();
  const nowMs = now.getTime();

  let geo = null;
  let locationStatus = 'UNKNOWN';
  if (isValidCoordinate(latitude, longitude)) {
    geo = evaluateLocation({ latitude, longitude, accuracy, capturedAt, target, now: nowMs });
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
        workerId, agencyId: shift.agencyId, ...targetFields, shiftId,
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

    // A FLEXIBLE shift has no scheduled end — its endTime is the real clock-out.
    await tx.shift.update({
      where: { id: shiftId },
      data: { status: 'COMPLETED', ...(shift.kind === 'FLEXIBLE' ? { endTime: event.timestamp } : {}) },
    });

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
        agencyId: shift.agencyId, workerId, ...targetFields, shiftId,
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

  // autoConfirm is a House-specific care setting — a FIXED (Location) shift
  // has no such flag yet, so shift.house is null and this is simply skipped.
  if (shift.house?.autoConfirm && result.timesheet && !result.timesheet.needsReview) {
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
            ? `Your shift at ${target.name} ended and you'd left the service, so you were clocked out.`
            : `You're clocked out of ${target.name}.`,
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
    include: { shift: { include: { house: true, location: true } } },
  });
  if (!monitor) return { active: false, reason: 'NOT_MONITORED' };

  const shift = monitor.shift;
  const target = attendanceTargetFor(shift); // House for a care ROTA shift

  // Reconcile: closed by another device / admin, or shift cancelled.
  const ts = await prisma.timesheet.findUnique({ where: { shiftId } });
  if (ts?.clockOutAt || shift.status === 'CANCELLED' || shift.status === 'COMPLETED') {
    await closeMonitor(shiftId, ts?.clockOutAt ? 'CLOSED_ELSEWHERE' : 'SHIFT_CANCELLED');
    return {
      active: false,
      reason: shift.status === 'CANCELLED' ? 'SHIFT_CANCELLED' : 'ALREADY_CLOSED',
    };
  }

  const cfg = attendanceConfigFor(target);
  const now = Date.now();
  const geo = evaluateLocation({ latitude, longitude, accuracy, capturedAt, target, now });

  // Unusable reading — acknowledge but do not move the state machine.
  if (!geo.ok || !geo.accuracySufficient) {
    return {
      active: true,
      accepted: false,
      code: geo.code || REASONS.GPS_ACCURACY_INSUFFICIENT,
      locationStatus: monitor.locationStatus,
    };
  }

  // A FLEXIBLE shift has no scheduled end, so it can never be "past" it.
  const shiftEnded = shift.endTime != null && now > shift.endTime.getTime();
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
    include: { shift: { include: { house: true, location: true } } },
  });
  if (!monitor) return { active: false, reason: 'NOT_MONITORED' };

  const cfg = attendanceConfigFor(attendanceTargetFor(monitor.shift));
  const now = new Date();
  const shiftEnded = monitor.shift.endTime != null && now.getTime() > monitor.shift.endTime.getTime();

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
    include: { shift: { include: { house: true, location: true } } },
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
    reportIntervalMs: monitor ? attendanceConfigFor(attendanceTargetFor(monitor.shift)).locationReportIntervalMs : null,
  };
}

module.exports = {
  clockIn,
  clockInFlexible,
  getActiveFlexibleSession,
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
