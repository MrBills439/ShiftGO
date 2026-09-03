const prisma = require('../lib/prisma');
const { agencyIdFor } = require('../utils/agency');

function auditContext(req) {
  return {
    actorId: req.user?.id ?? null,
    agencyId: agencyIdFor(req),
    actorRole: req.user?.role ?? null,
    ipAddress: req.ip || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || null,
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
    console.error('[AuditLog] failed to create audit log:', err.message);
    return null;
  }
}

async function listAuditLogs(filters = {}) {
  const where = {};
  where.agencyId = filters.agencyId;
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

module.exports = { auditContext, createAuditLog, listAuditLogs };
