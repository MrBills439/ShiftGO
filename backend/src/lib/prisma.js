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
 */
const { PrismaClient } = require('@prisma/client');

const globalForPrisma = globalThis;

const prisma = globalForPrisma.__shiftgoPrisma || new PrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.__shiftgoPrisma = prisma;
}

module.exports = prisma;
