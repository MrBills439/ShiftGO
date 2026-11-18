/**
 * Data retention (UK GDPR storage limitation).
 *
 * Two rules, each with a configurable period:
 *
 *  1. GPS coordinates — GPS_RETENTION_DAYS (default 90).
 *     Exact latitude/longitude on ClockEvent (and the last reading on a CLOSED
 *     AttendanceMonitor) are cleared once older than the period. The
 *     attendance OUTCOME is kept — withinGeofence, distanceMeters, accuracy,
 *     locationStatusResult, gpsConfidence — so a timesheet can still be
 *     evidenced ("on site, 12 m from the service") without keeping where the
 *     person physically was.
 *
 *  2. Right-to-Work records — RTW_RETENTION_DAYS (default 730 = 2 years).
 *     Home Office guidance: keep RTW copies for the employment plus 2 years.
 *     For a user DEACTIVATED longer ago than the period, the stored document is
 *     deleted and the ShareCode row (share code, share date, document link) is
 *     removed. An audit row records that it happened, never the code itself.
 *
 * Deletion is permanent, so it only happens when RETENTION_ENABLED=true.
 * Otherwise the job runs in report-only mode and logs what it WOULD remove.
 */
const prisma = require('../lib/prisma');
const logger = require('../lib/logger');
const rtwStore = require('../lib/rtwStore');
const { createAuditLog } = require('../services/auditService');

const DAY_MS = 86_400_000;

function daysFromEnv(name, fallback) {
  const n = Number.parseInt(process.env[name] || '', 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function retentionSettings() {
  return {
    enabled: process.env.RETENTION_ENABLED === 'true',
    gpsDays: daysFromEnv('GPS_RETENTION_DAYS', 90),
    rtwDays: daysFromEnv('RTW_RETENTION_DAYS', 730),
  };
}

async function purgeGps({ enabled, gpsDays }, now) {
  const cutoff = new Date(now.getTime() - gpsDays * DAY_MS);
  // capturedAt is when the fix was taken; older rows may only have timestamp.
  const eventWhere = {
    OR: [{ latitude: { not: null } }, { longitude: { not: null } }],
    AND: [{ OR: [{ capturedAt: { lt: cutoff } }, { capturedAt: null, timestamp: { lt: cutoff } }] }],
  };
  const monitorWhere = {
    closedAt: { lt: cutoff },
    OR: [{ lastLatitude: { not: null } }, { lastLongitude: { not: null } }],
  };
  if (!enabled) {
    return {
      clockEvents: await prisma.clockEvent.count({ where: eventWhere }),
      monitors: await prisma.attendanceMonitor.count({ where: monitorWhere }),
    };
  }
  const events = await prisma.clockEvent.updateMany({ where: eventWhere, data: { latitude: null, longitude: null } });
  const monitors = await prisma.attendanceMonitor.updateMany({ where: monitorWhere, data: { lastLatitude: null, lastLongitude: null } });
  return { clockEvents: events.count, monitors: monitors.count };
}

async function purgeRtw({ enabled, rtwDays }, now) {
  const cutoff = new Date(now.getTime() - rtwDays * DAY_MS);
  const expired = await prisma.shareCode.findMany({
    where: { user: { status: 'DEACTIVATED', deactivatedAt: { lt: cutoff } } },
    select: { id: true, agencyId: true, userId: true, documentPath: true, user: { select: { deactivatedAt: true } } },
  });
  if (!enabled) return { records: expired.length };

  let removed = 0;
  for (const rec of expired) {
    try {
      if (rec.documentPath) await rtwStore.remove(rec.documentPath);
      await prisma.shareCode.delete({ where: { id: rec.id } });
      removed += 1;
      await createAuditLog({
        agencyId: rec.agencyId,
        actorId: null,
        actorRole: 'SYSTEM',
        action: 'RTW_RECORD_DELETED_RETENTION',
        entityType: 'ShareCode',
        entityId: rec.id,
        oldValue: { subjectUserId: rec.userId, hadDocument: Boolean(rec.documentPath), deactivatedAt: rec.user.deactivatedAt },
        newValue: { retentionDays: rtwDays },
      });
    } catch (err) {
      logger.error('retention.rtw_delete_failed', { shareCodeId: rec.id, error: err.message });
    }
  }
  return { records: removed };
}

async function runRetentionJob({ now = new Date() } = {}) {
  const settings = retentionSettings();
  const gps = await purgeGps(settings, now);
  const rtw = await purgeRtw(settings, now);
  const summary = { mode: settings.enabled ? 'deleted' : 'report-only', ...settings, gps, rtw };
  logger.info(settings.enabled ? 'retention.completed' : 'retention.report_only', summary);
  return summary;
}

module.exports = { runRetentionJob, retentionSettings };
