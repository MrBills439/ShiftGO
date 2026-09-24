const clockService = require('../services/clockService');
const { auditContext, createAuditLog } = require('../services/auditService');
const { agencyIdFor } = require('../utils/agency');
const { ok, fail } = require('../utils/response');

const { REASONS } = clockService;

// rejection code -> HTTP status
const REJECT_STATUS = {
  [REASONS.FORBIDDEN]: 403,
  [REASONS.SHIFT_CANCELLED]: 409,
  [REASONS.OUTSIDE_SHIFT_WINDOW]: 409,
  [REASONS.LOCATION_REQUIRED]: 422,
  [REASONS.INVALID_COORDINATES]: 422,
  [REASONS.STALE_LOCATION]: 422,
  [REASONS.GPS_ACCURACY_INSUFFICIENT]: 422,
  [REASONS.OUTSIDE_GEOFENCE]: 422,
  [REASONS.UNSUPPORTED_SHIFT_KIND]: 409,
  // FLEXIBLE Staff Attendance V1
  [REASONS.FLEXIBLE_NOT_ENABLED]: 403,
  [REASONS.FLEXIBLE_LOCATION_REQUIRED]: 422,
  [REASONS.LOCATION_NOT_AVAILABLE]: 422,
  [REASONS.LOCATION_NOT_CONFIGURED]: 422,
  [REASONS.CLOCK_TIME_OUT_OF_RANGE]: 422,
  [REASONS.ACTIVE_SESSION_EXISTS]: 409,
};

function sendRejection(res, result) {
  const status = REJECT_STATUS[result.rejected] ?? 422;
  const details = result.geo
    ? {
        distanceMeters: result.geo.distanceMeters,
        geofenceRadius: result.geo.radiusM,
        accuracySufficient: result.geo.accuracySufficient,
      }
    : undefined;
  return fail(res, result.message, status, {
    code: result.rejected,
    ...(details ? { details } : {}),
    // ACTIVE_SESSION_EXISTS: the caller's own open session, so the app can resume it.
    ...(result.activeShiftId ? { activeShiftId: result.activeShiftId } : {}),
  });
}

async function auditClockIn(req, result, code, extra = {}) {
  // A FLEXIBLE clock-in has no request shiftId — the shift is created by the
  // clock-in itself, so a success carries it on the result.
  const shiftId = req.body.shiftId || result?.shiftId;
  await createAuditLog({
    ...auditContext(req),
    action: code,
    entityType: result?.event ? 'ClockEvent' : 'Shift',
    entityId: result?.event?.id || shiftId || req.body.locationId,
    newValue: {
      shiftId,
      distanceMeters: result?.geo?.distanceMeters ?? null,
      geofenceRadius: result?.geo?.radiusM ?? null,
      accuracy: req.body.accuracy ?? null,
      ...extra,
    },
  });
}

// `houseId` is kept as an existing-clients-compatible field; `locationId` is
// new for FIXED shifts. Neither is required — the Shift itself is
// authoritative — but when a client sends one it's checked for consistency.
//
// FLEXIBLE Staff Attendance V1: with a `shiftId` this is the unchanged
// ROTA/FIXED flow. Without one, the request is a location-only FLEXIBLE
// clock-in — clockService.clockInFlexible checks the caller's own
// workPatternType in the database, so nothing the client sends can make
// itself FLEXIBLE.
async function manualClockIn(req, res) {
  const { houseId, locationId, shiftId, timestamp, latitude, longitude, accuracy, capturedAt, mockLocationSuspected, locationSource } = req.body;
  if (!shiftId && !locationId) return fail(res, 'shiftId (scheduled shift) or locationId (flexible clock-in) required');

  const metadata = {
    houseId, locationId, timestamp, latitude, longitude, accuracy, capturedAt, mockLocationSuspected, locationSource,
    agencyId: agencyIdFor(req),
  };
  const result = shiftId
    ? await clockService.clockIn(req.user.id, shiftId, 'MANUAL', metadata)
    : await clockService.clockInFlexible(req.user.id, 'MANUAL', metadata);

  if (result.rejected) {
    const auditAction =
      result.rejected === REASONS.OUTSIDE_GEOFENCE ? 'CLOCK_IN_OUTSIDE_GEOFENCE'
        : result.rejected === REASONS.GPS_ACCURACY_INSUFFICIENT ? 'GPS_ACCURACY_INSUFFICIENT'
          : result.rejected === REASONS.LOCATION_REQUIRED ? 'CLOCK_IN_LOCATION_UNAVAILABLE'
            : null;
    if (auditAction) await auditClockIn(req, result, auditAction, { reason: result.rejected });
    return sendRejection(res, result);
  }
  if (result.alreadyClockedIn) return fail(res, 'Already clocked in for this shift', 409, { code: 'ALREADY_CLOCKED_IN' });

  await auditClockIn(req, result, 'CLOCK_IN_GEOFENCE_VERIFIED', {
    withinGeofence: true, mockLocationSuspected: !!mockLocationSuspected,
  });
  ok(res, result);
}

