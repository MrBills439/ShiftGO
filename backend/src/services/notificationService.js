const { PrismaClient } = require('@prisma/client');
const config = require('../config');

const prisma = new PrismaClient();
let messaging = null;
let initError = null;

function isPlaceholder(value) {
  if (!value) return true;
  return /your_|YOUR_|xxxxx|PRIVATE_KEY_HERE|placeholder/i.test(value);
}

function firebaseStatus() {
  const missing = [];
  if (isPlaceholder(config.firebase.projectId)) missing.push('FIREBASE_PROJECT_ID');
  if (isPlaceholder(config.firebase.clientEmail)) missing.push('FIREBASE_CLIENT_EMAIL');
  if (isPlaceholder(config.firebase.privateKey)) missing.push('FIREBASE_PRIVATE_KEY');

  return {
    required: config.firebase.required,
    configured: missing.length === 0,
    ready: Boolean(messaging) && missing.length === 0 && !initError,
    missing,
    error: initError?.message || null,
  };
}

function getMessaging() {
  if (messaging) return messaging;
  const status = firebaseStatus();
  if (!status.configured) {
    initError = null;
    return null;
  }
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
    initError = null;
  } catch (err) {
    initError = err;
    console.error('[FCM] Firebase Admin initialization failed:', err.message);
    messaging = null;
  }
  return messaging;
}

async function sendPush(fcmToken, notification) {
  const msg = getMessaging();
  if (!msg || !fcmToken) {
    return {
      sent: false,
      reason: !fcmToken ? 'missing-token' : 'firebase-not-ready',
      status: firebaseStatus(),
    };
  }
  try {
    const messageId = await msg.send({ token: fcmToken, notification });
    return { sent: true, messageId };
  } catch (err) {
    console.error('[FCM]', err.message);
    return { sent: false, reason: 'send-failed', error: err.message };
  }
}

async function createAndSend(userId, type, title, body, data = null) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { fcmToken: true, agencyId: true } });
  await prisma.notification.create({ data: { agencyId: user?.agencyId || 'default-agency', userId, type, title, body, data } });
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
  firebaseStatus,
  getMessaging,
  sendShiftAssigned,
  sendShiftRemoved,
  sendMissedClockInAlert,
  sendClockOutPrompt,
  createAndSend,
};
