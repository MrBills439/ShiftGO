const prisma = require('../lib/prisma');
const { agencyIdFor } = require('../utils/agency');
const logger = require('../lib/logger');
const metrics = require('../lib/metrics');

function auditContext(req) {
  return {
    actorId: req.user?.id ?? null,
    agencyId: agencyIdFor(req),
    actorRole: req.user?.role ?? null,
    ipAddress: req.clientIp || req.ip || req.socket?.remoteAddress || null,
    userAgent: req.get?.('user-agent') || req.headers?.['user-agent'] || null,
  };
}

async function createAuditLog(entry, client = prisma) {
  try {
    const oldValue = entry.oldValue == null ? undefined : JSON.parse(JSON.stringify(entry.oldValue));
    const newValue = entry.newValue == null ? undefined : JSON.parse(JSON.stringify(entry.newValue));

    return await client.auditLog.create({
      data: {
        agencyId: entry.agencyId,
        actorId: entry.actorId ?? null,
        actorRole: entry.actorRole ?? null,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        oldValue,
        newValue,
        ipAddress: entry.ipAddress ?? null,
        userAgent: entry.userAgent ?? null,
      },
    });
  } catch (err) {
    // Never fail the user's action because the audit write failed, but make it
    // impossible to miss: structured error log + a /metrics counter to alert on.
    metrics.recordAuditWriteFailure();
    logger.error('audit.write_failed', {
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      agencyId: entry.agencyId,
      actorId: entry.actorId ?? null,
      error: err.message,
    });
    return null;
  }
}

/**
 * Record that someone VIEWED or DOWNLOADED a sensitive record (DBS, right to
 * work, residents). Reads change nothing, so without this there is no trace of
 * who looked at a person's criminal-record check. Only identifiers and a few
 * non-sensitive facts go in `newValue` — never the record's contents.
 */
async function logAccess(req, { action, entityType, entityId, subjectUserId = null, details = {} }) {
  return createAuditLog({
    ...auditContext(req),
    action,
    entityType,
    entityId,
    newValue: { subjectUserId, ...details },
  });
}

/** Attach `actor: { id, name }` to each log in one query (AuditLog has no relation). */
async function withActors(logs) {
  const ids = [...new Set(logs.map((l) => l.actorId).filter(Boolean))];
  if (ids.length === 0) return logs.map((l) => ({ ...l, actor: null }));
  const users = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
  const byId = new Map(users.map((u) => [u.id, u]));
  return logs.map((l) => ({ ...l, actor: byId.get(l.actorId) ?? null }));
}

async function listAuditLogs(filters = {}) {
  const where = {};
  where.agencyId = filters.agencyId;
  if (Array.isArray(filters.actions)) where.action = { in: filters.actions };
  if (filters.entityType) where.entityType = filters.entityType;
  if (filters.entityId) where.entityId = filters.entityId;
  if (filters.actorId) where.actorId = filters.actorId;
  if (filters.action) where.action = filters.action;
  if (filters.dateFrom || filters.dateTo) {
    where.createdAt = {};
    if (filters.dateFrom) where.createdAt.gte = new Date(filters.dateFrom);
    if (filters.dateTo) where.createdAt.lte = new Date(filters.dateTo);
  }

  return prisma.auditLog.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: Math.min(Number(filters.limit) || 100, 200),
    skip: Math.max(((Number(filters.page) || 1) - 1) * (Number(filters.limit) || 100), 0),
  });
}

module.exports = { auditContext, createAuditLog, listAuditLogs, logAccess, withActors };
