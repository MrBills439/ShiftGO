const prisma = require('../lib/prisma');
const agencyCache = require('../lib/agencyCache');
const { isValidTimeZone } = require('../lib/agencyTime');
const { createAuditLog } = require('./auditService');

// Recurring Fixed Work Patterns V1 — Phase 1: data model + pattern CRUD only.
// Nothing here creates, edits, or touches a Shift row. See
// backend/prisma/schema.prisma (FixedWorkPattern / FixedWorkPatternDay) for
// the data model this operates on.

// Same authorised-override roles as shiftService.WEEKLY_OVERRIDE_ROLES —
// duplicated here (rather than imported) because the two services validate
// different things (a pattern's own weekly hours vs. an actual shift
// assignment's projected weekly hours) and shouldn't be coupled just to share
// one constant. Keep them in sync if this ever changes.
const WEEKLY_OVERRIDE_ROLES = ['MANAGER', 'HR'];

const WEEKDAY_MIN = 1;
const WEEKDAY_MAX = 7; // ISO-8601: 1=Monday .. 7=Sunday — see schema.prisma.
const WALL_CLOCK_TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

// Sentinel "end of time" for open-ended (`effectiveTo: null`) range-overlap
// comparisons — never persisted, comparison-only.
const OPEN_ENDED_SENTINEL = new Date('9999-12-31T00:00:00.000Z');

const patternInclude = {
  worker: { select: { id: true, name: true, email: true, status: true } },
  location: { select: { id: true, name: true, active: true, timezone: true } },
  createdBy: { select: { id: true, name: true } },
  overrideBy: { select: { id: true, name: true } },
  days: { orderBy: { weekday: 'asc' } },
  supersedes: { select: { id: true, effectiveFrom: true, effectiveTo: true } },
  supersededBy: { select: { id: true, effectiveFrom: true } },
};

function badRequest(message, code) {
  const err = new Error(message);
  err.statusCode = 400;
  if (code) err.code = code;
  return err;
}

function statusConflict(message, code) {
  const err = new Error(message);
  err.statusCode = 409;
  if (code) err.code = code;
  return err;
}

function forbidden(message, code) {
  const err = new Error(message);
  err.statusCode = 403;
  if (code) err.code = code;
  return err;
}

function notFound(message = 'Fixed work pattern not found') {
  const err = new Error(message);
  err.statusCode = 404;
  return err;
}

const round2 = (n) => Math.round(n * 100) / 100;

function wallClockMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/**
 * Business-rule validation of the `days` array — re-checked here regardless
 * of validators.js (structural array/format checks) so this service is safe
 * to call directly (e.g. from tests) and never trusts the HTTP layer alone,
 * matching shiftService.assertShiftAttendanceTarget's own re-validation.
 * Returns a normalised `[{ weekday, startTime, endTime }]`, sorted by weekday.
 */
function normalizeDays(rawDays) {
  if (!Array.isArray(rawDays) || rawDays.length === 0) {
    throw badRequest('At least one working day is required', 'NO_WORKING_DAYS');
  }
  const seen = new Set();
  const days = rawDays.map((d) => {
    const weekday = Number(d?.weekday);
    if (!Number.isInteger(weekday) || weekday < WEEKDAY_MIN || weekday > WEEKDAY_MAX) {
      throw badRequest('weekday must be 1 (Monday) to 7 (Sunday)', 'INVALID_WEEKDAY');
    }
    if (seen.has(weekday)) {
      throw badRequest('A pattern cannot have two entries for the same weekday', 'DUPLICATE_WEEKDAY');
    }
    seen.add(weekday);

    const startTime = String(d?.startTime ?? '');
    const endTime = String(d?.endTime ?? '');
    if (!WALL_CLOCK_TIME_RE.test(startTime) || !WALL_CLOCK_TIME_RE.test(endTime)) {
      throw badRequest('startTime/endTime must be a 24h "HH:MM" wall-clock time', 'INVALID_TIME');
    }
    if (wallClockMinutes(endTime) <= wallClockMinutes(startTime)) {
      throw badRequest('endTime must be after startTime — overnight patterns are not supported yet', 'OVERNIGHT_NOT_SUPPORTED');
    }
    return { weekday, startTime, endTime };
  });
  return days.sort((a, b) => a.weekday - b.weekday);
}

