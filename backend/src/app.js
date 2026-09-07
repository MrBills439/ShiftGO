const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const { AVATARS_DIR } = require('./lib/storage');

const webhookRoutes = require('./routes/webhooks');
const dashboardRoutes = require('./routes/dashboard');
const userRoutes = require('./routes/users');
const houseRoutes = require('./routes/houses');
const shiftRoutes = require('./routes/shifts');
const clockRoutes = require('./routes/clock');
const timesheetRoutes = require('./routes/timesheets');
const rotaRoutes = require('./routes/rota');
const leaveRequestRoutes = require('./routes/leaveRequests');
const notificationRoutes = require('./routes/notifications');
const trainingRoutes = require('./routes/training');
const dbsRoutes = require('./routes/dbs');
const auditLogRoutes = require('./routes/auditLogs');
const activityRoutes = require('./routes/activity');
const announcementRoutes = require('./routes/announcements');
const rightToWorkRoutes = require('./routes/rightToWork');
const errorHandler = require('./middleware/errorHandler');
const { apiLimiter } = require('./middleware/rateLimit');
const config = require('./config');

const app = express();

// Trust the first upstream proxy in managed deployments such as Railway,
// DigitalOcean, Nginx, and Cloudflare so rate limiting uses the client IP.
app.set('trust proxy', 1);

// Middleware
app.use(helmet());
app.use(cors({
  origin(origin, callback) {
    // No Origin header means a non-browser client (mobile app, curl, server-to-server) —
    // CORS is a browser-enforced policy, so there's nothing to restrict here.
    if (!origin || config.cors.origins.includes(origin)) return callback(null, true);
    const err = new Error(`Origin ${origin} is not allowed by CORS`);
    err.statusCode = 403;
    callback(err);
  },
}));

// Mounted before express.json() — Clerk's webhook signature verification
// needs the raw request body, not pre-parsed JSON.
app.use('/webhooks', webhookRoutes);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));
app.use(morgan('dev'));

// Serve ONLY avatar images statically. Right-to-Work / compliance documents live
// under UPLOAD_DIR/rtw and are deliberately NOT mounted here — they are reachable
// only through the authenticated /right-to-work routes, which enforce agency/RBAC
// checks. `dotfiles: 'deny'` and helmet's nosniff header harden the mount.
app.use('/uploads/avatars', express.static(AVATARS_DIR, { dotfiles: 'deny', index: false }));

// Health check
app.get('/health', (_, res) => res.json({ status: 'ok', app: 'ShiftGO', timestamp: new Date().toISOString() }));

// General API limiter. Health checks are intentionally outside this limiter.
app.use(apiLimiter);

// Routes (NOTE: clients expect routes WITHOUT /api prefix)
app.use('/dashboard', dashboardRoutes);
app.use('/users', userRoutes);
app.use('/houses', houseRoutes);
app.use('/shifts', shiftRoutes);
app.use('/clock', clockRoutes);
app.use('/timesheets', timesheetRoutes);
app.use('/rota', rotaRoutes);
app.use('/leave-requests', leaveRequestRoutes);
app.use('/notifications', notificationRoutes);
app.use('/training', trainingRoutes);
app.use('/dbs', dbsRoutes);
app.use('/audit-logs', auditLogRoutes);
app.use('/activity', activityRoutes);
app.use('/announcements', announcementRoutes);
app.use('/right-to-work', rightToWorkRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: `Route ${req.method} ${req.path} not found`,
    },
    timestamp: new Date().toISOString(),
  });
});

// Error handler (MUST be last)
app.use(errorHandler);

module.exports = app;
