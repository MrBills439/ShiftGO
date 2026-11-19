/**
 * Subject access export (UK GDPR Art. 15): every record ShiftGO holds about one
 * person, as JSON.
 *
 * Scope rules:
 *  - Only the subject's OWN records. Rows that mention colleagues (e.g. who
 *    approved a timesheet) are reduced to the colleague's role, never their
 *    name or contact details.
 *  - Internal secrets and plumbing are left out: password hash, push token,
 *    identity-provider id.
 *  - The right-to-work PDF itself is not embedded; the export says whether one
 *    is on file and it can be downloaded separately.
 *  - The audit trail section lists actions taken on the person's records
 *    (what, when, by which role) — recipients by category, as Art. 15 asks.
 */
const prisma = require('../lib/prisma');

const PROFILE_SELECT = {
  id: true, name: true, email: true, role: true, status: true, phone: true, bio: true, address: true,
  profilePicture: true, contractedHours: true, onboardedAt: true, createdAt: true, updatedAt: true,
  deactivatedAt: true, deactivationReason: true,
  employeeNumber: true, workPatternType: true, employmentType: true, employmentStartDate: true,
  emergencyContactName: true, emergencyContactPhone: true, emergencyContactRelationship: true,
  privacyNoticeVersion: true, privacyNoticeAcknowledgedAt: true,
  agency: { select: { name: true } },
  department: { select: { name: true } },
  jobTitle: { select: { name: true } },
  primaryLocation: { select: { name: true } },
};

async function buildExport(userId, agencyId) {
  const profile = await prisma.user.findFirst({ where: { id: userId, agencyId }, select: PROFILE_SELECT });
  if (!profile) return null;
  const mine = { agencyId, workerId: userId };
  const own = { agencyId, userId };

  const [
    shifts, timesheets, clockEvents, leaveRequests, leaveBalance, leaveLedger, accrualProfile,
    training, dbs, shareCode, notifications, shiftChanges, fixedWorkPatterns, houses, auditTrail,
  ] = await Promise.all([
    prisma.shift.findMany({
      where: mine,
      select: { id: true, startTime: true, endTime: true, date: true, shiftType: true, kind: true, status: true,
        cancellationReason: true, house: { select: { name: true } }, location: { select: { name: true } } },
      orderBy: { startTime: 'desc' },
    }),
    prisma.timesheet.findMany({
      where: mine,
      select: { id: true, shiftId: true, clockInAt: true, clockOutAt: true, totalHours: true, status: true,
        rejectionReason: true, clockInLocationStatus: true, clockOutLocationStatus: true, clockOutMethod: true,
        needsReview: true, reviewReason: true, confirmedAt: true, reviewedAt: true, autoConfirmed: true,
        reviewedBy: { select: { role: true } } },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.clockEvent.findMany({
      where: mine,
      select: { id: true, shiftId: true, type: true, method: true, timestamp: true, capturedAt: true,
        latitude: true, longitude: true, accuracy: true, distanceMeters: true, withinGeofence: true,
        locationStatusResult: true, gpsConfidence: true, verification: true, mockLocationSuspected: true },
      orderBy: { timestamp: 'desc' },
    }),
    prisma.leaveRequest.findMany({
      where: mine,
      select: { id: true, startDate: true, endDate: true, reason: true, status: true, totalHours: true,
        rejectionReason: true, reviewedAt: true, createdAt: true },
      orderBy: { startDate: 'desc' },
    }),
    prisma.leaveBalance.findFirst({ where: own, select: { cycleStartDate: true, carriedOverHours: true, accruedHours: true, lastAccrualAt: true } }),
    prisma.leaveLedgerEntry.findMany({ where: own, select: { type: true, hours: true, description: true, effectiveAt: true }, orderBy: { effectiveAt: 'desc' } }),
    prisma.leaveAccrualProfile.findFirst({ where: own, select: { method: true, payPeriod: true, flatRateHours: true, hourlyAccrualRate: true, lumpSumHours: true, accrualStartDate: true } }),
    prisma.training.findMany({ where: own, select: { title: true, description: true, status: true, completedAt: true, expiresAt: true, createdAt: true } }),
    prisma.dbsCheck.findFirst({ where: own, select: { status: true, reference: true, issuedAt: true, expiresAt: true, notes: true, updatedAt: true } }),
    prisma.shareCode.findFirst({ where: own, select: { code: true, shareDate: true, documentName: true, documentPath: true, notes: true, updatedAt: true } }),
    prisma.notification.findMany({ where: own, select: { type: true, title: true, body: true, read: true, createdAt: true }, orderBy: { createdAt: 'desc' } }),
    prisma.shiftChangeRequest.findMany({
      where: { agencyId, OR: [{ requesterId: userId }, { targetWorkerId: userId }] },
      select: { id: true, type: true, status: true, requesterReason: true, recipientResponse: true,
        managerDecisionAt: true, managerReason: true, createdAt: true, requesterId: true, targetWorkerId: true },
    }),
    prisma.fixedWorkPattern.findMany({
      where: { agencyId, workerId: userId },
      select: { effectiveFrom: true, effectiveTo: true, status: true, timezone: true,
        location: { select: { name: true } }, days: { select: { weekday: true, startTime: true, endTime: true } } },
    }),
    prisma.houseWorker.findMany({ where: { workerId: userId }, select: { house: { select: { name: true, agencyId: true } } } }),
    prisma.auditLog.findMany({
      where: {
        agencyId,
        OR: [
          { entityType: 'User', entityId: userId },
          { newValue: { path: ['subjectUserId'], equals: userId } },
          { oldValue: { path: ['subjectUserId'], equals: userId } },
        ],
      },
      select: { action: true, entityType: true, actorRole: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 5000,
    }),
  ]);

  return {
    exportedAt: new Date().toISOString(),
    format: 'shiftgo-subject-access-export/v1',
    notes: [
      'This file contains the personal data LeafRota holds about you on behalf of your employer.',
      'Colleagues who acted on your records are shown by role only.',
      'Right-to-work document files are not embedded; hasDocument shows whether one is on file.',
      'GPS coordinates older than the retention period have been removed; the attendance outcome is kept.',
    ],
    profile,
    services: houses.filter((h) => h.house.agencyId === agencyId).map((h) => h.house.name),
    shifts,
    timesheets: timesheets.map(({ reviewedBy, ...t }) => ({ ...t, reviewedByRole: reviewedBy?.role ?? null })),
    clockEvents,
    leave: { requests: leaveRequests, balance: leaveBalance, ledger: leaveLedger, accrualPolicy: accrualProfile },
    training,
    dbsCheck: dbs,
    rightToWork: shareCode && {
      code: shareCode.code, shareDate: shareCode.shareDate, notes: shareCode.notes, updatedAt: shareCode.updatedAt,
      hasDocument: Boolean(shareCode.documentPath), documentName: shareCode.documentName,
    },
    notifications,
    shiftChangeRequests: shiftChanges.map(({ requesterId, targetWorkerId, ...r }) => ({
      ...r, yourRole: requesterId === userId ? 'REQUESTER' : 'RECIPIENT',
    })),
    fixedWorkPatterns,
    activityOnYourRecords: auditTrail,
  };
}

module.exports = { buildExport };
