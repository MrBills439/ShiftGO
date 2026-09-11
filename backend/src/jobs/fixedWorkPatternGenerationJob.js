const logger = require('../lib/logger');
const { generateFixedWorkPatternShifts } = require('../services/fixedWorkPatternGenerationService');

// Recurring Fixed Work Patterns V1 — Phase 3: the scheduled rolling top-up.
//
// This file owns NOTHING about generation itself — no Shift/pattern queries,
// no timezone math, no idempotency logic. All of that already lives in (and
// is already fully tested in) fixedWorkPatternGenerationService.js. This file
// only: (1) guards against two overlapping runs inside this one Node process,
// (2) calls the service with the agreed 28-day horizon, (3) logs a structured
// summary, and (4) never lets a failure escape and crash the process.
//
// Multi-instance safety: this in-process flag says nothing about two
// different Railway instances running this job at the same moment — nothing
// here needs to, because Phase 2's @@unique([fixedWorkPatternId, date])
// constraint plus the service's P2002 -> SKIPPED_DUPLICATE handling already
// make that safe at the database level, regardless of how many processes
// call the service concurrently.

let running = false;

/**
 * Runs one rolling 28-day top-up pass across every agency. Safe to call
 * directly (tests, a future manual-trigger endpoint) as well as from the
 * cron schedule in scheduler.js. Never throws — a failure is logged and
 * swallowed so a bad run never takes the web process down with it.
 */
async function runFixedWorkPatternGenerationJob() {
  if (running) {
    logger.warn('FIXED_WORK_PATTERN_GENERATION_SKIPPED_OVERLAP', {
      reason: 'a previous fixed work pattern generation run is still in progress in this process',
    });
    return;
  }

  running = true;
  const startedAt = Date.now();
  try {
    const result = await generateFixedWorkPatternShifts({ horizonDays: 28 });
    const durationMs = Date.now() - startedAt;
    const summary = {
      patternsProcessed: result.patternsProcessed,
      generated: result.generated,
      skippedDuplicate: result.skippedDuplicate,
      skippedLeave: result.skippedLeave,
      skippedInactiveWorker: result.skippedInactiveWorker,
      skippedConflict: result.skippedConflict,
      weeklyHoursReviewRequired: result.weeklyHoursReviewRequired,
      errorCount: result.errors.length,
      durationMs,
    };

    // No PII, no Shift/User object dumps — counts and an id/date/message
    // trail only, matching how the service's own `errors[]` is already
    // shaped (patternId, workerId, date, message — no name/email).
    if (result.errors.length > 0) {
      logger.warn('FIXED_WORK_PATTERN_GENERATION_COMPLETED', { ...summary, errors: result.errors });
    } else {
      logger.info('FIXED_WORK_PATTERN_GENERATION_COMPLETED', summary);
    }

    // Visibility only — Phase 3 builds no review table/UI and never mutates
    // or cancels a shift over this; HR-facing surfacing is a later phase.
    if (summary.weeklyHoursReviewRequired > 0) {
      logger.warn('FIXED_WORK_PATTERN_GENERATION_WEEKLY_HOURS_REVIEW', {
        weeklyHoursReviewRequired: summary.weeklyHoursReviewRequired,
      });
    }
  } catch (err) {
    logger.error('FIXED_WORK_PATTERN_GENERATION_FAILED', {
      message: err.message,
      durationMs: Date.now() - startedAt,
    });
  } finally {
    running = false;
  }
}

module.exports = {
  runFixedWorkPatternGenerationJob,
  // Testability/observability only — never used to gate business logic.
  isFixedWorkPatternGenerationRunning: () => running,
};
