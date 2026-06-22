const { PrismaClient } = require('@prisma/client');
const config = require('../config');

const prisma = new PrismaClient();
let messaging = null;

function getMessaging() {
  if (messaging) return messaging;
  if (!config.firebase.projectId) return null;
  try {
    const admin = require('firebase-admin');
    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId: config.firebase.projectId,
          clientEmail: config.firebase.clientEmail,
          privateKey: config.firebase.privateKey,
        }),
      });
    }
    messaging = admin.messaging();
  } catch {
    messaging = null;
  }
  return messaging;
}

async function sendPush(fcmToken, notification) {
  const msg = getMessaging();
  if (!msg || !fcmToken) return;
  try {
    await msg.send({ token: fcmToken, notification });
  } catch (err) {
    console.error('[FCM]', err.message);
  }
}

async function createAndSend(userId, type, title, body, data = null) {
  await prisma.notification.create({ data: { userId, type, title, body, data } });
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { fcmToken: true } });
  if (user?.fcmToken) await sendPush(user.fcmToken, { title, body });
}

async function sendShiftAssigned(worker, shift, house) {
  const start = new Date(shift.startTime).toLocaleString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short',
    hour: '2-digit', minute: '2-digit',
  });
  await createAndSend(
    worker.id,
    'SHIFT_ASSIGNED',
    'New Shift Assigned',
    `You have been assigned a shift at ${house.name} on ${start}.`,
    { shiftId: shift.id },
  );
}

async function sendShiftRemoved(worker, shift, house) {
  const start = new Date(shift.startTime).toLocaleString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short',
    hour: '2-digit', minute: '2-digit',
  });
  await createAndSend(
    worker.id,
    'SHIFT_REMOVED',
    'Shift Removed',
    `Your shift at ${house.name} on ${start} has been cancelled.`,
    { shiftId: shift.id },
  );
}

async function sendMissedClockInAlert(worker, house) {
  if (!worker?.fcmToken) return;
  await sendPush(worker.fcmToken, {
    title: 'Missed Clock-In',
    body: `Your shift at ${house.name} has started but you haven't clocked in.`,
  });
}

async function sendClockOutPrompt(worker, house) {
  if (!worker?.fcmToken) return;
  await sendPush(worker.fcmToken, {
    title: 'Are you leaving?',
    body: `You appear to have left ${house.name}. Clock out or stay clocked in?`,
  });
}

// keep legacy alias
const send = sendPush;

module.exports = {
  send,
  sendPush,
  sendShiftAssigned,
  sendShiftRemoved,
  sendMissedClockInAlert,
  sendClockOutPrompt,
  createAndSend,
};
