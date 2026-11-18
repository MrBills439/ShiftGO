/**
 * "Delete my account" requests (UK GDPR Art. 17, App Store / Google Play
 * account-deletion rules).
 *
 * The agency is the controller and must keep some records by law, so a request
 * goes to HR instead of wiping data on the spot. HR either rejects it (with a
 * reason) or completes it. Completing requires the account to be DEACTIVATED
 * first (the normal offboarding flow, which also suspends sign-in), then erases
 * everything there is no legal reason to keep:
 *
 *   ERASED  phone, address, bio, emergency contact, profile photo, push token,
 *           notifications, exact GPS coordinates, DBS check (DBS guidance: do
 *           not keep beyond need)
 *   KEPT    name + email (identify retained records), shifts, timesheets,
 *           leave, training (payroll: 6 years; CQC evidence); the right-to-work
 *           record is removed by the retention job 2 years after leaving.
 */
const path = require('path');
const fs = require('fs');
const prisma = require('../lib/prisma');
const storage = require('../lib/storage');
const notificationService = require('./notificationService');

function httpErr(message, statusCode, code) {
  const e = new Error(message);
  e.statusCode = statusCode;
  if (code) e.code = code;
  return e;
}

const SELECT = {
  id: true, status: true, reason: true, resolvedAt: true, resolutionNote: true, createdAt: true,
  user: { select: { id: true, name: true, email: true, status: true, role: true } },
  resolvedBy: { select: { id: true, name: true } },
};

async function latestForUser(user) {
  return prisma.accountDeletionRequest.findFirst({
    where: { agencyId: user.agencyId, userId: user.id }, orderBy: { createdAt: 'desc' }, select: SELECT,
  });
}

async function request(user, reason) {
  const pending = await prisma.accountDeletionRequest.findFirst({
    where: { agencyId: user.agencyId, userId: user.id, status: 'PENDING' }, select: { id: true },
  });
  if (pending) throw httpErr('You already have a deletion request waiting for HR.', 409, 'ALREADY_REQUESTED');
  const created = await prisma.accountDeletionRequest.create({
    data: { agencyId: user.agencyId, userId: user.id, reason: reason ? String(reason).trim().slice(0, 1000) || null : null },
    select: SELECT,
  });
  // Tell every active HR user. Best effort — the request stands either way.
  const hrUsers = await prisma.user.findMany({ where: { agencyId: user.agencyId, role: 'HR', status: 'ACTIVE' }, select: { id: true } });
  await Promise.all(hrUsers.map((hr) => notificationService
    .createAndSend(hr.id, 'GENERAL', 'Account deletion request', `${created.user.name} has asked for their account to be deleted.`, { deletionRequestId: created.id })
    .catch(() => {})));
  return created;
}

async function cancel(user) {
  const pending = await prisma.accountDeletionRequest.findFirst({
    where: { agencyId: user.agencyId, userId: user.id, status: 'PENDING' }, select: { id: true },
  });
  if (!pending) throw httpErr('There is no pending deletion request to cancel.', 404, 'NOT_FOUND');
  return prisma.accountDeletionRequest.update({ where: { id: pending.id }, data: { status: 'CANCELLED' }, select: SELECT });
}

async function listForAgency(agencyId, status = 'PENDING') {
  return prisma.accountDeletionRequest.findMany({
    where: { agencyId, ...(status === 'ALL' ? {} : { status }) }, orderBy: { createdAt: 'desc' }, select: SELECT,
  });
}

async function loadPending(id, agencyId) {
  const req = await prisma.accountDeletionRequest.findFirst({
    where: { id, agencyId }, select: { id: true, status: true, userId: true },
  });
  if (!req) throw httpErr('Deletion request not found', 404, 'NOT_FOUND');
  if (req.status !== 'PENDING') throw httpErr('This request has already been handled.', 409, 'INVALID_STATUS');
  return req;
}

async function reject(id, agencyId, resolverId, note) {
  const req = await loadPending(id, agencyId);
  const updated = await prisma.accountDeletionRequest.update({
    where: { id: req.id },
    data: { status: 'REJECTED', resolvedById: resolverId, resolvedAt: new Date(), resolutionNote: note },
    select: SELECT,
  });
  await notificationService
    .createAndSend(req.userId, 'GENERAL', 'Account deletion request', `HR has replied to your deletion request: ${note}`)
    .catch(() => {});
  return updated;
}

async function complete(id, agencyId, resolverId, note) {
  const req = await loadPending(id, agencyId);
  const subject = await prisma.user.findFirst({
    where: { id: req.userId, agencyId }, select: { id: true, status: true, profilePicture: true },
  });
  if (subject.status !== 'DEACTIVATED') {
    throw httpErr('Deactivate this employee first (Staff → Deactivate), then complete the deletion.', 409, 'NOT_DEACTIVATED');
  }

  const erased = await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: subject.id },
      data: {
        phone: null, address: null, bio: null, profilePicture: null, fcmToken: null,
        emergencyContactName: null, emergencyContactPhone: null, emergencyContactRelationship: null,
      },
    });
    const notifications = await tx.notification.deleteMany({ where: { userId: subject.id } });
    const gps = await tx.clockEvent.updateMany({
      where: { workerId: subject.id, OR: [{ latitude: { not: null } }, { longitude: { not: null } }] },
      data: { latitude: null, longitude: null },
    });
    await tx.attendanceMonitor.updateMany({ where: { workerId: subject.id }, data: { lastLatitude: null, lastLongitude: null } });
    const dbs = await tx.dbsCheck.deleteMany({ where: { userId: subject.id } });
    const updated = await tx.accountDeletionRequest.update({
      where: { id: req.id },
      data: { status: 'COMPLETED', resolvedById: resolverId, resolvedAt: new Date(), resolutionNote: note || null },
      select: SELECT,
    });
    return { request: updated, counts: { notifications: notifications.count, gpsPoints: gps.count, dbsRecords: dbs.count } };
  });

  // Profile photo file: only after the DB no longer points at it.
  if (typeof subject.profilePicture === 'string' && subject.profilePicture.startsWith('/uploads/avatars/')) {
    const abs = storage.resolveStoredPath(subject.profilePicture);
    if (abs && abs.startsWith(storage.AVATARS_DIR + path.sep)) fs.promises.unlink(abs).catch(() => {});
  }
  return { ...erased.request, erased: { ...erased.counts, profilePhoto: Boolean(subject.profilePicture), contactDetails: true } };
}

module.exports = { request, cancel, latestForUser, listForAgency, reject, complete };
