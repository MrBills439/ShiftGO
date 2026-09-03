require('dotenv').config();
const app = require('./app');
const config = require('./config');
const { ensureUploadDirs, UPLOAD_DIR } = require('./lib/storage');
const { startScheduler } = require('./jobs/scheduler');

// Prepare the upload directories before serving traffic — on Railway this is the
// mounted persistent volume (UPLOAD_DIR=/app/uploads), empty on first boot.
ensureUploadDirs();

app.listen(config.port, () => {
  console.log(`ShiftGO API running on port ${config.port} [${config.nodeEnv}]`);
  console.log(`Uploads directory: ${UPLOAD_DIR}`);
  startScheduler();
});
