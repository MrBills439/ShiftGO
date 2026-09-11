process.env.NODE_ENV = 'test';

const path = require('path');
const fs = require('fs');

// Recurring Fixed Work Patterns V1 — Phase 3: the scheduler wiring + the
// daily top-up job. Entirely unit-level — the generation service itself is
// mocked throughout (its real behaviour is already covered end-to-end,
// against a real database, by tests/fixedWorkPatternGeneration.test.js,
// which this file never touches or duplicates).

function baseResult(overrides = {}) {
  return {
    patternsProcessed: 0,
    generated: 0,
    skippedDuplicate: 0,
    skippedLeave: 0,
    skippedInactiveWorker: 0,
    skippedConflict: 0,
    weeklyHoursReviewRequired: 0,
    errors: [],
    occurrences: [],
    ...overrides,
  };
}

describe('fixedWorkPatternGenerationJob — the daily top-up job itself', () => {
  let mockGenerate;

  beforeEach(() => {
    jest.resetModules();
    mockGenerate = jest.fn();
    jest.doMock('../src/services/fixedWorkPatternGenerationService', () => ({
      generateFixedWorkPatternShifts: mockGenerate,
    }));
  });

  afterEach(() => {
    jest.dontMock('../src/services/fixedWorkPatternGenerationService');
    jest.resetModules();
  });

  function loadJob() {
    return require('../src/jobs/fixedWorkPatternGenerationJob');
  }

  it('3. calls the generation service with horizonDays: 28 and no historical backfill options', async () => {
    mockGenerate.mockResolvedValue(baseResult());
    const { runFixedWorkPatternGenerationJob } = loadJob();
    await runFixedWorkPatternGenerationJob();
    expect(mockGenerate).toHaveBeenCalledTimes(1);
    expect(mockGenerate).toHaveBeenCalledWith(expect.objectContaining({ horizonDays: 28 }));
    const callArg = mockGenerate.mock.calls[0][0];
    expect(callArg.fromDate).toBeUndefined(); // no explicit floor -> service's own "never before today" rule applies
  });

  it('4/5/6/7/8/9/10. a successful run logs a structured summary with every field', async () => {
    const logger = require('../src/lib/logger');
    const infoSpy = jest.spyOn(logger, 'info').mockImplementation(() => {});
    mockGenerate.mockResolvedValue(baseResult({
      patternsProcessed: 3, generated: 5, skippedDuplicate: 1, skippedLeave: 2,
      skippedInactiveWorker: 1, skippedConflict: 1, weeklyHoursReviewRequired: 0,
    }));
    const { runFixedWorkPatternGenerationJob } = loadJob();
    await runFixedWorkPatternGenerationJob();

    expect(infoSpy).toHaveBeenCalledWith('FIXED_WORK_PATTERN_GENERATION_COMPLETED', expect.objectContaining({
      patternsProcessed: 3,
      generated: 5,
      skippedDuplicate: 1,
      skippedLeave: 2,
      skippedInactiveWorker: 1,
      skippedConflict: 1,
      weeklyHoursReviewRequired: 0,
      errorCount: 0,
      durationMs: expect.any(Number),
    }));
    infoSpy.mockRestore();
  });

  it('weekly-hours: a non-zero weeklyHoursReviewRequired is logged clearly, without mutating anything', async () => {
    const logger = require('../src/lib/logger');
    const warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => {});
    mockGenerate.mockResolvedValue(baseResult({ generated: 2, weeklyHoursReviewRequired: 4 }));
    const { runFixedWorkPatternGenerationJob } = loadJob();
    await runFixedWorkPatternGenerationJob();
    expect(warnSpy).toHaveBeenCalledWith('FIXED_WORK_PATTERN_GENERATION_WEEKLY_HOURS_REVIEW', { weeklyHoursReviewRequired: 4 });
    warnSpy.mockRestore();
  });

  it('10. a run with errors logs errorCount and is surfaced at warn level, not info', async () => {
    const logger = require('../src/lib/logger');
    const infoSpy = jest.spyOn(logger, 'info').mockImplementation(() => {});
    const warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => {});
    mockGenerate.mockResolvedValue(baseResult({ errors: [{ patternId: 'p1', workerId: 'w1', date: '2027-01-04', message: 'boom' }] }));
    const { runFixedWorkPatternGenerationJob } = loadJob();
    await runFixedWorkPatternGenerationJob();
    expect(warnSpy).toHaveBeenCalledWith('FIXED_WORK_PATTERN_GENERATION_COMPLETED', expect.objectContaining({ errorCount: 1 }));
    expect(infoSpy).not.toHaveBeenCalledWith('FIXED_WORK_PATTERN_GENERATION_COMPLETED', expect.anything());
    infoSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('11/12. an unexpected generator rejection is caught and never escapes the job', async () => {
    mockGenerate.mockRejectedValue(new Error('db exploded'));
    const { runFixedWorkPatternGenerationJob } = loadJob();
    await expect(runFixedWorkPatternGenerationJob()).resolves.toBeUndefined();
  });

  it('11/12. an unexpected rejection is logged at error level', async () => {
    const logger = require('../src/lib/logger');
    const errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => {});
    mockGenerate.mockRejectedValue(new Error('db exploded'));
    const { runFixedWorkPatternGenerationJob } = loadJob();
    await runFixedWorkPatternGenerationJob();
    expect(errorSpy).toHaveBeenCalledWith('FIXED_WORK_PATTERN_GENERATION_FAILED', expect.objectContaining({ message: 'db exploded' }));
    errorSpy.mockRestore();
  });

  it('13. an overlapping in-process invocation is skipped while a run is active', async () => {
    let resolveFirst;
    mockGenerate.mockImplementation(() => new Promise((resolve) => { resolveFirst = resolve; }));
    const { runFixedWorkPatternGenerationJob, isFixedWorkPatternGenerationRunning } = loadJob();

    const first = runFixedWorkPatternGenerationJob();
    expect(isFixedWorkPatternGenerationRunning()).toBe(true);
    await runFixedWorkPatternGenerationJob(); // should return immediately, without a second generate() call
    expect(mockGenerate).toHaveBeenCalledTimes(1);

    resolveFirst(baseResult());
    await first;
    expect(isFixedWorkPatternGenerationRunning()).toBe(false);
  });

  it('13. the skipped overlap is logged', async () => {
    const logger = require('../src/lib/logger');
    const warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => {});
    let resolveFirst;
    mockGenerate.mockImplementation(() => new Promise((resolve) => { resolveFirst = resolve; }));
    const { runFixedWorkPatternGenerationJob } = loadJob();
    const first = runFixedWorkPatternGenerationJob();
    await runFixedWorkPatternGenerationJob();
    expect(warnSpy).toHaveBeenCalledWith('FIXED_WORK_PATTERN_GENERATION_SKIPPED_OVERLAP', expect.any(Object));
    resolveFirst(baseResult());
    await first;
    warnSpy.mockRestore();
  });

  it('14. the running flag resets after a successful run — a subsequent call proceeds normally', async () => {
    mockGenerate.mockResolvedValue(baseResult());
    const { runFixedWorkPatternGenerationJob, isFixedWorkPatternGenerationRunning } = loadJob();
    await runFixedWorkPatternGenerationJob();
    expect(isFixedWorkPatternGenerationRunning()).toBe(false);
    await runFixedWorkPatternGenerationJob();
    expect(mockGenerate).toHaveBeenCalledTimes(2);
  });

  it('15/16. the running flag resets after a failure, and the next run works normally', async () => {
    mockGenerate.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(baseResult());
    const { runFixedWorkPatternGenerationJob, isFixedWorkPatternGenerationRunning } = loadJob();
    await runFixedWorkPatternGenerationJob();
    expect(isFixedWorkPatternGenerationRunning()).toBe(false);
    await runFixedWorkPatternGenerationJob();
    expect(mockGenerate).toHaveBeenCalledTimes(2);
  });

  it('17. no notification is sent by the job', async () => {
    mockGenerate.mockResolvedValue(baseResult({ generated: 3 }));
    const notificationService = require('../src/services/notificationService');
    const spies = Object.keys(notificationService)
      .filter((k) => typeof notificationService[k] === 'function')
      .map((k) => jest.spyOn(notificationService, k).mockImplementation(async () => {}));
    const { runFixedWorkPatternGenerationJob } = loadJob();
    await runFixedWorkPatternGenerationJob();
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    spies.forEach((s) => s.mockRestore());
  });

  it('18. the job file itself contains no direct Shift/pattern database access', () => {
    const source = fs.readFileSync(path.join(__dirname, '../src/jobs/fixedWorkPatternGenerationJob.js'), 'utf8');
    expect(source).not.toMatch(/require\(['"]\.\.\/lib\/prisma['"]\)/);
    expect(source).not.toMatch(/prisma\.(shift|fixedWorkPattern)/i);
  });
});

describe('scheduler.js — fixed work pattern job registration', () => {
  let scheduledCalls;
  let mockRunJob;

  beforeEach(() => {
    jest.resetModules();
    scheduledCalls = [];
    jest.doMock('node-cron', () => ({
      schedule: jest.fn((expr, fn, opts) => {
        scheduledCalls.push({ expr, fn, opts });
        return { stop: jest.fn() };
      }),
    }));
    mockRunJob = jest.fn().mockResolvedValue(undefined);
    jest.doMock('../src/jobs/fixedWorkPatternGenerationJob', () => ({
      runFixedWorkPatternGenerationJob: mockRunJob,
      isFixedWorkPatternGenerationRunning: () => false,
    }));
  });

  afterEach(() => {
    jest.dontMock('node-cron');
    jest.dontMock('../src/jobs/fixedWorkPatternGenerationJob');
    jest.resetModules();
  });

  it('1. the fixed-pattern job is registered, once daily at 02:30 UTC', () => {
    const { startScheduler } = require('../src/jobs/scheduler');
    startScheduler();
    const fixedCall = scheduledCalls.find((c) => c.fn === mockRunJob);
    expect(fixedCall).toBeTruthy();
    expect(fixedCall.expr).toBe('30 2 * * *');
    expect(fixedCall.opts).toEqual(expect.objectContaining({ timezone: 'UTC' }));
  });

  it('2. the scheduled callback IS the generation job (scheduler does not wrap/duplicate its logic)', async () => {
    const { startScheduler } = require('../src/jobs/scheduler');
    startScheduler();
    const fixedCall = scheduledCalls.find((c) => c.fn === mockRunJob);
    await fixedCall.fn();
    expect(mockRunJob).toHaveBeenCalledTimes(1);
  });

  it('19/20. existing jobs remain registered with unchanged cadence', () => {
    const { startScheduler } = require('../src/jobs/scheduler');
    startScheduler();
    expect(scheduledCalls.length).toBe(3);
    expect(scheduledCalls.some((c) => c.expr === '*/5 * * * *')).toBe(true); // missedClockInJob, unchanged
    expect(scheduledCalls.some((c) => c.expr === '* * * * *')).toBe(true); // attendanceJob, unchanged
  });

  it('21. starting the scheduler does not itself trigger fixed work pattern generation', () => {
    const { startScheduler } = require('../src/jobs/scheduler');
    startScheduler();
    expect(mockRunJob).not.toHaveBeenCalled(); // only registered — only the (mocked) cron firing it would call it
  });
});