/** Sum of one week's hours across a normalised `days` array. */
function calcPatternWeeklyHours(days) {
  return round2(
    days.reduce((sum, d) => sum + (wallClockMinutes(d.endTime) - wallClockMinutes(d.startTime)) / 60, 0),
  );
}

/**
 * Pattern-version weekly-hours ceiling check — mirrors the philosophy of
 * shiftService.assertWeeklyHoursOk (warn → require an authorised override +
 * reason → audit it) but against the PATTERN's own declared weekly hours
 * (sum of its `days`), not a worker's actual scheduled shifts — there are no
 * shifts yet in Phase 1. Returns the fields to persist on the pattern row
 * itself (so a later reader never needs to join AuditLog to know a version
 * was a deliberate, reasoned decision) plus an `applyOverrideAudit(patternId)`
 * callback to invoke once the row exists.
 */
async function assertPatternWeeklyHoursOk({ agencyId, days, data = {}, actor }) {
  const agency = await agencyCache.getAgencySettings(agencyId);
  const maxWeeklyScheduledHours = agency?.maxWeeklyScheduledHours ?? 60;
  const weeklyHours = calcPatternWeeklyHours(days);

  const noOverrideFields = { overrideWeeklyLimit: false, overrideReason: null, overrideById: null };

  if (weeklyHours <= maxWeeklyScheduledHours) {
    return { weeklyHours, maxWeeklyScheduledHours, overrideFields: noOverrideFields, applyOverrideAudit: null };
  }

  const details = { weeklyHours, maxWeeklyScheduledHours };
  const wantsOverride = data.overrideWeeklyLimit === true || data.overrideWeeklyLimit === 'true';

  if (!wantsOverride) {
    const err = new Error(
      `This pattern's weekly hours (${weeklyHours}h) exceed the agency limit of ${maxWeeklyScheduledHours}h. A manager or HR must approve it with a reason.`,
    );
    err.statusCode = 409;
    err.code = 'APPROVAL_REQUIRED';
    err.details = details;
    throw err;
  }

  if (!actor || !WEEKLY_OVERRIDE_ROLES.includes(actor.role)) {
    const err = new Error('You are not authorised to override the agency weekly hours limit.');
    err.statusCode = 403;
    err.code = 'OVERRIDE_NOT_PERMITTED';
    err.details = details;
    throw err;
  }

  const reason = (data.overrideReason || '').trim();
  if (reason.length < 3) {
    const err = new Error('An override reason is required to create a pattern over the agency weekly hours limit.');
    err.statusCode = 400;
    err.code = 'OVERRIDE_REASON_REQUIRED';
    err.details = details;
    throw err;
  }

  return {
    weeklyHours,
    maxWeeklyScheduledHours,
    overrideFields: { overrideWeeklyLimit: true, overrideReason: reason, overrideById: actor.id },
    applyOverrideAudit: async (patternId) => {
      await createAuditLog({
        agencyId,
        actorId: actor.id,
        actorRole: actor.role,
        action: 'FIXED_WORK_PATTERN_WEEKLY_HOURS_OVERRIDE',
        entityType: 'FixedWorkPattern',
        entityId: patternId,
        newValue: {
          patternId,
          weeklyHours,
          maxWeeklyScheduledHours,
          reason,
          approvedById: actor.id,
          approvedByRole: actor.role,
          approvedAt: new Date().toISOString(),
        },
      });
    },
  };
}

/**
 * A worker may not have two ACTIVE patterns whose effective periods overlap.
 * Only ACTIVE patterns are considered — an ENDED/SUPERSEDED pattern always has
 * a closed (non-null) effectiveTo by the time it reaches that status, so it
 * can never conflict with a new one. `excludePatternId` drops the pattern
 * being superseded (it is about to stop being ACTIVE in the same transaction).
 */
async function assertNoConflictingActivePattern({ agencyId, workerId, effectiveFrom, effectiveTo, excludePatternId = null }) {
  const activePatterns = await prisma.fixedWorkPattern.findMany({
    where: {
      agencyId,
      workerId,
      status: 'ACTIVE',
      ...(excludePatternId ? { id: { not: excludePatternId } } : {}),
    },
    select: { id: true, effectiveFrom: true, effectiveTo: true },
  });

  const newEnd = effectiveTo ?? OPEN_ENDED_SENTINEL;
  const conflict = activePatterns.find((p) => {
    const existingEnd = p.effectiveTo ?? OPEN_ENDED_SENTINEL;
    return p.effectiveFrom <= newEnd && existingEnd >= effectiveFrom;
  });
  if (conflict) {
    throw statusConflict(
      'This employee already has an active fixed work pattern covering part of this period',
      'FIXED_WORK_PATTERN_CONFLICT',
    );
  }
}

