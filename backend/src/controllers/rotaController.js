const shiftService = require('../services/shiftService');
const { agencyIdFor } = require('../utils/agency');
const { ok } = require('../utils/response');
const agencyCache = require('../lib/agencyCache');
const { resolveTimeZone, zonedWallTimeToUtc } = require('../lib/agencyTime');

/**
 * [start, end) UTC instants covering `days` agency calendar days from the
 * "YYYY-MM-DD" date in the agency's timezone. Shifts are stored as real
 * instants, so a shift at 00:30 BST (23:30 UTC the day before) still belongs
 * to the agency day it starts on.
 */
async function agencyDaysRange(agencyId, dateStr, days) {
  const agency = await agencyCache.getAgencySettings(agencyId);
  const tz = resolveTimeZone(agency?.timezone);
  const m = typeof dateStr === 'string' && dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
  const d = m ? { y: +m[1], mo: +m[2], da: +m[3] } : (() => {
    const now = new Date(dateStr || Date.now());
    return { y: now.getUTCFullYear(), mo: now.getUTCMonth() + 1, da: now.getUTCDate() };
  })();
  return {
    start: zonedWallTimeToUtc(tz, d.y, d.mo, d.da),
    end: zonedWallTimeToUtc(tz, d.y, d.mo, d.da + days),
  };
}

async function week(req, res) {
  const { start, end } = await agencyDaysRange(agencyIdFor(req), req.query.startDate, 7);
  const { workerId, houseId, status, shiftType } = req.query;
  const rota = await shiftService.listRotaForUser(req.user, agencyIdFor(req), {
    startDate: start.toISOString(),
    endDate: end.toISOString(),
    workerId,
    houseId,
    status,
    shiftType,
  });
  ok(res, rota);
}

async function day(req, res) {
  const { start, end } = await agencyDaysRange(agencyIdFor(req), req.query.date, 1);
  const { workerId, houseId, status, shiftType } = req.query;
  const rota = await shiftService.listRotaForUser(req.user, agencyIdFor(req), {
    startDate: start.toISOString(),
    endDate: end.toISOString(),
    workerId,
    houseId,
    status,
    shiftType,
  });
  ok(res, rota);
}

async function me(req, res) {
  const rota = await shiftService.listRotaForUser(req.user, agencyIdFor(req), {
    workerId: req.user.id,
  });
  ok(res, rota);
}

module.exports = { week, day, me };
