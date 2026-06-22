const cron = require('node-cron');
const { missedClockInJob } = require('./missedClockInJob');
const { autoClockOutJob }  = require('./autoClockOutJob');

function startScheduler() {
  // Every 5 minutes — missed clock-in alerts
  cron.schedule('*/5 * * * *', async () => {
    try { await missedClockInJob(); }
    catch (err) { console.error('[Scheduler] missedClockInJob error', err.message); }
  });

  // Every minute — auto clock-out at shift end
  cron.schedule('* * * * *', async () => {
    try { await autoClockOutJob(); }
    catch (err) { console.error('[Scheduler] autoClockOutJob error', err.message); }
  });

  console.log('[Scheduler] Started — missedClockIn (5min), autoClockOut (1min)');
}

module.exports = { startScheduler };
