require('dotenv').config();
const app = require('./app');
const config = require('./config');
const { startScheduler } = require('./jobs/scheduler');

app.listen(config.port, () => {
  console.log(`ShiftGO API running on port ${config.port} [${config.nodeEnv}]`);
  startScheduler();
});
