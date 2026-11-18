/**
 * Cluster-wide "only one instance runs this job tick" guard.
 *
 * Every API instance starts the scheduler, so with two replicas (or a deploy
 * overlap, where old and new containers briefly run together) each cron job
 * would fire twice: duplicate missed-clock-in pushes, duplicate auto clock-outs.
 *
 * Uses a Postgres transaction-level advisory lock: pg_try_advisory_xact_lock
 * either takes the lock immediately or returns false (never waits). It is held
 * for the life of the transaction and released automatically when it ends —
 * including if the process crashes — so a lock can never be left stuck. No
 * table or migration needed.
 *
 * The job itself runs on the normal Prisma client (not the transaction), so its
 * own writes are not rolled back or held open by the lock; the transaction only
 * pins one pooled connection for the duration of the run.
 */
const prisma = require('../lib/prisma');
const logger = require('../lib/logger');

const DEFAULT_MAX_RUN_MS = 15 * 60_000;

/**
 * @param {string} name  stable job name — the lock key is hashtext(name)
 * @param {() => Promise<any>} fn
 * @returns {Promise<{ ran: boolean, result?: any }>}
 */
async function withJobLock(name, fn, { maxRunMs = DEFAULT_MAX_RUN_MS } = {}) {
  return prisma.$transaction(
    async (tx) => {
      const [{ locked }] = await tx.$queryRaw`SELECT pg_try_advisory_xact_lock(hashtext(${`shiftgo-job:${name}`})) AS locked`;
      if (!locked) {
        logger.info('job.skipped_locked', { job: name });
        return { ran: false };
      }
      const result = await fn();
      return { ran: true, result };
    },
    { maxWait: 10_000, timeout: maxRunMs },
  );
}

module.exports = { withJobLock };
