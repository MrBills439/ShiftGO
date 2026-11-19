/**
 * Show an instant as the agency's wall clock in server-written text (push
 * notifications, PDFs). The server runs in UTC, so Date#toLocaleString without
 * a timeZone would show 08:00 for a 09:00 BST shift.
 */
const agencyCache = require('./agencyCache');
const { resolveTimeZone } = require('./agencyTime');

async function agencyTimeZone(agencyId) {
  if (!agencyId) return resolveTimeZone(null);
  const agency = await agencyCache.getAgencySettings(agencyId);
  return resolveTimeZone(agency?.timezone);
}

function formatInZone(instant, timeZone, opts) {
  return new Date(instant).toLocaleString('en-GB', { ...opts, timeZone: resolveTimeZone(timeZone) });
}

/** "Thu 19 Nov, 09:00" in the agency's timezone. */
function shiftStartLabel(instant, timeZone) {
  return formatInZone(instant, timeZone, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
}

/**
 * One timezone per agency for shift times in this release. Refuse to SAVE a
 * Location or work pattern timezone that differs from the agency's (existing
 * rows are never changed; generation blocks them instead). Empty = inherit.
 */
async function assertAgencyTimezone(agencyId, timezone, what = 'This timezone') {
  if (!timezone) return;
  const agencyTz = await agencyTimeZone(agencyId);
  if (timezone !== agencyTz) {
    const err = new Error(`${what} (${timezone}) differs from the agency timezone (${agencyTz}). Different timezones aren't supported yet: leave it blank to use the agency timezone.`);
    err.statusCode = 400;
    err.code = 'TIMEZONE_NOT_SUPPORTED';
    throw err;
  }
}

module.exports = { agencyTimeZone, formatInZone, shiftStartLabel, assertAgencyTimezone };
