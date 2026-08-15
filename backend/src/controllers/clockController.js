const clockService = require('../services/clockService');
const { auditContext, createAuditLog } = require('../services/auditService');
const { agencyIdFor } = require('../utils/agency');
const { ok, fail } = require('../utils/response');

async function manualClockIn(req, res) {
  const { houseId, shiftId, timestamp, latitude, longitude, accuracy, reason, locationSource } = req.body;
  if (!houseId || !shiftId) return fail(res, 'houseId and shiftId required');

  const result = await clockService.clockIn(req.user.id, houseId, shiftId, 'MANUAL', {
    timestamp,
    latitude,
    longitude,
    accuracy,
    reason,
    locationSource,
    agencyId: agencyIdFor(req),
  });
  if (result.forbidden) return fail(res, result.message, 403);
  if (result.alreadyClockedIn) return fail(res, 'Already clocked in for this shift');
  await createAuditLog({
    ...auditContext(req),
    action: 'MANUAL_CLOCK_IN',
    entityType: 'ClockEvent',
    entityId: result.event.id,
    newValue: result.event,
  });
  ok(res, result);
}

async function manualClockOut(req, res) {
  const { houseId, shiftId, timestamp, latitude, longitude, accuracy, reason, locationSource } = req.body;
  if (!houseId || !shiftId) return fail(res, 'houseId and shiftId required');

  const result = await clockService.clockOut(req.user.id, houseId, shiftId, 'MANUAL', {
    timestamp,
    latitude,
    longitude,
    accuracy,
    reason,
    locationSource,
    agencyId: agencyIdFor(req),
  });
  if (result.forbidden) return fail(res, result.message, 403);
  if (result.notClockedIn) return fail(res, 'No active clock-in found for this shift', 409);
  if (result.alreadyClockedOut) return fail(res, 'Already clocked out for this shift', 409);
  await createAuditLog({
    ...auditContext(req),
    action: 'MANUAL_CLOCK_OUT',
    entityType: 'ClockEvent',
    entityId: result.event.id,
    newValue: result.event,
  });
  ok(res, result);
}

async function autoCheckin(req, res) {
  const { latitude, longitude, accuracy } = req.body;
  if (latitude == null || longitude == null) return fail(res, 'latitude and longitude required');

  const results = await clockService.autoCheckin(req.user.id, latitude, longitude, accuracy, agencyIdFor(req));
  for (const result of results) {
    if (result.event?.id) {
      await createAuditLog({
        ...auditContext(req),
        action: 'AUTO_GPS_CLOCK_IN',
        entityType: 'ClockEvent',
        entityId: result.event.id,
        newValue: result.event,
      });
    }
  }
  ok(res, results);
}

async function geofenceExit(req, res) {
  const { latitude, longitude, accuracy } = req.body;
  if (latitude == null || longitude == null) return fail(res, 'latitude and longitude required');

  const results = await clockService.geofenceExit(req.user.id, latitude, longitude, accuracy, agencyIdFor(req));
  ok(res, results);
}

module.exports = { manualClockIn, manualClockOut, autoCheckin, geofenceExit };
