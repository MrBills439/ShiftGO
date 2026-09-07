const prisma = require('../lib/prisma');
const notificationService = require('./notificationService');

const announcementInclude = {
  author: { select: { id: true, name: true, role: true } },
};

/**
 * Best-effort fan-out of a freshly-created announcement to every active member
 * of the agency (except the author): an in-app Notification row + a push
 * attempt, via the shared createAndSend. Runs AFTER the announcement row is
 * committed and never throws — a notification or push failure must not roll
 * back or hide the announcement. Idempotent per (user, announcement) so a
 * retry cannot double-notify for the same announcement.
 */
async function notifyAgencyOfAnnouncement(announcement, agencyId) {
  let recipients = [];
  try {
    recipients = await prisma.user.findMany({
      where: { agencyId, status: 'ACTIVE', id: { not: announcement.authorId } },
      select: { id: true },
    });
  } catch (err) {
    console.error('[Announcement] could not load recipients:', err.message);
    return;
  }

  // One query for everyone already notified about THIS announcement (retry
  // idempotency) instead of a per-recipient findFirst.
  let alreadyNotified = new Set();
  try {
    const existing = await prisma.notification.findMany({
      where: {
        type: 'GENERAL',
        userId: { in: recipients.map((r) => r.id) },
        data: { path: ['announcementId'], equals: announcement.id },
      },
      select: { userId: true },
    });
    alreadyNotified = new Set(existing.map((n) => n.userId));
  } catch (err) {
    console.error('[Announcement] dedup lookup failed, continuing:', err.message);
  }

  await Promise.allSettled(
    recipients
      .filter((r) => !alreadyNotified.has(r.id))
      .map(async (r) => {
        await notificationService.createAndSend(
          r.id,
          'GENERAL',
          announcement.title,
          announcement.body,
          { kind: 'ANNOUNCEMENT', announcementId: announcement.id },
        );
      }),
  ).then((results) => {
    const failed = results.filter((x) => x.status === 'rejected');
    if (failed.length) {
      console.error(`[Announcement] ${failed.length}/${recipients.length} notifications failed:`, failed[0].reason?.message);
    }
  });
}

function withReadFlag(announcement) {
  const { reads, ...rest } = announcement;
  return { ...rest, read: (reads?.length ?? 0) > 0 };
}

// NOTE: this list is unbounded. Proper cursor/limit pagination is a deliberate
// future API change to be rolled out together with the web + mobile consumers
// (it alters the response contract). Ordering stays pinned-first, then newest.
async function listAnnouncements(agencyId, userId) {
  const announcements = await prisma.announcement.findMany({
    where: { agencyId },
    include: { ...announcementInclude, reads: { where: { userId }, select: { id: true } } },
    orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }],
  });
  return announcements.map(withReadFlag);
}

async function listUnreadAnnouncements(agencyId, userId) {
  const announcements = await prisma.announcement.findMany({
    where: { agencyId, reads: { none: { userId } } },
    include: announcementInclude,
    orderBy: [{ pinned: 'desc' }, { createdAt: 'asc' }],
  });
  return announcements;
}

async function createAnnouncement(data, authorId, agencyId) {
  const announcement = await prisma.announcement.create({
    data: {
      agencyId,
      authorId,
      title: data.title.trim(),
      body: data.body.trim(),
      pinned: Boolean(data.pinned),
    },
    include: announcementInclude,
  });

  // Row is committed — fan-out is best-effort and cannot undo it.
  await notifyAgencyOfAnnouncement(announcement, agencyId);

  return { ...announcement, read: false };
}

async function markAnnouncementRead(id, userId, agencyId) {
  const existing = await prisma.announcement.findFirst({ where: { id, agencyId } });
  if (!existing) {
    const err = new Error('NOT_FOUND');
    err.statusCode = 404;
    throw err;
  }
  await prisma.announcementRead.upsert({
    where: { announcementId_userId: { announcementId: id, userId } },
    create: { announcementId: id, userId },
    update: {},
  });
}

async function deleteAnnouncement(id, agencyId) {
  const existing = await prisma.announcement.findFirst({ where: { id, agencyId } });
  if (!existing) {
    const err = new Error('NOT_FOUND');
    err.statusCode = 404;
    throw err;
  }
  await prisma.announcement.delete({ where: { id } });
}

module.exports = {
  listAnnouncements, listUnreadAnnouncements, createAnnouncement, markAnnouncementRead, deleteAnnouncement,
  notifyAgencyOfAnnouncement,
};
