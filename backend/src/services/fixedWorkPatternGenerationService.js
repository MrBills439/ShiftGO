const prisma = require('../lib/prisma');
const agencyCache = require('../lib/agencyCache');
const { resolveTimeZone, zonedWallTimeToUtc, ymdInZone, agencyWeekRange } = require('../lib/agencyTime');
const { COUNTED_STATUSES, shiftHoursInWindow } = require('./staffAllocationService');
const { checkLeaveConflict } = require('./leaveRequestService');
const { calcPatternWeeklyHours } = require('./fixedWorkPatternService');

// Recurring Fixed Work Patterns V1 — Phase 2: generation engine.
//
// Materialises ACTIVE FixedWorkPattern rows into ordinary Shift rows
// (kind=FIXED, fixedWorkPatternId set). CREATE-ONLY: never updates, cancels,
// or deletes a Shift, Timesheet, ClockEvent, or AttendanceMonitor, and never
// touches a FixedWorkPattern/FixedWorkPatternDay row. Callable manually from
// tests/code only — NOT wired into src/jobs/scheduler.js in this phase.
//
// ─── Concurrency note ────────────────────────────────────────────────────
// Idempotency has two layers now:
//   1. An application-level check-then-create per occurrence, keyed on
//      (fixedWorkPatternId, date) — avoids an unnecessary insert attempt in
//      the overwhelmingly common (non-racing) case.
//   2. `@@unique([fixedWorkPatternId, date])` on Shift (schema.prisma) — the
//      AUTHORITATIVE backstop. If two generation calls ever race the same
//      occurrence, layer 1 cannot stop both of them (classic TOCTOU gap); the
//      database constraint always wins, the losing insert throws Prisma
//      P2002, and `isOccurrenceUniqueViolation` below turns that into an
//      ordinary SKIPPED_DUPLICATE result — never RESULT.ERROR, never a
//      crashed run. This is what makes the service safe to eventually call
//      from more than one Railway instance (still not wired into a cron job
//      in this phase).

const RESULT = {
  GENERATED: 'GENERATED',
  SKIPPED_DUPLICATE: 'SKIPPED_DUPLICATE', // a Shift for this occurrence already exists, any status
  SKIPPED_LEAVE: 'SKIPPED_LEAVE',
  SKIPPED_CONFLICT: 'SKIPPED_CONFLICT', // overlaps a different, unrelated Shift for this worker
  SKIPPED_INACTIVE_WORKER: 'SKIPPED_INACTIVE_WORKER',
  ERROR: 'ERROR',
};

const WALL_CLOCK_TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const round2 = (n) => Math.round(n * 100) / 100;

/** True only for a P2002 on Shift's specific (fixedWorkPatternId, date)
 *  constraint — never for an unrelated unique-constraint violation, which
 *  must still surface as a real error, matching the precision of the
 *  existing employmentService.rethrowP2002 / orgStructureService P2002 checks
 *  elsewhere in this codebase. */
function isOccurrenceUniqueViolation(err) {
  return err?.code === 'P2002' && Array.isArray(err.meta?.target) && err.meta.target.includes('fixedWorkPatternId') && err.meta.target.includes('date');
}

/** ISO-8601 weekday (1=Monday..7=Sunday) of a Y/M/D calendar date — matches
 *  FixedWorkPatternDay.weekday's documented convention. Computed via the same
 *  "noon UTC" trick agencyTime.js's agencyWeekRange uses, so it never depends
 *  on the server's local timezone. */
function isoWeekdayOf(year, month, day) {
  const jsDay = new Date(Date.UTC(year, month - 1, day, 12)).getUTCDay(); // 0=Sun..6=Sat
  return jsDay === 0 ? 7 : jsDay;
}

/** Numeric YYYYMMDD key for comparing/ordering Y/M/D calendar dates. */
function ymdKey({ year, month, day }) {
  return year * 10000 + month * 100 + day;
}

/** Y/M/D of a stored calendar-date column (Shift.date, FixedWorkPattern.
 *  effectiveFrom/effectiveTo) — these carry no meaningful time component (see
 *  their schema comments), so read the UTC calendar fields directly rather
 *  than reinterpreting them through a timezone (which could shift the date). */