/** Agency-scoped worker + Location existence/status checks shared by create
 *  and supersede. `requireWorker` is false for supersede (worker is fixed —
 *  taken from the pattern being replaced, never re-validated/changed). */
async function loadAndValidateTargets({ agencyId, workerId, locationId }) {
  const [worker, location] = await Promise.all([
    workerId ? prisma.user.findFirst({ where: { id: workerId, agencyId } }) : null,
    prisma.location.findFirst({ where: { id: locationId, agencyId } }),
  ]);

  if (workerId) {
    if (!worker) throw forbidden('Employee must belong to your agency', 'WORKER_NOT_IN_AGENCY');
    if (worker.status !== 'ACTIVE') throw forbidden('Employee must be an active employee', 'WORKER_NOT_ACTIVE');
  }
  if (!location) throw forbidden('Location must belong to your agency', 'LOCATION_NOT_IN_AGENCY');
  if (!location.active) throw badRequest('Location must be active', 'LOCATION_INACTIVE');

  return { worker, location };
}

function assertValidTimezone(timezone) {
  if (timezone && !isValidTimeZone(timezone)) {
    throw badRequest('timezone must be a valid IANA timezone', 'INVALID_TIMEZONE');
  }
}

function parseEffectiveRange(data) {
  const effectiveFrom = new Date(data.effectiveFrom);
  if (Number.isNaN(effectiveFrom.getTime())) {
    throw badRequest('effectiveFrom must be a valid date', 'INVALID_EFFECTIVE_FROM');
  }
  let effectiveTo = null;
  if (data.effectiveTo !== undefined && data.effectiveTo !== null && data.effectiveTo !== '') {
    effectiveTo = new Date(data.effectiveTo);
    if (Number.isNaN(effectiveTo.getTime())) {
      throw badRequest('effectiveTo must be a valid date', 'INVALID_EFFECTIVE_TO');
    }
    if (effectiveTo < effectiveFrom) {
      throw badRequest('effectiveTo must be on or after effectiveFrom', 'INVALID_EFFECTIVE_RANGE');
    }
  }
  return { effectiveFrom, effectiveTo };
}

async function listPatterns(agencyId, filters = {}) {
  const { workerId, status, locationId } = filters;
  return prisma.fixedWorkPattern.findMany({
    where: {
      agencyId,
      ...(workerId ? { workerId } : {}),
      ...(status ? { status } : {}),
      ...(locationId ? { locationId } : {}),
    },
    include: patternInclude,
    orderBy: [{ workerId: 'asc' }, { effectiveFrom: 'desc' }],
  });
}

async function getPatternById(id, agencyId) {
  const pattern = await prisma.fixedWorkPattern.findFirst({ where: { id, agencyId }, include: patternInclude });
  if (!pattern) throw notFound();
  return pattern;
}

/** HR/MANAGER creates a brand-new pattern for an ACTIVE employee. */
async function createPattern(data, createdById, agencyId, actor) {
  const { effectiveFrom, effectiveTo } = parseEffectiveRange(data);
  const days = normalizeDays(data.days);
  assertValidTimezone(data.timezone);

  await loadAndValidateTargets({ agencyId, workerId: data.workerId, locationId: data.locationId });
  await assertNoConflictingActivePattern({ agencyId, workerId: data.workerId, effectiveFrom, effectiveTo });

  const hours = await assertPatternWeeklyHoursOk({ agencyId, days, data, actor });

  const pattern = await prisma.fixedWorkPattern.create({
    data: {
      agencyId,
      workerId: data.workerId,
      locationId: data.locationId,
      timezone: data.timezone || null,
      effectiveFrom,
      effectiveTo,
      createdById,
      ...hours.overrideFields,
      days: { create: days },
    },
    include: patternInclude,
  });

  if (hours.applyOverrideAudit) await hours.applyOverrideAudit(pattern.id);
  return pattern;
}

