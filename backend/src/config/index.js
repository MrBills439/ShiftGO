require('dotenv').config();
const path = require('path');

const isTest = process.env.NODE_ENV === 'test';
const isProd = process.env.NODE_ENV === 'production';

const required = [
  'DATABASE_URL',
  // Sign-in (Better Auth). The secret signs session cookies and tokens: 32+
  // random characters, never shared between environments.
  ...(isProd ? ['CORS_ORIGINS', 'BETTER_AUTH_SECRET', 'BETTER_AUTH_URL', 'WEB_APP_URL'] : []),
];
if (isProd && (process.env.BETTER_AUTH_SECRET || '').length < 32) {
  throw new Error('BETTER_AUTH_SECRET must be at least 32 characters.');
}
// Right-to-Work documents in an S3-compatible bucket (see lib/rtwStore.js).
if ((process.env.RTW_STORAGE_DRIVER || 'local').toLowerCase() === 's3') required.push('S3_BUCKET');
const RTW_DRIVERS = ['local', 's3'];
if (!RTW_DRIVERS.includes((process.env.RTW_STORAGE_DRIVER || 'local').toLowerCase())) {
  throw new Error(`RTW_STORAGE_DRIVER must be one of: ${RTW_DRIVERS.join(', ')}`);
}

const missing = required.filter((name) => !process.env[name]);
if (missing.length) {
  throw new Error(`Missing required environment variable(s): ${missing.join(', ')}`);
}

// Dev/test only — production must set CORS_ORIGINS explicitly (checked above).
const DEFAULT_DEV_ORIGINS = ['http://localhost:3000', 'http://localhost:3001'];

const corsOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map((origin) => origin.trim()).filter(Boolean)
  : DEFAULT_DEV_ORIGINS;

// Base directory for persistent uploads (avatars, Right-to-Work documents).
// Production points this at the mounted Railway volume: UPLOAD_DIR=/app/uploads.
// Local dev/test falls back to backend/uploads. A relative value is resolved
// against the process working directory.
const uploadDir = process.env.UPLOAD_DIR
  ? path.resolve(process.env.UPLOAD_DIR)
  : path.join(__dirname, '../../uploads');

module.exports = {
  port: process.env.PORT || 4000,
  nodeEnv: process.env.NODE_ENV || 'development',
  uploadDir,
  db: {
    url: process.env.DATABASE_URL,
  },
  auth: {
    secret: process.env.BETTER_AUTH_SECRET || 'dev-only-insecure-secret-change-me-0123456789',
    // Public URL of THIS API (used by Better Auth for origin checks).
    baseURL: process.env.BETTER_AUTH_URL || `http://localhost:${process.env.PORT || 4000}`,
    // HR, managers: two-step verification required before using the API.
    // Tests switch it off globally (tests/ set REQUIRE_2FA_FOR_ADMINS=false).
    require2faForAdmins: process.env.REQUIRE_2FA_FOR_ADMINS !== 'false',
  },
  // Public URL of the web app — invitation links point here.
  webAppUrl: (process.env.WEB_APP_URL || 'http://localhost:3000').replace(/\/$/, ''),
  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
  },
  cors: {
    origins: corsOrigins,
  },
  jwt: {
    secret: process.env.JWT_SECRET,
    refreshSecret: process.env.JWT_REFRESH_SECRET,
    expiresIn: process.env.JWT_EXPIRES_IN || '15m',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  },
  geofence: {
    defaultRadius: parseInt(process.env.GEOFENCE_DEFAULT_RADIUS || '50', 10),
  },
  firebase: {
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    required: process.env.FIREBASE_REQUIRED === 'true' || process.env.NODE_ENV === 'production',
  },
};
