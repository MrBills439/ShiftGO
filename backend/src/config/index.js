require('dotenv').config();

const isTest = process.env.NODE_ENV === 'test';
const isProd = process.env.NODE_ENV === 'production';

const required = [
  'DATABASE_URL',
  ...(isTest ? [] : ['CLERK_SECRET_KEY', 'CLERK_WEBHOOK_SIGNING_SECRET']),
  ...(isProd ? ['CORS_ORIGINS'] : []),
];
const missing = required.filter((name) => !process.env[name]);
if (missing.length) {
  throw new Error(`Missing required environment variable(s): ${missing.join(', ')}`);
}

// Dev/test only — production must set CORS_ORIGINS explicitly (checked above).
const DEFAULT_DEV_ORIGINS = ['http://localhost:3000', 'http://localhost:3001'];

const corsOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map((origin) => origin.trim()).filter(Boolean)
  : DEFAULT_DEV_ORIGINS;

module.exports = {
  port: process.env.PORT || 4000,
  nodeEnv: process.env.NODE_ENV || 'development',
  db: {
    url: process.env.DATABASE_URL,
  },
  clerk: {
    secretKey: process.env.CLERK_SECRET_KEY,
    webhookSigningSecret: process.env.CLERK_WEBHOOK_SIGNING_SECRET,
  },
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
