const { PrismaClient } = require('@prisma/client');
const { ok, fail } = require('../utils/response');
const notificationService = require('../services/notificationService');
const { agencyIdFor } = require('../utils/agency');

const prisma = new PrismaClient();

async function listNotifications(req, res) {
  const notifications = await prisma.notification.findMany({
    where: { agencyId: agencyIdFor(req), userId: req.user.id },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  ok(res, notifications);
}

async function markRead(req, res) {
  const { id } = req.params;
  const notif = await prisma.notification.findUnique({ where: { id } });
  if (!notif || notif.userId !== req.user.id || notif.agencyId !== agencyIdFor(req)) return fail(res, 'Not found', 404);
  await prisma.notification.update({ where: { id }, data: { read: true } });
  ok(res, { updated: true });
}

async function markAllRead(req, res) {
  await prisma.notification.updateMany({
    where: { agencyId: agencyIdFor(req), userId: req.user.id, read: false },
    data: { read: true },
  });
  ok(res, { updated: true });
}

async function unreadCount(req, res) {
  const count = await prisma.notification.count({
    where: { agencyId: agencyIdFor(req), userId: req.user.id, read: false },
  });
  ok(res, { count });
}

async function pushStatus(req, res) {
  notificationService.getMessaging();
  const status = notificationService.firebaseStatus();
  const statusCode = status.required && !status.ready ? 503 : 200;
  res.status(statusCode).json({
    success: statusCode === 200,
    data: status,
    timestamp: new Date().toISOString(),
  });
}

async function sendTestPush(req, res) {
  const { token, title = 'ShiftGO test notification', body = 'This is a ShiftGO push notification test.' } = req.body;
  const result = await notificationService.sendPush(token, { title, body });
  if (!result.sent) {
    const statusCode = result.reason === 'firebase-not-ready' ? 503 : 400;
    return res.status(statusCode).json({
      success: false,
      error: {
        code: result.reason === 'firebase-not-ready' ? 'FCM_NOT_READY' : 'FCM_SEND_FAILED',
        message: result.error || result.reason || 'Failed to send push notification',
      },
      data: result,
      timestamp: new Date().toISOString(),
    });
  }
  ok(res, result);
}

module.exports = { listNotifications, markRead, markAllRead, unreadCount, pushStatus, sendTestPush };
