const prisma = require('../lib/prisma');

const announcementInclude = {
  author: { select: { id: true, name: true, role: true } },
};

function withReadFlag(announcement) {
  const { reads, ...rest } = announcement;
  return { ...rest, read: (reads?.length ?? 0) > 0 };
}

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
};