/**
 * Replace an ACTIVE pattern with a new version, effective from a given date.
 * Transactional: the old pattern's effectiveTo/status and the new pattern's
 * creation either both happen or neither does. The old pattern's `days` rows
 * are never touched — only the parent row's effectiveTo/status change.
 */
async function supersedePattern(id, data, actorId, agencyId, actor) {
  const oldPattern = await prisma.fixedWorkPattern.findFirst({ where: { id, agencyId } });
  if (!oldPattern) throw notFound();
  if (oldPattern.status !== 'ACTIVE') {
    throw statusConflict('Only an ACTIVE pattern can be superseded', 'FIXED_WORK_PATTERN_NOT_ACTIVE');
  }

  const { effectiveFrom: newEffectiveFrom, effectiveTo: newEffectiveTo } = parseEffectiveRange(data);
  if (newEffectiveFrom <= oldPattern.effectiveFrom) {
    throw badRequest('The new version must take effect after the current version started', 'INVALID_SUPERSEDE_DATE');
  }
  const days = normalizeDays(data.days);
  assertValidTimezone(data.timezone);

  // Worker is NOT re-validated/changeable here — it is the same employee the
  // old pattern already belongs to. Location is re-validated: a supersede is
  // exactly the mechanism for e.g. an employee's Location changing.
  await loadAndValidateTargets({ agencyId, locationId: data.locationId });
  await assertNoConflictingActivePattern({
    agencyId, workerId: oldPattern.workerId, effectiveFrom: newEffectiveFrom, effectiveTo: newEffectiveTo, excludePatternId: oldPattern.id,
  });

  const hours = await assertPatternWeeklyHoursOk({ agencyId, days, data, actor });

  // The old version's own effective range ends the day before the new one
  // starts — a plain calendar-day subtraction, since effectiveFrom/effectiveTo
  // are calendar dates (no meaningful time component), not timezone-sensitive
  // instants.
  const oldEffectiveTo = new Date(newEffectiveFrom.getTime() - 24 * 60 * 60 * 1000);

  const { newPattern } = await prisma.$transaction(async (tx) => {
    const created = await tx.fixedWorkPattern.create({
      data: {
        agencyId,
        workerId: oldPattern.workerId,
        locationId: data.locationId,
        timezone: data.timezone || null,
        effectiveFrom: newEffectiveFrom,
        effectiveTo: newEffectiveTo,
        createdById: actorId,
        supersedesId: oldPattern.id,
        ...hours.overrideFields,
        days: { create: days },
      },
      include: patternInclude,
    });
    await tx.fixedWorkPattern.update({
      where: { id: oldPattern.id },
      data: { effectiveTo: oldEffectiveTo, status: 'SUPERSEDED' },
    });
    return { newPattern: created };
  });

  if (hours.applyOverrideAudit) await hours.applyOverrideAudit(newPattern.id);

  const refreshedOldPattern = await prisma.fixedWorkPattern.findFirst({ where: { id: oldPattern.id }, include: patternInclude });
  return { oldPattern: refreshedOldPattern, newPattern };
}

/** HR/MANAGER explicitly ends an ACTIVE pattern. Never deletes it, never
 *  touches any Shift. */
async function endPattern(id, data, agencyId) {
  const pattern = await prisma.fixedWorkPattern.findFirst({ where: { id, agencyId } });
  if (!pattern) throw notFound();
  if (pattern.status !== 'ACTIVE') {
    throw statusConflict('Only an ACTIVE pattern can be ended', 'FIXED_WORK_PATTERN_NOT_ACTIVE');
  }

  const effectiveTo = new Date(data.effectiveTo);
  if (Number.isNaN(effectiveTo.getTime())) {
    throw badRequest('effectiveTo must be a valid date', 'INVALID_EFFECTIVE_TO');
  }
  if (effectiveTo < pattern.effectiveFrom) {
    throw badRequest('effectiveTo must be on or after the pattern\'s effectiveFrom', 'INVALID_EFFECTIVE_RANGE');
  }

  return prisma.fixedWorkPattern.update({
    where: { id },
    data: { effectiveTo, status: 'ENDED' },
    include: patternInclude,
  });
}

module.exports = {
  listPatterns,
  getPatternById,
  createPattern,
  supersedePattern,
  endPattern,
  // exported for focused unit testing of the pure business rules
  normalizeDays,
  calcPatternWeeklyHours,
};
