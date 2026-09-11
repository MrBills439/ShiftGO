const cron = require('node-cron');
const { missedClockInJob } = require('./missedClockInJob');
const { attendanceJob } = require('./attendanceJob');
const { runFixedWorkPatternGenerationJob } = require('./fixedWorkPatternGenerationJob');

function startScheduler() {
  // Every 5 minutes — missed clock-in alerts
  cron.schedule('*/5 * * * *', async () => {
    try { await missedClockInJob(); }
    catch (err) { console.error('[Scheduler] missedClockInJob error', err.message); }
  });

  // Every minute — shift-end prompts + auto-clock-out grace machine
  cron.schedule('* * * * *', async () => {
    try { await attendanceJob(); }
    catch (err) { console.error('[Scheduler] attendanceJob error', err.message); }
  });

  // Once daily, 02:30 UTC — rolling 28-day Fixed Work Pattern top-up.
  // runFixedWorkPatternGenerationJob already guards its own overlap, logs its
  // own structured summary, and never throws — nothing to wrap here. Pinned
  // to UTC explicitly (rather than relying on the host's local time) so the
  // schedule means the same thing regardless of where this runs.
  cron.schedule('30 2 * * *', runFixedWorkPatternGenerationJob, { timezone: 'UTC' });

  console.log('[Scheduler] Started — missedClockIn (5min), attendance grace machine (1min), fixed work pattern top-up (daily 02:30 UTC)');
}

module.exports = { startScheduler };
