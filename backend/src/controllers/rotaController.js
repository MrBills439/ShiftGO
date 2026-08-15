const shiftService = require('../services/shiftService');
const { agencyIdFor } = require('../utils/agency');
const { ok } = require('../utils/response');

function addDays(date, days) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function startOfUtcDay(value) {
  const date = new Date(value);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

async function week(req, res) {
  const start = startOfUtcDay(req.query.startDate);
  const end = addDays(start, 7);
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
  const start = startOfUtcDay(req.query.date);
  const end = addDays(start, 1);
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
