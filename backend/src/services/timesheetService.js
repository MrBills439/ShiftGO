const prisma = require('../lib/prisma');
const PDFDocument = require('pdfkit');
const { send } = require('./notificationService');
const clockService = require('./clockService');

const FUTURE_GRACE_MS = 5 * 60_000; // tolerate small clock skew, never a real future time
const MANAGER_RESOLVED_VERIFICATION = 'MANAGER_RESOLVED_CLOCK_OUT';

async function getMyTimesheets(workerId, agencyId) {
  return prisma.timesheet.findMany({
    where: { agencyId, workerId },
    include: { shift: true, house: true },
    orderBy: { createdAt: 'desc' },
  });
}

async function getHouseTimesheets(houseId, agencyId) {
  return prisma.timesheet.findMany({
    where: { agencyId, houseId },
    include: {
      worker: { select: { id: true, name: true, email: true } },
      shift: true,
      reviewedBy: { select: { id: true, name: true, email: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * Attendance records the system deliberately refused to auto-clock-out (GPS
 * evidence was stale/inconclusive) or otherwise flagged. Agency-wide — a
 * manager should not have to know which house it happened at to find it.
 */
async function getNeedsReview(agencyId) {
  return prisma.timesheet.findMany({
    where: { agencyId, needsReview: true },
    include: {
      worker: { select: { id: true, name: true, email: true } },
      house: { select: { id: true, name: true, address: true } },
      shift: { select: { id: true, startTime: true, endTime: true, shiftType: true, status: true } },
      reviewedBy: { select: { id: true, name: true, email: true } },
    },
    orderBy: { clockInAt: 'desc' },
  });
}

/**
 * Resolve a flagged attendance record.
 *
 * - Still open (no clockOutAt): `clockOutTime` is required. Creates the missing
 *   ClockEvent(OUT) with NO fabricated GPS (coordinates/accuracy/distance stay
 *   null) and a `verification` that clearly marks it as a manager resolution
 *   rather than a GPS-verified clock-out. Closes the AttendanceMonitor through
 *   the shared closeMonitor() so live coordinates are scrubbed the same way as
 *   every other closure path.
 * - Already closed: any `clockOutTime` is ignored (recorded times are never
 *   rewritten here) — this just clears the review flag, covering both the
 *   deliberate "I checked it, no change needed" action and the race where the
 *   worker's own device closed it moments before the manager submitted.
 *
 * Serialised per-shift with the same advisory lock clock-in/out use, so a
 * concurrent manual clock-out, a second manager click, or two managers acting
 * at once can never double-resolve or race the ClockEvent/monitor state.
 */
async function resolveReview(id, resolvedById, agencyId, { clockOutTime, reason } = {}) {
  const resolutionReason = reason?.trim() || null;

  let clockOutDate = null;
  if (clockOutTime) {
    clockOutDate = new Date(clockOutTime);
    if (Number.isNaN(clockOutDate.getTime())) {
      const err = new Error('Clock-out time must be a valid date/time.');
      err.statusCode = 400;
      throw err;
    }
    if (clockOutDate.getTime() > Date.now() + FUTURE_GRACE_MS) {
      const err = new Error('Clock-out time cannot be in the future.');
      err.statusCode = 400;
      throw err;
    }
  }

  const scope = await prisma.timesheet.findFirst({ where: { id, agencyId }, select: { id: true, shiftId: true } });
  if (!scope) {
    const err = new Error('Timesheet not found');
    err.statusCode = 404;
    throw err;
  }

  return prisma.$transaction(async (tx) => {
    // Same per-shift lock as clock-in/out — serialises against a worker's own
    // device clocking out, a background auto-clock-out, and concurrent resolves.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`clock:${scope.shiftId}`}, 0))`;

    const existing = await tx.timesheet.findUnique({ where: { id } });
    if (!existing) {
      const err = new Error('Timesheet not found');
      err.statusCode = 404;
      throw err;
    }
    if (!existing.needsReview) {
      const err = new Error('This attendance record is not flagged for review — it may already have been resolved.');
      err.statusCode = 409;
      throw err;
    }

    const previousReviewReason = existing.reviewReason;
    const wasOpen = !existing.clockOutAt;

    if (wasOpen) {
      if (!clockOutDate) {
        const err = new Error('A clock-out time is required to resolve an open attendance record.');
        err.statusCode = 400;
        throw err;
      }
      if (!existing.clockInAt) {
        const err = new Error('This shift has no recorded clock-in — resolve it from Timesheets directly.');
        err.statusCode = 409;
        throw err;
      }
      if (clockOutDate.getTime() < existing.clockInAt.getTime()) {
        const err = new Error('Clock-out time must be after the clock-in time.');
        err.statusCode = 400;
        throw err;
      }

      // Race guard: an OUT event already exists (e.g. the worker's device just
      // synced) even though the timesheet still looked open — don't create a
      // second one, just bring the timesheet in line and clear the flag.
      const dupeOut = await tx.clockEvent.findFirst({ where: { shiftId: scope.shiftId, type: 'OUT' } });
      if (dupeOut) {
        const updated = await tx.timesheet.update({
          where: { id },
          data: {
            needsReview: false,
            clockOutAt: existing.clockOutAt ?? dupeOut.timestamp,
            reviewedById: resolvedById,
            reviewedAt: new Date(),
          },
        });
        return { mode: 'ALREADY_CLOSED', timesheet: updated, previousReviewReason, ignoredClockOutTime: true };
      }

      const event = await tx.clockEvent.create({
        data: {
          workerId: existing.workerId,
          agencyId,
          houseId: existing.houseId,
          shiftId: scope.shiftId,
          type: 'OUT',
          method: 'MANUAL',
          timestamp: clockOutDate,
          // Deliberately no latitude/longitude/accuracy/distanceMeters/withinGeofence —
          // never fabricate GPS evidence for a manager resolution.
          verification: MANAGER_RESOLVED_VERIFICATION,
        },
      });

      const totalHours = (clockOutDate - existing.clockInAt) / 3_600_000;
      const timesheet = await tx.timesheet.update({
        where: { id },
        data: {
          clockOutAt: clockOutDate,
          totalHours,
          clockOutMethod: 'MANUAL',
          needsReview: false,
          reviewedById: resolvedById,
          reviewedAt: new Date(),
        },
      });

      await tx.shift.updateMany({
        where: { id: scope.shiftId, status: { notIn: ['CANCELLED'] } },
        data: { status: 'COMPLETED' },
      });

      // Same central closure logic every other clock-out path uses — clears
      // the monitor's live coordinates, never just the raw updateMany.
      await clockService.closeMonitor(scope.shiftId, 'MANAGER_RESOLVED', tx, { closedAt: clockOutDate });

      return { mode: 'CLOCKED_OUT', timesheet, event, previousReviewReason, resolutionReason };
    }

    // Already closed — never rewrite recorded times here. Any submitted
    // clockOutTime is ignored (covers both "just clear it" and the race where
    // it closed itself between the manager loading and submitting).
    const timesheet = await tx.timesheet.update({
      where: { id },
      data: { needsReview: false, reviewedById: resolvedById, reviewedAt: new Date() },
    });
    return {
      mode: 'REVIEW_CLEARED',
      timesheet,
      previousReviewReason,
      resolutionReason,
      ignoredClockOutTime: !!clockOutDate,
    };
  });
}

async function confirmTimesheet(id, confirmedById, agencyId) {
  const existing = await prisma.timesheet.findFirst({ where: { id, agencyId } });
  if (!existing) {
    const err = new Error('Timesheet not found');
    err.statusCode = 404;
    throw err;
  }
  if (existing.status !== 'PENDING') {
    const err = new Error('Timesheet has already been reviewed');
    err.statusCode = 409;
    throw err;
  }

  const reviewedAt = new Date();
  const ts = await prisma.timesheet.update({
    where: { id },
    data: {
      status: 'APPROVED',
      rejectionReason: null,
      confirmedById,
      confirmedAt: reviewedAt,
      reviewedById: confirmedById,
      reviewedAt,
    },
    include: {
      worker: { select: { id: true, name: true, email: true, fcmToken: true } },
      house:  true,
      reviewedBy: { select: { id: true, name: true, email: true } },
    },
  });

  if (ts.worker?.fcmToken) {
    const hrs = ts.totalHours ? `${ts.totalHours.toFixed(1)}h` : '';
    await send(ts.worker.fcmToken, {
      title: 'Timesheet confirmed',
      body:  `Your timesheet for ${ts.house.name}${hrs ? ` (${hrs})` : ''} has been confirmed.`,
    });
  }

  return ts;
}

async function rejectTimesheet(id, reviewedById, reason, agencyId) {
  const existing = await prisma.timesheet.findFirst({ where: { id, agencyId } });
  if (!existing) {
    const err = new Error('Timesheet not found');
    err.statusCode = 404;
    throw err;
  }
  if (existing.status !== 'PENDING') {
    const err = new Error('Timesheet has already been reviewed');
    err.statusCode = 409;
    throw err;
  }

  const ts = await prisma.timesheet.update({
    where: { id },
    data: {
      status: 'REJECTED',
      rejectionReason: reason.trim(),
      reviewedById,
      reviewedAt: new Date(),
    },
    include: {
      worker: { select: { id: true, name: true, email: true, fcmToken: true } },
      house: true,
      reviewedBy: { select: { id: true, name: true, email: true } },
    },
  });

  if (ts.worker?.fcmToken) {
    await send(ts.worker.fcmToken, {
      title: 'Timesheet rejected',
      body: `Your timesheet for ${ts.house.name} needs review: ${ts.rejectionReason}`,
    });
  }

  return ts;
}

async function generatePDF(houseId, res, agencyId) {
  const timesheets = await prisma.timesheet.findMany({
    where: { agencyId, houseId, status: 'APPROVED' },
    include: {
      worker: { select: { name: true, email: true } },
      shift: true,
      house: true,
    },
    orderBy: { clockInAt: 'asc' },
  });

  const doc = new PDFDocument({ margin: 50 });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="timesheet-${houseId}.pdf"`);
  doc.pipe(res);

  const house = timesheets[0]?.house;
  doc.fontSize(20).font('Helvetica-Bold').text('ShiftGO — Confirmed Timesheet', { align: 'center' });
  doc.moveDown(0.5);
  if (house) {
    doc.fontSize(14).font('Helvetica').text(`House: ${house.name}`, { align: 'center' });
    doc.text(`Address: ${house.address}`, { align: 'center' });
  }
  doc.moveDown(1);

  const colX = [50, 180, 310, 390, 470];
  doc.fontSize(10).font('Helvetica-Bold');
  doc.text('Worker', colX[0], doc.y, { continued: false });
  const headerY = doc.y - 15;
  doc.text('Worker', colX[0], headerY);
  doc.text('Clock In', colX[1], headerY);
  doc.text('Clock Out', colX[2], headerY);
  doc.text('Hours', colX[3], headerY);
  doc.text('Method', colX[4], headerY);
  doc.moveDown(0.5);
  doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke();
  doc.moveDown(0.3);

  doc.font('Helvetica').fontSize(9);
  for (const ts of timesheets) {
    const y = doc.y;
    const fmt = (d) => d ? new Date(d).toLocaleString('en-GB') : '—';
    doc.text(ts.worker.name, colX[0], y, { width: 120 });
    doc.text(fmt(ts.clockInAt), colX[1], y, { width: 120 });
    doc.text(fmt(ts.clockOutAt), colX[2], y, { width: 75 });
    doc.text(ts.totalHours ? ts.totalHours.toFixed(2) : '—', colX[3], y, { width: 70 });
    doc.text(ts.autoConfirmed ? 'Auto' : 'Manual', colX[4], y);
    doc.moveDown(0.6);
  }

  doc.end();
}

module.exports = {
  getMyTimesheets,
  getHouseTimesheets,
  getNeedsReview,
  resolveReview,
  confirmTimesheet,
  rejectTimesheet,
  generatePDF,
};
