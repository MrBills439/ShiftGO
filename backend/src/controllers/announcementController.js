const announcementService = require('../services/announcementService');
const { auditContext, createAuditLog } = require('../services/auditService');
const { agencyIdFor } = require('../utils/agency');
const { ok, created, notFound } = require('../utils/response');

async function listAnnouncements(req, res) {
  const announcements = await announcementService.listAnnouncements(agencyIdFor(req), req.user.id);
  ok(res, announcements);
}

async function listUnreadAnnouncements(req, res) {
  const announcements = await announcementService.listUnreadAnnouncements(agencyIdFor(req), req.user.id);
  ok(res, announcements);
}

async function markAnnouncementRead(req, res) {
  try {
    await announcementService.markAnnouncementRead(req.params.id, req.user.id, agencyIdFor(req));
    ok(res, { id: req.params.id, read: true });
  } catch (err) {
    if (err.statusCode === 404) return notFound(res);
    throw err;
  }
}

async function createAnnouncement(req, res) {
  const announcement = await announcementService.createAnnouncement(req.body, req.user.id, agencyIdFor(req));
  await createAuditLog({
    ...auditContext(req),
    action: 'ANNOUNCEMENT_CREATED',
    entityType: 'Announcement',
    entityId: announcement.id,
    newValue: announcement,
  });
  created(res, announcement);
}

async function deleteAnnouncement(req, res) {
  try {
    await announcementService.deleteAnnouncement(req.params.id, agencyIdFor(req));
    await createAuditLog({
      ...auditContext(req),
      action: 'ANNOUNCEMENT_DELETED',
      entityType: 'Announcement',
      entityId: req.params.id,
    });
    ok(res, { id: req.params.id });
  } catch (err) {
    if (err.statusCode === 404) return notFound(res);
    throw err;
  }
}

module.exports = {
  listAnnouncements, listUnreadAnnouncements, markAnnouncementRead, createAnnouncement, deleteAnnouncement,
};
