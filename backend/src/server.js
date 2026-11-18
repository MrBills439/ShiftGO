require('dotenv').config();
// Before anything else, so startup failures are reported too.
const { initMonitoring, captureError, flushMonitoring } = require('./lib/monitoring');
initMonitoring();
const app = require('./app');
const config = require('./config');
const prisma = require('./lib/prisma');
const logger = require('./lib/logger');
const { ensureUploadDirs, UPLOAD_DIR } = require('./lib/storage');
const { startScheduler } = require('./jobs/scheduler');

// Prepare the upload directories before serving traffic — on Railway this is the
// mounted persistent volume (UPLOAD_DIR=/app/uploads), empty on first boot.
ensureUploadDirs();

const server = app.listen(config.port, () => {
  console.log(`ShiftGO API running on port ${config.port} [${config.nodeEnv}]`);
  console.log(`Uploads directory: ${UPLOAD_DIR}`);
  startScheduler();
});

// Graceful shutdown — Railway sends SIGTERM on every redeploy. Stop accepting
// new connections, then release the Postgres pool so connections aren't left
// dangling on the database side during the rollover.
let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info('server.shutdown', { signal });
  server.close(async () => {
    try {
      await flushMonitoring();
      await prisma.$disconnect();
    } catch (err) {
      logger.error('server.shutdown_error', { message: err.message });
    }
    process.exit(0);
  });
  // Don't hang forever if connections won't drain.
  setTimeout(() => process.exit(0), 10_000).unref();
}

process.on('unhandledRejection', (reason) => {
  logger.error('process.unhandled_rejection', { message: reason?.message || String(reason) });
  captureError(reason instanceof Error ? reason : new Error(String(reason)), { source: 'unhandledRejection' });
});
process.on('uncaughtException', async (err) => {
  logger.error('process.uncaught_exception', { message: err.message, stack: err.stack });
  captureError(err, { source: 'uncaughtException' });
  await flushMonitoring();
  process.exit(1); // state is unknown after an uncaught exception — let Railway restart us
});

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
