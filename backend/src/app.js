const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const prisma = require('./lib/prisma');
const { AVATARS_DIR } = require('./lib/storage');
const { requestLogger } = require('./middleware/requestLogger');
const metrics = require('./lib/metrics');

const webhookRoutes = require('./routes/webhooks');
const dashboardRoutes = require('./routes/dashboard');
const staffRoutes = require('./routes/staff');
const agencyRoutes = require('./routes/agency');
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
const shiftChangeRoutes = require('./routes/shiftChange');
const orgStructureRoutes = require('./routes/orgStructure');
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
app.use(requestLogger);

// Serve ONLY avatar images statically. Right-to-Work / compliance documents live
// under UPLOAD_DIR/rtw and are deliberately NOT mounted here — they are reachable
// only through the authenticated /right-to-work routes, which enforce agency/RBAC
// checks. `dotfiles: 'deny'` and helmet's nosniff header harden the mount.
// `Cross-Origin-Resource-Policy: cross-origin` lets the web app (a different
// origin) embed these public avatar images in <img> tags — helmet's default of
// `same-origin` otherwise blocks them in the browser (the mobile app is
// unaffected, which is why an uploaded photo showed there but not on the web).
// Avatar on-disk names are random 16-byte hex (see middleware/upload.js
// makeFilename); uploadAvatar writes a brand-new name and deletes the old file,
// so a given /uploads/avatars/<name> URL always maps to the same bytes and a
// new avatar is a new URL. That makes each file safely immutable, so it is
// served `public, max-age=31536000, immutable` to stop browsers/CDNs re-reading
// the Railway volume. This applies ONLY to this public-avatar mount — RTW and
// other private uploads are never statically served (they go through the
// authenticated /right-to-work routes).
app.use(
  '/uploads/avatars',
  express.static(AVATARS_DIR, {
    dotfiles: 'deny',
    index: false,
    setHeaders: (res) => {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    },
  }),
);

// Health check — Railway readiness endpoint. Lightweight `SELECT 1` so a dead
// database surfaces as 503 instead of a falsely-healthy 200. Never exposes DB
// details; a short timeout keeps it from hanging on an unresponsive database.
app.get('/health', async (_req, res) => {
  let db = 'down';
  let timer;
  try {
    await Promise.race([
      prisma.$queryRaw`SELECT 1`,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('health-db-timeout')), 2000);
      }),
    ]);
    db = 'ok';
  } catch {
    db = 'down';
  } finally {
    clearTimeout(timer);
  }
  const healthy = db === 'ok';
  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'ok' : 'degraded',
    app: 'ShiftGO',
    db,
    timestamp: new Date().toISOString(),
  });
});

// Operational metrics — non-sensitive in-process counters (request/error/slow
// counts, avg/max latency, optional DB query counts). Gated by METRICS_TOKEN
// supplied ONLY via the x-metrics-token header (never a query parameter, so the
// token can't leak into access logs or browser history). With no token
// configured the route does not exist (404), so it can't be scraped by
// accident. Never behind the rate limiter or auth stack.
app.get('/metrics', (req, res) => {
  const expected = process.env.METRICS_TOKEN;
  const provided = req.get('x-metrics-token');
  if (!expected || provided !== expected) {
    return res.status(404).json({ success: false, error: { code: 'NOT_FOUND' } });
  }
  res.json(metrics.snapshot());
});

// General API limiter. Health checks are intentionally outside this limiter.
app.use(apiLimiter);

// Routes (NOTE: clients expect routes WITHOUT /api prefix)
app.use('/dashboard', dashboardRoutes);
app.use('/staff', staffRoutes);
app.use('/agency', agencyRoutes);
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
app.use('/shift-change', shiftChangeRoutes);
app.use('/departments', orgStructureRoutes.departments);
app.use('/job-titles', orgStructureRoutes.jobTitles);
app.use('/locations', orgStructureRoutes.locations);

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
