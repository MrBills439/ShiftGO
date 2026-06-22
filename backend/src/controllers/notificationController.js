const { PrismaClient } = require('@prisma/client');
const { ok, fail } = require('../utils/response');

const prisma = new PrismaClient();

async function listNotifications(req, res) {
  const notifications = await prisma.notification.findMany({
    where: { userId: req.user.id },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  ok(res, notifications);
}

async function markRead(req, res) {
  const { id } = req.params;
  const notif = await prisma.notification.findUnique({ where: { id } });
  if (!notif || notif.userId !== req.user.id) return fail(res, 'Not found', 404);
  await prisma.notification.update({ where: { id }, data: { read: true } });
  ok(res, { updated: true });
}

async function markAllRead(req, res) {
  await prisma.notification.updateMany({
    where: { userId: req.user.id, read: false },
    data: { read: true },
  });
  ok(res, { updated: true });
}

async function unreadCount(req, res) {
  const count = await prisma.notification.count({
    where: { userId: req.user.id, read: false },
  });
  ok(res, { count });
}

module.exports = { listNotifications, markRead, markAllRead, unreadCount };
