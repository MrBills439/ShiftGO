const cron = require('node-cron');
const { missedClockInJob } = require('./missedClockInJob');
const { attendanceJob } = require('./attendanceJob');
const { runFixedWorkPatternGenerationJob } = require('./fixedWorkPatternGenerationJob');
const { withJobLock } = require('./jobLock');

/**
 * Run one tick of a job under the cluster-wide lock, so only one API instance
 * executes it even when several are running. Errors are logged, never thrown
 * out of the cron callback.
 */
function locked(name, job, opts) {
  return async () => {
    try {
      await withJobLock(name, job, opts);
    } catch (err) {
      console.error(`[Scheduler] ${name} error`, err.message);
    }
  };
}

function startScheduler() {
  // Set RUN_SCHEDULER=false on instances that should only serve HTTP. Even
  // with it on everywhere, the job lock keeps each tick to one instance.
  if (process.env.RUN_SCHEDULER === 'false') {
    console.log('[Scheduler] Disabled (RUN_SCHEDULER=false)');
    return;
  }

  // Every 5 minutes — missed clock-in alerts
  cron.schedule('*/5 * * * *', locked('missedClockIn', missedClockInJob, { maxRunMs: 4 * 60_000 }));

  // Every minute — shift-end prompts + auto-clock-out grace machine
  cron.schedule('* * * * *', locked('attendance', attendanceJob, { maxRunMs: 55_000 }));

  // Once daily, 02:30 UTC — rolling 28-day Fixed Work Pattern top-up.
  // runFixedWorkPatternGenerationJob also guards its own in-process overlap,
  // logs its own structured summary, and never throws. Pinned to UTC
  // explicitly so the schedule means the same thing wherever this runs.
  cron.schedule('30 2 * * *', locked('fixedWorkPatternGeneration', runFixedWorkPatternGenerationJob, { maxRunMs: 30 * 60_000 }), { timezone: 'UTC' });

  console.log('[Scheduler] Started — missedClockIn (5min), attendance grace machine (1min), fixed work pattern top-up (daily 02:30 UTC); one instance per tick via advisory lock');
}

module.exports = { startScheduler };
