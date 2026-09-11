const prisma = require('../lib/prisma');
const clockService = require('../services/clockService');
const { attendanceConfigFor } = require('../config/attendance');
const { attendanceTargetFor } = require('../services/attendanceTargetService');
const { createAuditLog } = require('../services/auditService');
const notificationService = require('../services/notificationService');

/**
 * Runs every minute. Drives the shift-end / auto-clock-out grace machine for
 * every OPEN AttendanceMonitor. It NEVER clocks someone out merely because a
 * scheduled time passed or one GPS reading was outside — see `strongExit`.
 */
async function attendanceJob(now = new Date()) {
  const nowMs = now.getTime();

  const monitors = await prisma.attendanceMonitor.findMany({
    where: { closedAt: null },
    include: { shift: { include: { house: true, location: true } }, worker: { select: { id: true, name: true, fcmToken: true } } },
  });

  // One query for every open monitor's timesheet instead of one per iteration.
  // AttendanceMonitor.shiftId is unique, so a shift maps to at most one row.
  const timesheets = await prisma.timesheet.findMany({
    where: { shiftId: { in: monitors.map((m) => m.shiftId) } },
    select: { id: true, shiftId: true, clockOutAt: true },
  });
  const timesheetByShiftId = new Map(timesheets.map((t) => [t.shiftId, t]));

  for (const m of monitors) {
    try {
      const shift = m.shift;

      // 1. Reconcile — closed elsewhere / shift cancelled / already completed.
      const ts = timesheetByShiftId.get(shift.id);
      if (ts?.clockOutAt || shift.status === 'CANCELLED' || shift.status === 'COMPLETED') {
        await clockService.closeMonitor(shift.id, 'RECONCILED');
        continue;
      }

      const target = attendanceTargetFor(shift); // House for a care ROTA shift
      const cfg = attendanceConfigFor(target);
      const shiftEnded = nowMs > shift.endTime.getTime();

      // 2. Scheduled end reached, worker still clocked in → PROMPT only. Never auto clock-out here.
      if (shiftEnded && !m.shiftEndPromptedAt && !m.shiftEndAckAt) {
        await prisma.attendanceMonitor.update({
          where: { id: m.id }, data: { shiftEndPromptedAt: now },
        });
        await createAuditLog({
          agencyId: shift.agencyId, actorId: null, actorRole: 'SYSTEM',
          action: 'SHIFT_END_REACHED', entityType: 'Shift', entityId: shift.id,
          newValue: { locationStatus: m.locationStatus, scheduledEnd: shift.endTime },
        });
        if (m.worker.fcmToken) {
          notificationService.send(m.worker.fcmToken, {
            title: 'Scheduled shift ended',
            body: `Your shift at ${target.name} was due to end. Are you still working?`,
          }).catch(() => {});
        }
      }

      // 3. Auto-clock-out evaluation — STRICT conjunction of strong conditions.
      const graceStarted = m.autoClockOutGraceStartedAt;
      const graceMs = graceStarted ? nowMs - graceStarted.getTime() : 0;
      const evidenceAgeMs = m.lastReadingAt ? nowMs - m.lastReadingAt.getTime() : Infinity;
      const latestStillOutside =
        m.locationStatus === 'OFFSITE' &&
        m.lastDistanceMeters != null &&
        m.lastDistanceMeters > cfg.geofenceRadiusM;

      const baseConditions =
        shiftEnded &&
        !!m.geofenceExitConfirmedAt &&           // debounced exit, not one noisy reading
        !m.stillWorkingConfirmedAt &&            // worker has NOT said "still working"
        !!graceStarted;

      if (!baseConditions) continue;

      // 3a. First reminder at the reminder mark.
      if (graceMs >= cfg.autoClockOutReminderMs && graceMs < cfg.autoClockOutGraceMs && !m.autoClockOutReminderSentAt) {
        await prisma.attendanceMonitor.update({
          where: { id: m.id }, data: { autoClockOutReminderSentAt: now },
        });
        if (m.worker.fcmToken) {
          notificationService.send(m.worker.fcmToken, {
            title: 'Still on shift?',
            body: `Your shift at ${target.name} has ended and you've left the service. Tap to confirm or you'll be clocked out shortly.`,
          }).catch(() => {});
        }
        continue;
      }

      // 3b. Grace elapsed — decide.
      if (graceMs >= cfg.autoClockOutGraceMs) {
        if (latestStillOutside && evidenceAgeMs <= cfg.autoClockOutMaxEvidenceAgeMs) {
          // Strong: auto clock-out with a full audit snapshot.
          const result = await clockService.clockOut(m.workerId, m.houseId, shift.id, 'AUTO', {
            agencyId: shift.agencyId,
            timestamp: now.toISOString(),
            latitude: m.lastLatitude, longitude: m.lastLongitude,
            accuracy: m.lastAccuracy,
            capturedAt: m.lastReadingAt ? m.lastReadingAt.toISOString() : null,
            autoReason: 'AUTO_CLOCK_OUT_AFTER_SHIFT_EXIT',
          });
          await createAuditLog({
            agencyId: shift.agencyId, actorId: null, actorRole: 'SYSTEM',
            action: 'AUTO_CLOCK_OUT_AFTER_SHIFT_EXIT',
            entityType: 'ClockEvent',
            entityId: result?.event?.id || shift.id,
            newValue: {
              shiftId: shift.id,
              scheduledEnd: shift.endTime,
              exitConfirmedAt: m.geofenceExitConfirmedAt,
              graceStartedAt: graceStarted,
              graceMs, requiredGraceMs: cfg.autoClockOutGraceMs,
              lastDistanceMeters: m.lastDistanceMeters,
              geofenceRadius: cfg.geofenceRadiusM,
              lastReadingAt: m.lastReadingAt,
              stillWorkingConfirmed: false,
            },
          });
        } else if (!m.flaggedForReviewAt) {
          // Uncertain — the grace elapsed but the latest GPS evidence is stale or
          // inconclusive. Payroll correctness beats auto-closing an uncertain
          // record, so: DO NOT clock out, DO NOT close the monitor. Flag the
          // timesheet for manager review ONCE, keep the worker clocked in, and
          // let subsequent GPS reports keep driving the state machine — if the
          // evidence later becomes strong, the normal auto-clock-out path runs;
          // if the worker returns onsite, `WORKER_RETURNED_ONSITE` clears this
          // flag so a later exit can be flagged afresh. A manual clock-out or a
          // manager/admin resolution still closes attendance normally.
          if (ts) {
            await prisma.timesheet.update({
              where: { id: ts.id },
              data: {
                needsReview: true,
                reviewReason:
                  'Scheduled shift ended and the worker had left the service, but the GPS evidence was too stale/inconclusive to auto clock-out safely — attendance kept open for manager review.',
              },
            });
          }
          await createAuditLog({
            agencyId: shift.agencyId, actorId: null, actorRole: 'SYSTEM',
            action: 'ATTENDANCE_FLAGGED_FOR_REVIEW',
            entityType: 'Shift', entityId: shift.id,
            newValue: {
              reason: 'AUTO_CLOCK_OUT_EVIDENCE_INSUFFICIENT',
              scheduledEnd: shift.endTime,
              exitConfirmedAt: m.geofenceExitConfirmedAt,
              graceStartedAt: graceStarted,
              lastDistanceMeters: m.lastDistanceMeters,
              lastReadingAt: m.lastReadingAt,
              evidenceAgeMs,
              geofenceRadius: cfg.geofenceRadiusM,
            },
          });
          await prisma.attendanceMonitor.update({
            where: { id: m.id },
            data: { flaggedForReviewAt: now },
          });
        }
        // else: already flagged this episode — do nothing, no duplicate audit.
      }
    } catch (err) {
      console.error('[AttendanceJob] failed for shift', m.shiftId, err.message);
    }
  }
}

module.exports = { attendanceJob };
