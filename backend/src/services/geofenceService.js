const { attendanceConfigFor } = require('../config/attendance');

const EARTH_RADIUS_M = 6371000;

function toRad(deg) {
  return (deg * Math.PI) / 180;
}

/** Haversine distance in metres. */
function distanceMetres(lat1, lon1, lat2, lon2) {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function isInsideGeofence(workerLat, workerLon, houseLat, houseLon, radiusM) {
  return distanceMetres(workerLat, workerLon, houseLat, houseLon) <= radiusM;
}

/** Structurally valid WGS84 coordinate. */
function isValidCoordinate(lat, lon, { rejectNullIsland = true } = {}) {
  if (typeof lat !== 'number' || typeof lon !== 'number') return false;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return false;
  if (rejectNullIsland && lat === 0 && lon === 0) return false;
  return true;
}

/** ms between a device capture time and now; null if capturedAt is absent/unparseable. */
function locationAgeMs(capturedAt, now = Date.now()) {
  if (!capturedAt) return null;
  const t = new Date(capturedAt).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.max(0, now - t);
}

/**
 * Server-side geofence evaluation. The mobile client never decides "inside" —
 * it only reports raw coordinates + accuracy + capture time.
 *
 * `target` is the resolved attendance target (services/attendanceTargetService):
 * `{ latitude, longitude, geofenceRadius, ... }`. A House-backed target carries
 * the House's own coordinates + radius, so the distance / radius / onsite
 * classification / error codes are byte-for-byte identical to the previous
 * House-only signature. The same maths applies to a Location-backed target.
 *
 * @returns {{
 *   ok: boolean,               // coordinates usable at all
 *   code: string|null,         // failure reason code when !ok / not verifiable
 *   distanceMeters: number|null,
 *   radiusM: number,
 *   effectiveRadiusM: number,  // radius + accuracy slack
 *   withinGeofence: boolean|null,
 *   accuracySufficient: boolean,
 *   stale: boolean,
 *   ageMs: number|null,
 *   locationStatus: 'ONSITE'|'OFFSITE'|'UNKNOWN',
 * }}
 */
function evaluateLocation({ latitude, longitude, accuracy, capturedAt, target, now = Date.now() }) {
  const cfg = attendanceConfigFor(target);
  const radiusM = cfg.geofenceRadiusM;

  const base = {
    ok: false,
    code: null,
    distanceMeters: null,
    radiusM,
    effectiveRadiusM: radiusM,
    withinGeofence: null,
    accuracySufficient: false,
    stale: false,
    ageMs: null,
    locationStatus: 'UNKNOWN',
  };

  if (!isValidCoordinate(latitude, longitude, { rejectNullIsland: cfg.rejectNullIsland })) {
    return { ...base, code: 'INVALID_COORDINATES' };
  }

  const ageMs = locationAgeMs(capturedAt, now);
  const stale = ageMs != null && ageMs > cfg.maxLocationAgeMs;
  if (stale) {
    return { ...base, code: 'STALE_LOCATION', stale: true, ageMs };
  }

  const distanceMeters = Math.round(
    distanceMetres(latitude, longitude, target.latitude, target.longitude),
  );

  const acc = typeof accuracy === 'number' && Number.isFinite(accuracy) ? accuracy : null;
  const accuracySufficient = acc != null && acc <= cfg.maxAccuracyForGeofenceM;
  const slack = acc != null ? Math.min(acc, cfg.accuracySlackCapM) : 0;
  const effectiveRadiusM = radiusM + slack;
  const withinGeofence = distanceMeters <= effectiveRadiusM;

  if (!accuracySufficient) {
    // We still return the distance for the audit trail, but the decision is
    // "not verifiable" — callers must not clock a worker in on this.
    return {
      ...base,
      ok: true,
      code: 'GPS_ACCURACY_INSUFFICIENT',
      distanceMeters,
      effectiveRadiusM,
      withinGeofence,
      accuracySufficient: false,
      ageMs,
      locationStatus: 'UNKNOWN',
    };
  }

  return {
    ok: true,
    code: null,
    distanceMeters,
    radiusM,
    effectiveRadiusM,
    withinGeofence,
    accuracySufficient: true,
    stale: false,
    ageMs,
    locationStatus: withinGeofence ? 'ONSITE' : 'OFFSITE',
  };
}

module.exports = {
  distanceMetres,
  isInsideGeofence,
  isValidCoordinate,
  locationAgeMs,
  evaluateLocation,
};
