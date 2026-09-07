/**
 * Tiny in-process cache for Agency *settings* only — the handful of
 * slow-changing scalar fields (name, timezone, weekly-hours ceiling) that are
 * re-read on nearly every dashboard load, staff-allocation call, and shift
 * assignment. These change only through PATCH /agency or the Clerk
 * organization.updated webhook, both of which call invalidate() below.
 *
 * NOT a general query cache: it never holds shifts, timesheets, clock state,
 * users, or anything operational. A 60s TTL bounds staleness even if an
 * invalidation path is ever missed. The Map is bounded by the number of
 * agencies (tiny) and is per-process (no shared cache, no Redis).
 */
const prisma = require('./prisma');

const TTL_MS = 60_000;
const SELECT = { id: true, name: true, timezone: true, maxWeeklyScheduledHours: true };

const cache = new Map(); // agencyId -> { value, expiresAt }

async function getAgencySettings(agencyId) {
  const hit = cache.get(agencyId);
  if (hit && hit.expiresAt > Date.now()) return hit.value;

  const value = await prisma.agency.findUnique({ where: { id: agencyId }, select: SELECT });
  if (value) cache.set(agencyId, { value, expiresAt: Date.now() + TTL_MS });
  return value;
}

function invalidate(agencyId) {
  if (agencyId) cache.delete(agencyId);
}

function invalidateAll() {
  cache.clear();
}

module.exports = { getAgencySettings, invalidate, invalidateAll, SELECT };
