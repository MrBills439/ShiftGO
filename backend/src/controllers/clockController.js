const clockService = require('../services/clockService');
const { ok, fail } = require('../utils/response');

async function manualClockIn(req, res) {
  const { houseId, shiftId } = req.body;
  if (!houseId || !shiftId) return fail(res, 'houseId and shiftId required');

  const result = await clockService.clockIn(req.user.id, houseId, shiftId, 'MANUAL');
  if (result.alreadyClockedIn) return fail(res, 'Already clocked in for this shift');
  ok(res, result);
}

async function manualClockOut(req, res) {
  const { houseId, shiftId } = req.body;
  if (!houseId || !shiftId) return fail(res, 'houseId and shiftId required');

  const result = await clockService.clockOut(req.user.id, houseId, shiftId, 'MANUAL');
  if (result.notClockedIn) return fail(res, 'No active clock-in found for this shift');
  ok(res, result);
}

async function autoCheckin(req, res) {
  const { latitude, longitude } = req.body;
  if (latitude == null || longitude == null) return fail(res, 'latitude and longitude required');

  const results = await clockService.autoCheckin(req.user.id, latitude, longitude);
  ok(res, results);
}

async function geofenceExit(req, res) {
  const { latitude, longitude } = req.body;
  if (latitude == null || longitude == null) return fail(res, 'latitude and longitude required');

  const results = await clockService.geofenceExit(req.user.id, latitude, longitude);
  ok(res, results);
}

module.exports = { manualClockIn, manualClockOut, autoCheckin, geofenceExit };
