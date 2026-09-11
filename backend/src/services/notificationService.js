const prisma = require('../lib/prisma');
const config = require('../config');
const agencyCache = require('../lib/agencyCache');
const { resolveTimeZone } = require('../lib/agencyTime');
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

/**
 * Effective timezone for a shift-assignment message: the target's own
 * timezone if it has one (a FIXED shift's Location), else the agency's —
 * exactly the same `target.timezone -> Agency.timezone` fallback chain
 * fixedWorkPatternGenerationService uses to convert a pattern's wall-clock
 * times to UTC. A ROTA shift's HOUSE target never carries a timezone (care
 * attendance always inherits the agency's), so this is what already decided
 * "whose clock" for it before this phase — nothing changes there.
 */
async function resolveNotificationTimezone(target, agencyId) {
  if (target?.timezone) return resolveTimeZone(target.timezone);
  const agency = await agencyCache.getAgencySettings(agencyId);
  return resolveTimeZone(agency?.timezone);
}

/** Same display shape every notification here has always used
 *  ("Mon, 5 Jan, 09:00"), now explicit about WHICH clock it's read in rather
 *  than silently taking the server's (UTC on Railway) — the one genuinely
 *  necessary refactor for FIXED shifts to show correct local time; ROTA's
 *  wording/format is unchanged. */
function formatShiftDateTime(date, timeZone) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  }).format(new Date(date));
}

/**
 * Assignment notification — target-aware (Recurring Fixed Work Patterns V1
 * Phase 4). `target` is whatever attendanceTargetService.attendanceTargetFor
 * resolved for this shift: `{ type: 'HOUSE'|'LOCATION', id, name, timezone }`
 * — a ROTA shift's House or a FIXED shift's Location, never a fake House.
 * Message text only ever says "at {target.name}", so it reads naturally for
 * either kind without branching on `target.type`.
 */
async function sendShiftAssigned({ worker, shift, target }) {
  const timeZone = await resolveNotificationTimezone(target, shift.agencyId);
  const start = formatShiftDateTime(shift.startTime, timeZone);
  await createAndSend(
    worker.id,
    'SHIFT_ASSIGNED',
    'New Shift Assigned',
    `You have been assigned a shift at ${target.name} on ${start}.`,
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

async function sendShiftOpen(workers, shift, house) {
  const start = new Date(shift.startTime).toLocaleString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short',
    hour: '2-digit', minute: '2-digit',
  });
  await Promise.all(workers.map((worker) => createAndSend(
    worker.id,
    'SHIFT_OPEN',
    'New Open Shift',
    `A shift at ${house.name} on ${start} is open — claim it in the app.`,
    { shiftId: shift.id },
  )));
}

async function sendShiftDropped(recipients, shift, house, worker, reason) {
  const start = new Date(shift.startTime).toLocaleString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short',
    hour: '2-digit', minute: '2-digit',
  });
  const body = `${worker.name} has dropped their shift at ${house.name} on ${start}. It is now open for cover.${reason ? ` Reason: ${reason}` : ''}`;
  await Promise.all(recipients.map((r) => createAndSend(
    r.id,
    'SHIFT_DROPPED',
    'Shift Dropped',
    body,
    { shiftId: shift.id, workerId: worker.id },
  )));
}

async function sendShiftClaimedYou(worker, shift, house) {
  const start = new Date(shift.startTime).toLocaleString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short',
    hour: '2-digit', minute: '2-digit',
  });
  await createAndSend(
    worker.id,
    'SHIFT_CLAIMED_YOU',
    'Shift Claimed',
    `You claimed the shift at ${house.name} on ${start}.`,
    { shiftId: shift.id },
  );
}

async function sendShiftClaimedOther(workers, shift, house) {
  await Promise.all(workers.map((worker) => createAndSend(
    worker.id,
    'SHIFT_CLAIMED_OTHER',
    'Shift No Longer Available',
    `The open shift at ${house.name} has been claimed by another worker.`,
    { shiftId: shift.id },
  )));
}

function formatLeaveRange(start, end) {
  const s = new Date(start).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  const e = new Date(end).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  return s === e ? s : `${s} – ${e}`;
}

/** Payroll team (HR) — a worker has submitted an annual-leave request. */
async function sendLeaveSubmittedToPayroll(recipients, leave, worker, durationLabel) {
  const range = formatLeaveRange(leave.startDate, leave.endDate);
  await Promise.all(recipients.map((r) => createAndSend(
    r.id,
    'GENERAL',
    'Leave request — payroll',
    `${worker.name} has requested annual leave for ${range} (${durationLabel}). It is awaiting approval.`,
    { leaveRequestId: leave.id, workerId: worker.id, kind: 'LEAVE_SUBMITTED' },
  )));
}

/** Payroll team (HR) — an annual-leave request has been approved; update payroll. */
async function sendLeaveApprovedToPayroll(recipients, leave, worker, durationLabel) {
  const range = formatLeaveRange(leave.startDate, leave.endDate);
  await Promise.all(recipients.map((r) => createAndSend(
    r.id,
    'GENERAL',
    'Approved leave — action payroll',
    `${worker.name}'s annual leave for ${range} (${durationLabel}) has been approved. Please update payroll.`,
    { leaveRequestId: leave.id, workerId: worker.id, kind: 'LEAVE_APPROVED_PAYROLL' },
  )));
}

/** Payroll team (HR) — a previously approved leave was cancelled; reverse it in payroll. */
async function sendLeaveCancelledToPayroll(recipients, leave, worker, durationLabel) {
  const range = formatLeaveRange(leave.startDate, leave.endDate);
  await Promise.all(recipients.map((r) => createAndSend(
    r.id,
    'GENERAL',
    'Cancelled leave — action payroll',
    `${worker.name}'s previously approved annual leave for ${range} (${durationLabel}) has been cancelled. Please update payroll.`,
    { leaveRequestId: leave.id, workerId: worker.id, kind: 'LEAVE_CANCELLED_PAYROLL' },
  )));
}

/** The worker — their leave request was approved or declined. */
async function sendLeaveDecisionToWorker(worker, leave, decision, reason) {
  const range = formatLeaveRange(leave.startDate, leave.endDate);
  const approved = decision === 'APPROVED';
  await createAndSend(
    worker.id,
    'GENERAL',
    approved ? 'Leave approved' : 'Leave declined',
    approved
      ? `Your annual leave for ${range} has been approved.`
      : `Your annual leave for ${range} was declined${reason ? `: ${reason}` : '.'}`,
    { leaveRequestId: leave.id, kind: 'LEAVE_DECISION' },
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
  sendShiftOpen,
  sendShiftDropped,
  sendShiftClaimedYou,
  sendShiftClaimedOther,
  sendLeaveSubmittedToPayroll,
  sendLeaveApprovedToPayroll,
  sendLeaveCancelledToPayroll,
  sendLeaveDecisionToWorker,
  sendMissedClockInAlert,
  sendClockOutPrompt,
  createAndSend,
};