function ymdOfCalendarDate(date) {
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

function ymdString({ year, month, day }) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Add `days` calendar days to a Y/M/D, letting Date.UTC normalise overflow. */
function addDays({ year, month, day }, days) {
  const d = new Date(Date.UTC(year, month - 1, day + days));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

function maxYmd(...candidates) {
  return candidates.filter(Boolean).reduce((max, c) => (ymdKey(c) > ymdKey(max) ? c : max));
}

function minYmd(...candidates) {
  const present = candidates.filter(Boolean);
  return present.reduce((min, c) => (ymdKey(c) < ymdKey(min) ? c : min));
}

/**
 * Sum of a worker's counted-shift hours inside [weekStart, weekEnd) that do
 * NOT belong to `patternId` — i.e. every OTHER shift (manual ROTA, manual
 * FIXED, or a different pattern) contributing to that agency week. Reuses
 * staffAllocationService's own exported status list / window-clipping math
 * rather than redefining them, so this always agrees with the weekly-hours
 * ceiling everywhere else in the app.
 */
async function otherWeeklyHours(workerId, agencyId, weekStart, weekEnd, patternId) {
  const shifts = await prisma.shift.findMany({
    where: {
      agencyId,
      workerId,
      status: { in: COUNTED_STATUSES },
      startTime: { lt: weekEnd },
      endTime: { gt: weekStart },
      OR: [{ fixedWorkPatternId: null }, { fixedWorkPatternId: { not: patternId } }],
    },
    select: { startTime: true, endTime: true },
  });
  return round2(shifts.reduce((sum, s) => sum + shiftHoursInWindow(s, weekStart, weekEnd), 0));
}

/**
 * Weekly-hours REVIEW classification for one occurrence — never throws, never
 * blocks creation (generation has no interactive actor to supply an override
 * reason to). Mirrors shiftService.assertWeeklyHoursOk's *ceiling*
 * (Agency.maxWeeklyScheduledHours) but not its interactive-override gate.
 *
 *   pattern's own weekly hours <= max                        -> never flagged
 *     (whatever else is going on that week is a pre-existing, separately
 *      reviewed situation — not something THIS pattern is responsible for)
 *   pattern's own weekly hours >  max                         -> never flagged
 *     (FixedWorkPatternDay/create+supersede already REQUIRE an authorised
 *      HR/MANAGER override + reason before an over-limit pattern version can
 *      exist at all — see fixedWorkPatternService.assertPatternWeeklyHoursOk.
 *      That approval was already given once, deliberately, for exactly this
 *      pattern version; generation must not re-litigate it every run.)
 *   pattern's own weekly hours <= max, but pattern + OTHER
 *   (manual/other-pattern) shifts that week > max             -> FLAGGED
 *     (this is hours nobody reviewed when the pattern was approved — surface
 *      it for HR, per "DO NOT auto-use an override for unrelated hours".)
 */
async function classifyWeeklyHours({ agencyId, agencyTimezone, maxWeeklyScheduledHours, workerId, patternId, patternWeeklyHours, occurrenceStart }) {
  if (patternWeeklyHours > maxWeeklyScheduledHours) return false; // already deliberately approved — see doc above
  const week = agencyWeekRange(agencyTimezone, occurrenceStart);
  const other = await otherWeeklyHours(workerId, agencyId, week.start, week.end, patternId);
  return round2(other + patternWeeklyHours) > maxWeeklyScheduledHours;
}

/**
 * Materialise ACTIVE FixedWorkPattern occurrences into real Shift rows.
 *
 * @param {object}  [opts]
 * @param {string}  [opts.agencyId]    limit to one agency; omitted = every agency
 * @param {string}  [opts.patternId]   limit to one pattern; omitted = every eligible pattern
 * @param {string}  [opts.fromDate]    'YYYY-MM-DD' floor for generation start (never earlier than today or effectiveFrom)
 * @param {number}  [opts.horizonDays] how many days ahead of today to generate (default 28 — the
 *                                     agreed rolling horizon for a future cron; this function does
 *                                     not itself schedule anything)
 */
async function generateFixedWorkPatternShifts({ agencyId, patternId, fromDate, horizonDays = 28 } = {}) {
  const summary = {
    patternsProcessed: 0,
    generated: 0,
    skippedDuplicate: 0,
    skippedLeave: 0,
    skippedInactiveWorker: 0,
    skippedConflict: 0,
    weeklyHoursReviewRequired: 0,
    errors: [],
    occurrences: [],
  };

  const requestedFromYmd = (() => {
    const m = typeof fromDate === 'string' && fromDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? { year: +m[1], month: +m[2], day: +m[3] } : null;
  })();

  const patterns = await prisma.fixedWorkPattern.findMany({
    where: {
      status: 'ACTIVE',
      ...(agencyId ? { agencyId } : {}),
      ...(patternId ? { id: patternId } : {}),
    },
    include: {
      worker: { select: { id: true, status: true } },
      location: { select: { id: true, timezone: true } },
      days: true,
    },
  });

  for (const pattern of patterns) {
    summary.patternsProcessed += 1;
    try {
      if (pattern.worker.status !== 'ACTIVE') {
        summary.skippedInactiveWorker += 1;
        summary.occurrences.push({
          patternId: pattern.id, workerId: pattern.workerId, date: null,
          status: RESULT.SKIPPED_INACTIVE_WORKER, reason: 'Worker is not ACTIVE',
        });
        continue;
      }

      const agency = await agencyCache.getAgencySettings(pattern.agencyId);
      const agencyTimezone = resolveTimeZone(agency?.timezone);
      const maxWeeklyScheduledHours = agency?.maxWeeklyScheduledHours ?? 60;
      // Effective timezone for THIS pattern's wall-clock day/start/end times:
      // pattern.timezone -> Location.timezone -> Agency.timezone. Distinct from
      // `agencyTimezone` above, which is always Agency.timezone specifically —
      // that is the one true definition of "the agency week" for the weekly-
      // hours ceiling (matches shiftService.assertWeeklyHoursOk exactly).
      const patternTimezone = resolveTimeZone(pattern.timezone || pattern.location.timezone || agency?.timezone);
      const patternWeeklyHours = calcPatternWeeklyHours(pattern.days);

      const todayYmd = ymdInZone(patternTimezone, new Date());
      const effectiveFromYmd = ymdOfCalendarDate(pattern.effectiveFrom);
      const effectiveToYmd = pattern.effectiveTo ? ymdOfCalendarDate(pattern.effectiveTo) : null;

      const startYmd = maxYmd(todayYmd, effectiveFromYmd, requestedFromYmd);
      const horizonEndYmd = addDays(todayYmd, horizonDays);
      const endYmd = effectiveToYmd ? minYmd(horizonEndYmd, effectiveToYmd) : horizonEndYmd;

      if (ymdKey(startYmd) > ymdKey(endYmd)) continue; // nothing to generate for this pattern right now

      const daysByWeekday = new Map(pattern.days.map((d) => [d.weekday, d]));

      let cursor = startYmd;
      while (ymdKey(cursor) <= ymdKey(endYmd)) {
        const weekday = isoWeekdayOf(cursor.year, cursor.month, cursor.day);
        const day = daysByWeekday.get(weekday);
        if (!day) {
          cursor = addDays(cursor, 1);
          continue; // not a configured working day for this pattern
        }

        const dateStr = ymdString(cursor);
        try {
          const occurrenceDate = new Date(Date.UTC(cursor.year, cursor.month - 1, cursor.day)); // matches Shift.date's calendar-date convention
          const [startH, startM] = day.startTime.split(':').map(Number);
          const [endH, endM] = day.endTime.split(':').map(Number);
          if (!WALL_CLOCK_TIME_RE.test(day.startTime) || !WALL_CLOCK_TIME_RE.test(day.endTime)) {
            throw new Error(`FixedWorkPatternDay ${day.id} has an invalid wall-clock time`);
          }
          const startTime = zonedWallTimeToUtc(patternTimezone, cursor.year, cursor.month, cursor.day, startH, startM);
          const endTime = zonedWallTimeToUtc(patternTimezone, cursor.year, cursor.month, cursor.day, endH, endM);

          // 1. Already handled? (generated earlier, manually edited, or
          //    cancelled — any status counts as "handled"; never regenerate.)
          const existingForOccurrence = await prisma.shift.findFirst({
            where: { fixedWorkPatternId: pattern.id, date: occurrenceDate },
            select: { id: true },
          });
          if (existingForOccurrence) {
            summary.skippedDuplicate += 1;
            summary.occurrences.push({ patternId: pattern.id, workerId: pattern.workerId, date: dateStr, status: RESULT.SKIPPED_DUPLICATE, reason: 'A Shift already exists for this occurrence' });
            cursor = addDays(cursor, 1);
            continue;
          }

          // 2. Overlaps a DIFFERENT shift for this worker (manual FIXED,
          //    manual ROTA, or another pattern)? Reuses the exact same
          //    worker-overlap shape as shiftService.createShift — kind-
          //    agnostic, so a ROTA overlap blocks generation exactly like a
          //    manual FIXED overlap does. Never mutates the other shift.
          const overlap = await prisma.shift.findFirst({
            where: {
              agencyId: pattern.agencyId,
              workerId: pattern.workerId,
              status: { not: 'CANCELLED' },
              startTime: { lt: endTime },
              endTime: { gt: startTime },
            },
            select: { id: true },
          });
          if (overlap) {
            summary.skippedConflict += 1;
            summary.occurrences.push({ patternId: pattern.id, workerId: pattern.workerId, date: dateStr, status: RESULT.SKIPPED_CONFLICT, reason: 'Overlaps an existing shift for this worker' });
            cursor = addDays(cursor, 1);
            continue;
          }

          // 3. Approved leave covering this occurrence? Never create; never
          //    touch the LeaveRequest.
          const leaveConflicts = await checkLeaveConflict(pattern.workerId, startTime, endTime, pattern.agencyId);
          if (leaveConflicts.length > 0) {
            summary.skippedLeave += 1;
            summary.occurrences.push({ patternId: pattern.id, workerId: pattern.workerId, date: dateStr, status: RESULT.SKIPPED_LEAVE, reason: 'Worker has approved leave during this occurrence' });
            cursor = addDays(cursor, 1);
            continue;
          }

          // 4. Weekly-hours review classification — informational only,
          //    never blocks creation (see classifyWeeklyHours doc above).
          const reviewRequired = await classifyWeeklyHours({
            agencyId: pattern.agencyId, agencyTimezone, maxWeeklyScheduledHours,
            workerId: pattern.workerId, patternId: pattern.id, patternWeeklyHours, occurrenceStart: startTime,
          });

          const shift = await prisma.shift.create({
            data: {
              agencyId: pattern.agencyId,
              kind: 'FIXED',
              locationId: pattern.locationId,
              workerId: pattern.workerId,
              fixedWorkPatternId: pattern.id,
              createdById: pattern.createdById, // the HR/MANAGER who set up this pattern — no other actor exists for a system-generated shift
              startTime,
              endTime,
              date: occurrenceDate,
              shiftType: 'LONG_DAY', // no FIXED-specific ShiftType exists; matches the default used by manual FIXED creation (Fixed Staff Scheduling V1)
            },
          });

          summary.generated += 1;
          if (reviewRequired) summary.weeklyHoursReviewRequired += 1;
          summary.occurrences.push({
            patternId: pattern.id, workerId: pattern.workerId, date: dateStr,
            status: RESULT.GENERATED, shiftId: shift.id, weeklyHoursReviewRequired: reviewRequired,
          });
        } catch (err) {
          // Lost the (fixedWorkPatternId, date) race to a concurrent generation
          // call — the DB-level backstop (@@unique([fixedWorkPatternId, date]),
          // see schema.prisma) caught what our own check-then-create pass
          // missed. This is an expected, benign outcome of the race, not a
          // real error: classify it exactly like the ordinary pre-check
          // duplicate path, never as RESULT.ERROR, and keep processing.
          if (isOccurrenceUniqueViolation(err)) {
            summary.skippedDuplicate += 1;
            summary.occurrences.push({ patternId: pattern.id, workerId: pattern.workerId, date: dateStr, status: RESULT.SKIPPED_DUPLICATE, reason: 'Lost a concurrent generation race for this occurrence' });
          } else {
            summary.errors.push({ patternId: pattern.id, workerId: pattern.workerId, date: dateStr, message: err.message });
            summary.occurrences.push({ patternId: pattern.id, workerId: pattern.workerId, date: dateStr, status: RESULT.ERROR, reason: err.message });
          }
        }
        cursor = addDays(cursor, 1);
      }
    } catch (err) {
      // A whole-pattern failure (e.g. agency lookup) must not abort other
      // patterns' generation.
      summary.errors.push({ patternId: pattern.id, workerId: pattern.workerId, date: null, message: err.message });
    }
  }

  return summary;
}

module.exports = { generateFixedWorkPatternShifts, RESULT };
