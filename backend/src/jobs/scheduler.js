const cron = require('node-cron');
const { missedClockInJob } = require('./missedClockInJob');
const { attendanceJob } = require('./attendanceJob');

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

  console.log('[Scheduler] Started — missedClockIn (5min), attendance grace machine (1min)');
}

module.exports = { startScheduler };