async function manualClockOut(req, res) {
  const { houseId, locationId, shiftId, timestamp, latitude, longitude, accuracy, capturedAt, mockLocationSuspected, locationSource } = req.body;
  if (!shiftId) return fail(res, 'shiftId required');

  const result = await clockService.clockOut(req.user.id, shiftId, 'MANUAL', {
    houseId, locationId, timestamp, latitude, longitude, accuracy, capturedAt, mockLocationSuspected, locationSource,
    agencyId: agencyIdFor(req),
  });

  if (result.rejected) return sendRejection(res, result);
  if (result.notClockedIn) return fail(res, 'No active clock-in found for this shift', 409, { code: 'NOT_CLOCKED_IN' });
  if (result.alreadyClockedOut) return fail(res, 'Already clocked out for this shift', 409, { code: 'ALREADY_CLOCKED_OUT' });

  await createAuditLog({
    ...auditContext(req),
    action: result.locationStatus === 'OFFSITE' ? 'MANUAL_OFFSITE_CLOCK_OUT' : 'MANUAL_ONSITE_CLOCK_OUT',
    entityType: 'ClockEvent',
    entityId: result.event.id,
    newValue: {
      shiftId, locationStatus: result.locationStatus,
      distanceMeters: result.event.distanceMeters, geofenceRadius: result.event.geofenceRadius,
      verification: result.verification,
    },
  });
  ok(res, result);
}

async function reportLocation(req, res) {
  const { shiftId, latitude, longitude, accuracy, capturedAt, mockLocationSuspected } = req.body;
  const result = await clockService.reportLocation(req.user.id, shiftId, {
    latitude, longitude, accuracy, capturedAt, mockLocationSuspected,
  }, agencyIdFor(req));

  if (result.active && Array.isArray(result.audits) && result.audits.length) {
    for (const action of result.audits) {
      await createAuditLog({
        ...auditContext(req),
        action,
        entityType: 'Shift',
        entityId: shiftId,
        newValue: { locationStatus: result.locationStatus, distanceMeters: result.distanceMeters },
      });
    }
  }
  ok(res, result);
}

async function confirmStillWorking(req, res) {
  const { shiftId } = req.body;
  const result = await clockService.confirmStillWorking(req.user.id, shiftId, agencyIdFor(req));
  if (result.active) {
    await createAuditLog({
      ...auditContext(req),
      action: 'WORKER_CONFIRMED_STILL_WORKING',
      entityType: 'Shift',
      entityId: shiftId,
      newValue: { shiftEndedAcknowledged: !!result.shiftEndedAcknowledged },
    });
  }
  ok(res, result);
}

async function getActiveSession(req, res) {
  ok(res, { session: await clockService.getActiveFlexibleSession(req.user.id, agencyIdFor(req)) });
}

async function getState(req, res) {
  const shiftId = req.query.shiftId;
  if (!shiftId) return fail(res, 'shiftId query parameter is required');
  const state = await clockService.getAttendanceState(req.user.id, String(shiftId), agencyIdFor(req));
  ok(res, state);
}

module.exports = { manualClockIn, manualClockOut, reportLocation, confirmStillWorking, getActiveSession, getState };
