/**
 * Shared PrismaClient.
 *
 * The whole backend must go through this ONE instance. Each `new PrismaClient()`
 * opens its own connection pool, so scattering them across controllers/services
 * exhausts the database's connection limit (a real problem on managed Postgres
 * such as Railway). Import this module instead:
 *
 *   const prisma = require('../lib/prisma');
 *
 * The instance is cached on `globalThis` so that a module-registry reset (e.g.
 * Jest, or a dev hot-reload) re-uses the same client rather than leaking a new
 * pool on every re-require.
 *
 * Query-performance diagnostics are OPT-IN and environment-controlled so the
 * default production path is byte-for-byte the original client:
 *   PRISMA_QUERY_METRICS=true   -> count every query in /metrics
 *   PRISMA_SLOW_QUERY_MS=<ms>   -> also warn-log queries at/over the threshold
 *                                 (query TEXT only, never bound parameters)
 */
const { PrismaClient } = require('@prisma/client');

const globalForPrisma = globalThis;

const slowQueryMs = Number(process.env.PRISMA_SLOW_QUERY_MS) || 0;
const queryMetrics = process.env.PRISMA_QUERY_METRICS === 'true' || slowQueryMs > 0;

function createClient() {
  if (!queryMetrics) return new PrismaClient();

  const client = new PrismaClient({ log: [{ level: 'query', emit: 'event' }] });
  // Lazy-require to avoid a cycle (metrics/logger never import prisma).
  const metrics = require('./metrics');
  const logger = require('./logger');
  client.$on('query', (e) => {
    const slow = slowQueryMs > 0 && e.duration >= slowQueryMs;
    metrics.recordDbQuery(slow);
    if (slow) {
      logger.warn('db.slow_query', {
        durationMs: e.duration,
        query: String(e.query).slice(0, 200),
      });
    }
  });
  return client;
}

const prisma = globalForPrisma.__shiftgoPrisma || createClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.__shiftgoPrisma = prisma;
}

module.exports = prisma;
