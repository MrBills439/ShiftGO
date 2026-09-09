/**
 * Shift Cover + Shift Swap.
 *
 * A worker asks a teammate to take one of their future shifts (COVER), or to
 * exchange it for one of the teammate's future shifts (SWAP). Nothing about a
 * shift's ownership changes until a MANAGER/HR approves — approval re-runs the
 * exact same overlap / approved-leave / weekly-hours gates the normal
 * assignment flow uses (see shiftService.validateWorkerAssignment) against
 * CURRENT data, inside one transaction.
 *
 * Reuses: shiftService.validateWorkerAssignment (overlap + leave + weekly hours
 * + MANAGER/HR override), staffAllocationService.evaluateAssignment (projected
 * hours), leaveRequestService.checkLeaveConflict, agencyTime, auditService,
 * notificationService.createAndSend, roleGuard conventions.
 */
const prisma = require('../lib/prisma');
const shiftService = require('./shiftService');
const { evaluateAssignment } = require('./staffAllocationService');
const { checkLeaveConflict } = require('./leaveRequestService');
const agencyCache = require('../lib/agencyCache');
const { createAuditLog } = require('./auditService');
const { createAndSend } = require('./notificationService');

// A request is "in flight" (still blocks the shift, still cancellable) in these
// two states only.
const INFLIGHT = ['PENDING_RECIPIENT', 'PENDING_MANAGER'];

// Shift states a worker may still hand off — assigned, future, not started.
const HANDOFFABLE_SHIFT_STATUS = ['SCHEDULED', 'CLAIMED'];

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

function httpErr(message, statusCode, code) {
  const e = new Error(message);
  e.statusCode = statusCode;
  if (code) e.code = code;
  return e;
}

const requestInclude = {
  requester: { select: { id: true, name: true } },
  targetWorker: { select: { id: true, name: true } },
  manager: { select: { id: true, name: true } },
  primaryShift: {
    select: {
      id: true, startTime: true, endTime: true, shiftType: true, status: true,
      workerId: true, houseId: true, house: { select: { id: true, name: true } },
    },
  },
  swapShift: {
    select: {
      id: true, startTime: true, endTime: true, shiftType: true, status: true,
      workerId: true, houseId: true, house: { select: { id: true, name: true } },
    },
  },
};

function shiftDto(s) {
  if (!s) return null;
  return {
    id: s.id,
    startTime: s.startTime,
    endTime: s.endTime,
    shiftType: s.shiftType,
    status: s.status,
    house: s.house ? { id: s.house.id, name: s.house.name } : null,
  };
}

/** A request can no longer be actioned once any shift it touches has started. */
function isExpired(request, now = new Date()) {
  const t = now.getTime();
  if (new Date(request.primaryShift.startTime).getTime() <= t) return true;
  if (request.swapShift && new Date(request.swapShift.startTime).getTime() <= t) return true;
  return false;
}

function serialize(request, now = new Date()) {
  const expired = INFLIGHT.includes(request.status) && isExpired(request, now);
  return {
    id: request.id,
    type: request.type,
    status: request.status,
    expired,
    requesterReason: request.requesterReason ?? null,
    managerReason: request.managerReason ?? null,
    recipientResponse: request.recipientResponse ?? null,
    recipientRespondedAt: request.recipientRespondedAt ?? null,
    managerDecisionAt: request.managerDecisionAt ?? null,
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
    requester: request.requester ? { id: request.requester.id, name: request.requester.name } : null,
    targetWorker: request.targetWorker ? { id: request.targetWorker.id, name: request.targetWorker.name } : null,
    manager: request.manager ? { id: request.manager.id, name: request.manager.name } : null,
    primaryShift: shiftDto(request.primaryShift),
    swapShift: shiftDto(request.swapShift),
  };
}

// ─── Notifications ─────────────────────────────────────────────────────────
// Reuse the generic GENERAL type (like the leave flow) with structured
// metadata — no schema enum change. Metadata carries only ids + labels.
function notify(userId, title, body, data) {
  return createAndSend(userId, 'GENERAL', title, body, { kind: 'SHIFT_CHANGE', ...data }).catch((e) =>
    console.error('[Notify] shift-change', data.event, e.message),
  );
}

function shiftLabel(s) {
  const start = new Date(s.startTime).toLocaleString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });
  const end = new Date(s.endTime).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  return `${start}–${end} at ${s.house?.name ?? 'a service'}`;
}

function notifyRecipientNewRequest(req) {
  const meta = { event: req.type === 'SWAP' ? 'SWAP_REQUEST_RECEIVED' : 'COVER_REQUEST_RECEIVED', requestId: req.id, type: req.type, shiftId: req.primaryShiftId, swapShiftId: req.swapShiftId ?? null };
  if (req.type === 'SWAP') {
    return notify(req.targetWorkerId,
      'Shift swap request',
      `${req.requester.name} wants to swap their ${shiftLabel(req.primaryShift)} for your ${shiftLabel(req.swapShift)}.`,
      meta);
  }
  return notify(req.targetWorkerId,
    'Shift cover request',
    `${req.requester.name} has asked you to cover ${shiftLabel(req.primaryShift)}.`,
    meta);
}

function notifyManagersPendingApproval(req, managerIds) {
  return Promise.all(managerIds.map((id) => notify(id,
    'Shift change needs approval',
    `${req.requester.name} and ${req.targetWorker.name} agreed a shift ${req.type.toLowerCase()} — it needs your approval.`,
    { event: 'SHIFT_CHANGE_PENDING_APPROVAL', requestId: req.id, type: req.type, shiftId: req.primaryShiftId, swapShiftId: req.swapShiftId ?? null })));
}

function notifyRequesterResponded(req, accepted) {
  return notify(req.requesterId,
    accepted ? 'Teammate accepted' : 'Teammate declined',
    accepted
      ? `${req.targetWorker.name} accepted your shift ${req.type.toLowerCase()} — it now needs manager approval.`
      : `${req.targetWorker.name} declined your shift ${req.type.toLowerCase()} request.`,
    { event: accepted ? 'SHIFT_CHANGE_ACCEPTED' : 'SHIFT_CHANGE_DECLINED', requestId: req.id, type: req.type, shiftId: req.primaryShiftId });
}

function notifyDecision(req, event, body) {
  const meta = { event, requestId: req.id, type: req.type, shiftId: req.primaryShiftId, swapShiftId: req.swapShiftId ?? null };
  const targets = [req.requesterId, req.targetWorkerId].filter(Boolean);
  return Promise.all(targets.map((id) => notify(id, event === 'SHIFT_CHANGE_APPROVED' ? 'Shift change approved' : 'Shift change update', body, meta)));
}

// ─── Shared preconditions ─────────────────────────────────────────────────

/** Load a shift in the agency the requester actually owns and may still hand
 *  off: future, not started, not completed/cancelled/in-progress, no clock-in. */
async function loadHandoffableShift(shiftId, ownerId, agencyId, { label = 'shift', now = new Date() } = {}) {
  const shift = await prisma.shift.findFirst({
    where: { id: shiftId, agencyId },
    select: { id: true, workerId: true, status: true, startTime: true, endTime: true, houseId: true, shiftType: true },
  });
  if (!shift) throw httpErr(`That ${label} was not found in your agency`, 404, 'SHIFT_NOT_FOUND');
  if (shift.status === 'OPEN' || !shift.workerId) throw httpErr(`An open/unassigned ${label} cannot be changed`, 409, 'SHIFT_NOT_ASSIGNED');
  if (shift.workerId !== ownerId) throw httpErr(`That ${label} is not assigned to the expected worker`, 403, 'NOT_SHIFT_OWNER');
  if (shift.status === 'CANCELLED') throw httpErr(`A cancelled ${label} cannot be changed`, 409, 'SHIFT_NOT_CHANGEABLE');
  if (shift.status === 'COMPLETED') throw httpErr(`A completed ${label} cannot be changed`, 409, 'SHIFT_NOT_CHANGEABLE');
  if (shift.status === 'IN_PROGRESS') throw httpErr(`A shift already in progress cannot be changed`, 409, 'SHIFT_IN_PROGRESS');
  if (new Date(shift.startTime).getTime() <= now.getTime()) throw httpErr(`That ${label} has already started`, 409, 'SHIFT_STARTED');

  const started = await prisma.clockEvent.findFirst({ where: { shiftId: shift.id, type: 'IN' }, select: { id: true } });
  if (started) throw httpErr(`Work has already begun on that ${label}`, 409, 'SHIFT_CLOCKED_IN');
  return shift;
}

/** Reject a second in-flight request against the same shift (as primary OR swap). */
async function assertNoActiveRequestForShift(shiftId) {
  const existing = await prisma.shiftChangeRequest.findFirst({
    where: { status: { in: INFLIGHT }, OR: [{ primaryShiftId: shiftId }, { swapShiftId: shiftId }] },
    select: { id: true },
  });
  if (existing) throw httpErr('There is already an active cover/swap request for this shift', 409, 'DUPLICATE_REQUEST');
}

async function loadActiveWorkerInAgency(workerId, agencyId, { requesterId } = {}) {
  const w = await prisma.user.findFirst({
    where: { id: workerId, agencyId },
    select: { id: true, name: true, role: true, status: true, contractedHours: true },
  });
  if (!w) throw httpErr('That teammate is not in your agency', 403, 'CROSS_AGENCY');
  if (requesterId && w.id === requesterId) throw httpErr('You cannot send a request to yourself', 400, 'SELF_TARGET');
  if (w.status !== 'ACTIVE') throw httpErr('That teammate is not active', 409, 'RECIPIENT_INACTIVE');
  if (!['WORKER', 'TEAM_LEADER'].includes(w.role)) throw httpErr('That person cannot be assigned shifts', 409, 'RECIPIENT_NOT_ASSIGNABLE');
  return w;
}

// ─── Eligibility ──────────────────────────────────────────────────────────

/**
 * Existing behaviour preserved: ShiftGO's assignment paths
 * (createShift/updateShift/claimShift) do NOT gate on HouseWorker membership —
 * any active agency worker is assignable to any house. HouseWorker is a
 * directory/visibility concept. So `NOT_ASSIGNED_TO_HOUSE` here is ADVISORY
 * only (surfaced for managers); it never hard-blocks a request, exactly like
 * the rest of the app.
 */
async function getEligibleWorkers(user, agencyId, shiftId) {
  const shift = await loadHandoffableShift(shiftId, user.id, agencyId, { label: 'shift' });
  const start = new Date(shift.startTime);
  const end = new Date(shift.endTime);

  const [agency, workers, houseWorkers] = await Promise.all([
    agencyCache.getAgencySettings(agencyId),
    prisma.user.findMany({
      where: { agencyId, role: { in: ['WORKER', 'TEAM_LEADER'] }, id: { not: user.id } },
      select: { id: true, name: true, role: true, status: true, contractedHours: true },
      orderBy: { name: 'asc' },
    }),
    prisma.houseWorker.findMany({ where: { houseId: shift.houseId }, select: { workerId: true } }),
  ]);
  const ids = workers.map((w) => w.id);
  const houseHasRoster = houseWorkers.length > 0;
  const inHouse = new Set(houseWorkers.map((h) => h.workerId));

  const [overlaps, leaves, weekShifts] = await Promise.all([
    prisma.shift.findMany({
      where: { agencyId, workerId: { in: ids }, status: { not: 'CANCELLED' }, startTime: { lt: end }, endTime: { gt: start } },
      select: { workerId: true },
    }),
    prisma.leaveRequest.findMany({
      where: { agencyId, workerId: { in: ids }, status: 'APPROVED', AND: [{ startDate: { lte: end } }, { endDate: { gte: start } }] },
      select: { workerId: true },
    }),
    prisma.shift.findMany({
      where: {
        agencyId, workerId: { in: ids }, status: { in: ['SCHEDULED', 'CLAIMED', 'IN_PROGRESS', 'COMPLETED'] },
        startTime: { lt: end }, endTime: { gt: start },
      },
      select: { workerId: true },
    }),
  ]);
  const overlapSet = new Set(overlaps.map((o) => o.workerId));
  const leaveSet = new Set(leaves.map((l) => l.workerId));

  const max = agency?.maxWeeklyScheduledHours ?? 60;
  const rows = await Promise.all(workers.map(async (w) => {
    let status = 'AVAILABLE';
    if (w.status !== 'ACTIVE') status = 'INACTIVE';
    else if (overlapSet.has(w.id)) status = 'OVERLAP';
    else if (leaveSet.has(w.id)) status = 'ON_LEAVE';
    else {
      const evalResult = await evaluateAssignment({
        worker: { id: w.id, contractedHours: w.contractedHours ?? null },
        agency: { id: agencyId, timezone: agency?.timezone, maxWeeklyScheduledHours: max },
        proposedStart: start, proposedEnd: end,
      });
      if (evalResult.exceedsMax) status = 'OVER_WEEKLY_LIMIT';
    }
    const notAssignedToHouse = houseHasRoster && !inHouse.has(w.id);
    return {
      id: w.id,
      name: w.name,
      role: w.role,
      status,
      eligible: status === 'AVAILABLE',
      notAssignedToHouse, // advisory only
    };
  }));

  return { shift: shiftDto({ ...shift, house: undefined }), workers: rows };
}

/** Future, not-started shifts belonging to `targetWorkerId` that the requester
 *  could plausibly receive in a swap (no overlap with the requester's other
 *  shifts, not already tied up in another request). */
async function getSwapCandidateShifts(user, agencyId, primaryShiftId, targetWorkerId) {
  const primary = await loadHandoffableShift(primaryShiftId, user.id, agencyId, { label: 'shift' });
  await loadActiveWorkerInAgency(targetWorkerId, agencyId, { requesterId: user.id });
  const now = new Date();

  const candidates = await prisma.shift.findMany({
    where: {
      agencyId, workerId: targetWorkerId, status: { in: HANDOFFABLE_SHIFT_STATUS }, startTime: { gt: now },
    },
    select: { id: true, startTime: true, endTime: true, shiftType: true, status: true, house: { select: { id: true, name: true } } },
    orderBy: { startTime: 'asc' },
    take: MAX_PAGE_SIZE,
  });
  if (candidates.length === 0) return { shifts: [] };

  const candidateIds = candidates.map((c) => c.id);
  const [tiedUp, requesterOverlaps] = await Promise.all([
    prisma.shiftChangeRequest.findMany({
      where: { status: { in: INFLIGHT }, OR: [{ primaryShiftId: { in: candidateIds } }, { swapShiftId: { in: candidateIds } }] },
      select: { primaryShiftId: true, swapShiftId: true },
    }),
    prisma.shift.findMany({
      where: { agencyId, workerId: user.id, status: { not: 'CANCELLED' }, id: { not: primaryShiftId } },
      select: { startTime: true, endTime: true },
    }),
  ]);
  const tiedSet = new Set(tiedUp.flatMap((r) => [r.primaryShiftId, r.swapShiftId]).filter(Boolean));

  const clashes = (s) => requesterOverlaps.some((o) =>
    new Date(o.startTime) < new Date(s.endTime) && new Date(o.endTime) > new Date(s.startTime));

  const shifts = candidates
    .filter((s) => !tiedSet.has(s.id) && !clashes(s))
    .map(shiftDto);
  return { shifts };
}

// ─── Creation ─────────────────────────────────────────────────────────────

async function createCoverRequest(requester, agencyId, { shiftId, targetWorkerId, reason }) {
  const primary = await loadHandoffableShift(shiftId, requester.id, agencyId, { label: 'shift' });
  await assertNoActiveRequestForShift(primary.id);
  const target = await loadActiveWorkerInAgency(targetWorkerId, agencyId, { requesterId: requester.id });

  // The teammate must actually be able to take it *now* (overlap + leave +
  // weekly hours). A worker can never override the weekly ceiling.
  await shiftService.validateWorkerAssignment({
    worker: { id: target.id, name: target.name, contractedHours: target.contractedHours ?? null },
    agencyId, startTime: primary.startTime, endTime: primary.endTime, selfClaim: true,
  });

  const created = await prisma.shiftChangeRequest.create({
    data: {
      agencyId, type: 'COVER', status: 'PENDING_RECIPIENT',
      requesterId: requester.id, primaryShiftId: primary.id, targetWorkerId: target.id,
      requesterReason: reason ? String(reason).slice(0, 1000) : null,
    },
    include: requestInclude,
  });

  await createAuditLog({
    agencyId, actorId: requester.id, actorRole: requester.role,
    action: 'SHIFT_COVER_REQUESTED', entityType: 'ShiftChangeRequest', entityId: created.id,
    newValue: { requestId: created.id, type: 'COVER', primaryShiftId: primary.id, requesterId: requester.id, targetWorkerId: target.id },
  });

  await notifyRecipientNewRequest(created);
  return serialize(created);
}

async function createSwapRequest(requester, agencyId, { shiftId, targetWorkerId, targetShiftId, reason }) {
  if (shiftId === targetShiftId) throw httpErr('The two sides of a swap must be different shifts', 400, 'SAME_SHIFT');
  const primary = await loadHandoffableShift(shiftId, requester.id, agencyId, { label: 'shift' });
  const target = await loadActiveWorkerInAgency(targetWorkerId, agencyId, { requesterId: requester.id });
  const swap = await loadHandoffableShift(targetShiftId, target.id, agencyId, { label: 'teammate’s shift' });

  await assertNoActiveRequestForShift(primary.id);
  await assertNoActiveRequestForShift(swap.id);

  // Hypothetical exchange must be valid on BOTH sides right now. Each worker
  // gives away their own shift (excludeShiftId) and receives the other's.
  await shiftService.validateWorkerAssignment({
    worker: { id: target.id, name: target.name, contractedHours: target.contractedHours ?? null },
    agencyId, startTime: primary.startTime, endTime: primary.endTime, excludeShiftId: swap.id, selfClaim: true,
  });
  await shiftService.validateWorkerAssignment({
    worker: { id: requester.id, name: requester.name, contractedHours: requester.contractedHours ?? null },
    agencyId, startTime: swap.startTime, endTime: swap.endTime, excludeShiftId: primary.id, selfClaim: true,
  });

  const created = await prisma.shiftChangeRequest.create({
    data: {
      agencyId, type: 'SWAP', status: 'PENDING_RECIPIENT',
      requesterId: requester.id, primaryShiftId: primary.id, targetWorkerId: target.id, swapShiftId: swap.id,
      requesterReason: reason ? String(reason).slice(0, 1000) : null,
    },
    include: requestInclude,
  });

  await createAuditLog({
    agencyId, actorId: requester.id, actorRole: requester.role,
    action: 'SHIFT_SWAP_REQUESTED', entityType: 'ShiftChangeRequest', entityId: created.id,
    newValue: { requestId: created.id, type: 'SWAP', primaryShiftId: primary.id, swapShiftId: swap.id, requesterId: requester.id, targetWorkerId: target.id },
  });

  await notifyRecipientNewRequest(created);
  return serialize(created);
}

// ─── Listing ──────────────────────────────────────────────────────────────

function pageArgs({ page, pageSize } = {}) {
  const size = Math.min(Math.max(Number(pageSize) || DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
  const p = Math.max(Number(page) || 1, 1);
  return { skip: (p - 1) * size, take: size, page: p, pageSize: size };
}

async function listForMe(user, agencyId, opts = {}) {
  const { skip, take, page, pageSize } = pageArgs(opts);
  const [sent, incoming, sentTotal, incomingTotal] = await Promise.all([
    prisma.shiftChangeRequest.findMany({
      where: { agencyId, requesterId: user.id },
      include: requestInclude, orderBy: { createdAt: 'desc' }, skip, take,
    }),
    prisma.shiftChangeRequest.findMany({
      where: { agencyId, targetWorkerId: user.id },
      include: requestInclude, orderBy: { createdAt: 'desc' }, skip, take,
    }),
    prisma.shiftChangeRequest.count({ where: { agencyId, requesterId: user.id } }),
    prisma.shiftChangeRequest.count({ where: { agencyId, targetWorkerId: user.id } }),
  ]);
  const now = new Date();
  return {
    page, pageSize,
    sent: { total: sentTotal, items: sent.map((r) => serialize(r, now)) },
    incoming: { total: incomingTotal, items: incoming.map((r) => serialize(r, now)) },
  };
}

async function listPendingApproval(user, agencyId, opts = {}) {
  const { skip, take, page, pageSize } = pageArgs(opts);
  const statusFilter = opts.status && ['APPROVED', 'REJECTED', 'PENDING_MANAGER'].includes(opts.status)
    ? opts.status : 'PENDING_MANAGER';
  const [items, total] = await Promise.all([
    prisma.shiftChangeRequest.findMany({
      where: { agencyId, status: statusFilter },
      include: requestInclude, orderBy: { updatedAt: 'desc' }, skip, take,
    }),
    prisma.shiftChangeRequest.count({ where: { agencyId, status: statusFilter } }),
  ]);
  const now = new Date();

  // Decision support for the pending list: projected weekly hours for each
  // receiving worker, computed the same way approval will.
  const agency = await agencyCache.getAgencySettings(agencyId);
  const withProjection = await Promise.all(items.map(async (r) => {
    const base = serialize(r, now);
    if (r.status !== 'PENDING_MANAGER') return base;
    const projections = {};
    projections[r.targetWorkerId] = await projectedHoursFor(
      r.targetWorkerId, agencyId, agency, r.primaryShift, r.type === 'SWAP' ? r.swapShift : null,
    );
    if (r.type === 'SWAP') {
      projections[r.requesterId] = await projectedHoursFor(
        r.requesterId, agencyId, agency, r.swapShift, r.primaryShift,
      );
    }
    return { ...base, projectedHours: projections };
  }));

  return { page, pageSize, total, items: withProjection };
}

async function projectedHoursFor(workerId, agencyId, agency, incomingShift, outgoingShift) {
  const worker = await prisma.user.findFirst({ where: { id: workerId, agencyId }, select: { contractedHours: true } });
  const evalResult = await evaluateAssignment({
    worker: { id: workerId, contractedHours: worker?.contractedHours ?? null },
    agency: { id: agencyId, timezone: agency?.timezone, maxWeeklyScheduledHours: agency?.maxWeeklyScheduledHours ?? 60 },
    proposedStart: incomingShift.startTime, proposedEnd: incomingShift.endTime,
    excludeShiftId: outgoingShift ? outgoingShift.id : null,
  });
  return {
    scheduledHours: evalResult.scheduledHours,
    projectedHours: evalResult.projectedHours,
    maxWeeklyScheduledHours: evalResult.maxWeeklyScheduledHours,
    hoursStatus: evalResult.hoursStatus,
    exceedsMax: evalResult.exceedsMax,
  };
}

/** Reload a request for the response, tolerating a transient DB hiccup on this
 *  read — the authoritative state transition has already been committed by the
 *  caller, so a failed reload must not turn a successful operation into a 500.
 *  Falls back to the pre-action row with the known new fields applied. */
async function reloadOrFallback(id, preRow, overrides) {
  try {
    const fresh = await prisma.shiftChangeRequest.findUnique({ where: { id }, include: requestInclude });
    if (fresh) return fresh;
  } catch (e) {
    console.error('[shift-change] reload after commit failed:', e.message);
  }
  return { ...preRow, ...overrides, updatedAt: new Date() };
}

async function getOneForUser(user, agencyId, id) {
  const r = await prisma.shiftChangeRequest.findFirst({ where: { id, agencyId }, include: requestInclude });
  if (!r) throw httpErr('Request not found', 404, 'NOT_FOUND');
  const isParty = r.requesterId === user.id || r.targetWorkerId === user.id;
  const isManager = user.role === 'MANAGER' || user.role === 'HR';
  if (!isParty && !isManager) throw httpErr('You cannot view this request', 403, 'FORBIDDEN');
  return { row: r, serialized: serialize(r) };
}

// ─── Recipient response ───────────────────────────────────────────────────

async function respond(user, agencyId, id, decision) {
  const dec = String(decision || '').toUpperCase();
  if (!['ACCEPT', 'DECLINE'].includes(dec)) throw httpErr('decision must be ACCEPT or DECLINE', 400, 'BAD_DECISION');

  const r = await prisma.shiftChangeRequest.findFirst({ where: { id, agencyId }, include: requestInclude });
  if (!r) throw httpErr('Request not found', 404, 'NOT_FOUND');
  if (r.targetWorkerId !== user.id) throw httpErr('This request was not sent to you', 403, 'NOT_RECIPIENT');
  // A request that is already EXPIRED stays 409 EXPIRED on every retry.
  if (r.status === 'EXPIRED') throw httpErr('The shift has already started — this request has expired', 409, 'EXPIRED');
  if (r.status !== 'PENDING_RECIPIENT') throw httpErr('This request is no longer awaiting your response', 409, 'INVALID_STATUS');

  if (isExpired(r)) {
    // Persist EXPIRED (bare statement, NOT inside a transaction that then
    // throws) so it is durably committed before we return the 409.
    await prisma.shiftChangeRequest.updateMany({ where: { id, status: { in: INFLIGHT } }, data: { status: 'EXPIRED', updatedAt: new Date() } });
    throw httpErr('The shift has already started — this request has expired', 409, 'EXPIRED');
  }

  if (dec === 'DECLINE') {
    const { count } = await prisma.shiftChangeRequest.updateMany({
      where: { id, agencyId, targetWorkerId: user.id, status: 'PENDING_RECIPIENT' },
      data: { status: 'REJECTED', recipientResponse: 'DECLINED', recipientRespondedAt: new Date() },
    });
    if (count === 0) throw httpErr('This request is no longer awaiting your response', 409, 'INVALID_STATUS');
    // Authoritative state change is committed. Side effects below must not turn
    // a successful decline into a failure.
    try {
      await createAuditLog({
        agencyId, actorId: user.id, actorRole: user.role,
        action: 'SHIFT_CHANGE_DECLINED', entityType: 'ShiftChangeRequest', entityId: id,
        newValue: { requestId: id, type: r.type, shiftId: r.primaryShiftId, decision: 'DECLINED' },
      });
      await notifyRequesterResponded(r, false);
    } catch (e) {
      console.error('[shift-change] post-decline side effect failed:', e.message);
    }
    return serialize(await reloadOrFallback(id, r, { status: 'REJECTED', recipientResponse: 'DECLINED', recipientRespondedAt: new Date() }));
  }

  // ACCEPT — re-validate the teammate can still take it, then move to PENDING_MANAGER.
  await revalidateForRecipient(r, agencyId);
  const { count } = await prisma.shiftChangeRequest.updateMany({
    where: { id, agencyId, targetWorkerId: user.id, status: 'PENDING_RECIPIENT' },
    data: { status: 'PENDING_MANAGER', recipientResponse: 'ACCEPTED', recipientRespondedAt: new Date() },
  });
  if (count === 0) throw httpErr('This request is no longer awaiting your response', 409, 'INVALID_STATUS');

  // Authoritative state change is committed. Everything below is best-effort.
  try {
    await createAuditLog({
      agencyId, actorId: user.id, actorRole: user.role,
      action: 'SHIFT_CHANGE_ACCEPTED', entityType: 'ShiftChangeRequest', entityId: id,
      newValue: { requestId: id, type: r.type, shiftId: r.primaryShiftId, swapShiftId: r.swapShiftId ?? null, decision: 'ACCEPTED' },
    });
    await notifyRequesterResponded(r, true);
    const managers = await prisma.user.findMany({
      where: { agencyId, status: 'ACTIVE', role: { in: ['MANAGER', 'HR'] } }, select: { id: true },
    });
    await notifyManagersPendingApproval(r, managers.map((m) => m.id));
  } catch (e) {
    console.error('[shift-change] post-accept side effect failed:', e.message);
  }
  return serialize(await reloadOrFallback(id, r, { status: 'PENDING_MANAGER', recipientResponse: 'ACCEPTED', recipientRespondedAt: new Date() }));
}

/** Recipient-acceptance re-check (no override — a worker can never bypass the
 *  ceiling). Managers get the final, override-capable check at approval. */
async function revalidateForRecipient(r, agencyId) {
  const target = await prisma.user.findFirst({ where: { id: r.targetWorkerId, agencyId }, select: { id: true, name: true, contractedHours: true, status: true } });
  if (!target || target.status !== 'ACTIVE') throw httpErr('You are no longer active in this agency', 409, 'RECIPIENT_INACTIVE');
  await shiftService.validateWorkerAssignment({
    worker: { id: target.id, name: target.name, contractedHours: target.contractedHours ?? null },
    agencyId, startTime: r.primaryShift.startTime, endTime: r.primaryShift.endTime,
    excludeShiftId: r.type === 'SWAP' ? r.swapShiftId : null, selfClaim: true,
  });
  if (r.type === 'SWAP') {
    const requester = await prisma.user.findFirst({ where: { id: r.requesterId, agencyId }, select: { id: true, name: true, contractedHours: true } });
    await shiftService.validateWorkerAssignment({
      worker: { id: requester.id, name: requester.name, contractedHours: requester.contractedHours ?? null },
      agencyId, startTime: r.swapShift.startTime, endTime: r.swapShift.endTime,
      excludeShiftId: r.primaryShiftId, selfClaim: true,
    });
  }
}

// ─── Cancel ───────────────────────────────────────────────────────────────

async function cancel(user, agencyId, id) {
  const r = await prisma.shiftChangeRequest.findFirst({ where: { id, agencyId }, include: requestInclude });
  if (!r) throw httpErr('Request not found', 404, 'NOT_FOUND');
  if (r.requesterId !== user.id) throw httpErr('Only the person who created a request can cancel it', 403, 'NOT_REQUESTER');
  if (!INFLIGHT.includes(r.status)) throw httpErr('This request can no longer be cancelled', 409, 'INVALID_STATUS');

  const { count } = await prisma.shiftChangeRequest.updateMany({
    where: { id, agencyId, requesterId: user.id, status: { in: INFLIGHT } },
    data: { status: 'CANCELLED', updatedAt: new Date() },
  });
  if (count === 0) throw httpErr('This request can no longer be cancelled', 409, 'INVALID_STATUS');

  try {
    await createAuditLog({
      agencyId, actorId: user.id, actorRole: user.role,
      action: 'SHIFT_CHANGE_CANCELLED', entityType: 'ShiftChangeRequest', entityId: id,
      newValue: { requestId: id, type: r.type, shiftId: r.primaryShiftId },
    });
    await notifyDecision(r, 'SHIFT_CHANGE_CANCELLED', `${r.requester.name} withdrew the shift ${r.type.toLowerCase()} request.`);
  } catch (e) {
    console.error('[shift-change] post-cancel side effect failed:', e.message);
  }
  return serialize(await reloadOrFallback(id, r, { status: 'CANCELLED' }));
}

// ─── Manager approve / reject ─────────────────────────────────────────────

async function reject(manager, agencyId, id, { reason } = {}) {
  const r = await prisma.shiftChangeRequest.findFirst({ where: { id, agencyId }, include: requestInclude });
  if (!r) throw httpErr('Request not found', 404, 'NOT_FOUND');
  if (r.status === 'EXPIRED') throw httpErr('This request has already expired', 409, 'EXPIRED');
  if (r.status !== 'PENDING_MANAGER') throw httpErr('This request is not awaiting approval', 409, 'INVALID_STATUS');

  const { count } = await prisma.shiftChangeRequest.updateMany({
    where: { id, agencyId, status: 'PENDING_MANAGER' },
    data: { status: 'REJECTED', managerId: manager.id, managerDecisionAt: new Date(), managerReason: reason ? String(reason).slice(0, 1000) : null },
  });
  if (count === 0) throw httpErr('This request is not awaiting approval', 409, 'INVALID_STATUS');

  try {
    await createAuditLog({
      agencyId, actorId: manager.id, actorRole: manager.role,
      action: 'SHIFT_CHANGE_REJECTED', entityType: 'ShiftChangeRequest', entityId: id,
      newValue: { requestId: id, type: r.type, shiftId: r.primaryShiftId, swapShiftId: r.swapShiftId ?? null, managerReason: reason ?? null },
    });
    await notifyDecision(r, 'SHIFT_CHANGE_REJECTED',
      `Your shift ${r.type.toLowerCase()} was not approved${reason ? `: ${String(reason).slice(0, 200)}` : '.'}`);
  } catch (e) {
    console.error('[shift-change] post-reject side effect failed:', e.message);
  }
  return serialize(await reloadOrFallback(id, r, {
    status: 'REJECTED', managerId: manager.id, managerDecisionAt: new Date(),
    managerReason: reason ? String(reason).slice(0, 1000) : null,
  }));
}

/**
 * Concurrency-safe approval. Everything below happens under one transaction:
 *  - conditional status flip PENDING_MANAGER -> APPROVED (loses the race -> abort)
 *  - each shift's workerId changed with a conditional updateMany keyed on the
 *    CURRENT owner + status (owner changed underneath us -> count 0 -> rollback)
 *  - audit rows written on the same tx client
 * Overlap / leave / weekly-hours are re-checked against current data BEFORE the
 * transaction; the transactional conditional updates are what actually make a
 * double click / concurrent reassignment safe.
 */
async function approve(manager, agencyId, id, { overrideWeeklyHours = false, overrideReason } = {}) {
  const now = new Date();
  const r = await prisma.shiftChangeRequest.findFirst({ where: { id, agencyId }, include: requestInclude });
  if (!r) throw httpErr('Request not found', 404, 'NOT_FOUND');
  // An already-EXPIRED request stays 409 EXPIRED on every retry.
  if (r.status === 'EXPIRED') throw httpErr('A shift in this request has already started — it can no longer be approved', 409, 'EXPIRED');
  if (r.status !== 'PENDING_MANAGER') throw httpErr('This request is not awaiting approval', 409, 'INVALID_STATUS');

  // Fresh shift state.
  const primary = await prisma.shift.findFirst({ where: { id: r.primaryShiftId, agencyId } });
  const swap = r.swapShiftId ? await prisma.shift.findFirst({ where: { id: r.swapShiftId, agencyId } }) : null;
  if (!primary || (r.type === 'SWAP' && !swap)) throw httpErr('A shift in this request no longer exists', 409, 'SHIFT_GONE');

  // Expiry / not-started / no work begun. For SWAP either shift starting expires
  // the whole request.
  const shiftsToCheck = [primary, ...(swap ? [swap] : [])];
  for (const s of shiftsToCheck) {
    if (new Date(s.startTime).getTime() <= now.getTime()) {
      // Persist EXPIRED with a bare statement (NOT inside a transaction that
      // then throws) so it is durably committed before the 409 is returned.
      await prisma.shiftChangeRequest.updateMany({ where: { id, status: { in: INFLIGHT } }, data: { status: 'EXPIRED', updatedAt: now } });
      throw httpErr('A shift in this request has already started — it can no longer be approved', 409, 'EXPIRED');
    }
    if (['IN_PROGRESS', 'COMPLETED', 'CANCELLED'].includes(s.status)) {
      throw httpErr('A shift in this request is no longer in a changeable state', 409, 'SHIFT_NOT_CHANGEABLE');
    }
    const started = await prisma.clockEvent.findFirst({ where: { shiftId: s.id, type: 'IN' }, select: { id: true } });
    if (started) throw httpErr('Work has already begun on a shift in this request', 409, 'SHIFT_CLOCKED_IN');
  }

  // Ownership must still match what the request assumes.
  if (primary.workerId !== r.requesterId) throw httpErr('The shift has since been reassigned — please review', 409, 'STALE_ASSIGNMENT');
  if (r.type === 'SWAP' && swap.workerId !== r.targetWorkerId) throw httpErr('The teammate’s shift has since been reassigned — please review', 409, 'STALE_ASSIGNMENT');

  const [requester, target] = await Promise.all([
    prisma.user.findFirst({ where: { id: r.requesterId, agencyId }, select: { id: true, name: true, status: true, contractedHours: true } }),
    prisma.user.findFirst({ where: { id: r.targetWorkerId, agencyId }, select: { id: true, name: true, status: true, contractedHours: true } }),
  ]);
  if (!requester || requester.status !== 'ACTIVE') throw httpErr('The requester is no longer active', 409, 'REQUESTER_INACTIVE');
  if (!target || target.status !== 'ACTIVE') throw httpErr('The teammate is no longer active', 409, 'RECIPIENT_INACTIVE');

  const overrideData = { overrideWeeklyLimit: overrideWeeklyHours === true, overrideReason };

  // Re-run the real gates with CURRENT data. Manager IS allowed to override the
  // weekly ceiling (with a reason) — overlap and leave are never bypassed.
  const targetCheck = await shiftService.validateWorkerAssignment({
    worker: { id: target.id, name: target.name, contractedHours: target.contractedHours ?? null },
    agencyId, startTime: primary.startTime, endTime: primary.endTime,
    excludeShiftId: r.type === 'SWAP' ? swap.id : null,
    actor: manager, data: overrideData,
  });
  let requesterCheck = { overrideAudit: null };
  if (r.type === 'SWAP') {
    requesterCheck = await shiftService.validateWorkerAssignment({
      worker: { id: requester.id, name: requester.name, contractedHours: requester.contractedHours ?? null },
      agencyId, startTime: swap.startTime, endTime: swap.endTime,
      excludeShiftId: primary.id, actor: manager, data: overrideData,
    });
  }

  const result = await prisma.$transaction(async (tx) => {
    // 1. Claim the request — only one approval can win.
    const claimed = await tx.shiftChangeRequest.updateMany({
      where: { id, agencyId, status: 'PENDING_MANAGER' },
      data: { status: 'APPROVED', managerId: manager.id, managerDecisionAt: now, managerReason: overrideReason ? String(overrideReason).slice(0, 1000) : null },
    });
    if (claimed.count === 0) throw httpErr('This request has already been decided', 409, 'ALREADY_DECIDED');

    // 2. Reassign primary shift — conditional on the CURRENT owner + status +
    //    still in the future (guards the sub-second race between the checks
    //    above and this write).
    const p = await tx.shift.updateMany({
      where: { id: primary.id, agencyId, workerId: r.requesterId, status: { in: HANDOFFABLE_SHIFT_STATUS }, startTime: { gt: now } },
      data: { workerId: r.targetWorkerId },
    });
    if (p.count !== 1) throw httpErr('The shift changed state during approval — nothing was reassigned', 409, 'STALE_ASSIGNMENT');

    // 3. SWAP — reassign the second shift in the SAME transaction. Any failure
    //    here rolls back step 2 as well (all-or-nothing).
    if (r.type === 'SWAP') {
      const q = await tx.shift.updateMany({
        where: { id: swap.id, agencyId, workerId: r.targetWorkerId, status: { in: HANDOFFABLE_SHIFT_STATUS }, startTime: { gt: now } },
        data: { workerId: r.requesterId },
      });
      if (q.count !== 1) throw httpErr('The teammate’s shift changed state during approval — nothing was reassigned', 409, 'STALE_ASSIGNMENT');
    }

    // 4. Audit on the same tx client.
    await createAuditLog({
      agencyId, actorId: manager.id, actorRole: manager.role,
      action: 'SHIFT_CHANGE_APPROVED', entityType: 'ShiftChangeRequest', entityId: id,
      newValue: {
        requestId: id, type: r.type,
        primaryShiftId: primary.id, primaryShift_oldWorkerId: r.requesterId, primaryShift_newWorkerId: r.targetWorkerId,
        ...(r.type === 'SWAP' ? { swapShiftId: swap.id, swapShift_oldWorkerId: r.targetWorkerId, swapShift_newWorkerId: r.requesterId } : {}),
        weeklyHoursOverride: overrideWeeklyHours === true || undefined,
        overrideReason: overrideWeeklyHours === true ? (overrideReason ?? null) : undefined,
      },
    }, tx);

    return true;
  });
  void result;

  // ── Everything past this point is a side effect of an ALREADY-COMMITTED
  //    reassignment. A failure here (audit write, notification, reload) must
  //    NOT surface as a failed approval — the shift(s) are already reassigned.
  //
  //    The WEEKLY_HOURS_LIMIT_OVERRIDE audit is written HERE, only after the
  //    reassignment transaction has committed, so it can never exist for a
  //    swap/cover that ultimately failed. (createAuditLog itself also swallows
  //    its own errors.) The existing weekly-hours controls are unchanged — the
  //    override was already enforced by validateWorkerAssignment above.
  try {
    if (targetCheck.overrideAudit) await targetCheck.overrideAudit(primary.id);
    if (requesterCheck.overrideAudit) await requesterCheck.overrideAudit(swap.id);

    if (r.type === 'SWAP') {
      await notify(r.targetWorkerId, 'Shift change approved',
        `Your swap is approved. You now work ${shiftLabel(r.primaryShift)}.`,
        { kind: 'SHIFT_CHANGE', event: 'SHIFT_CHANGE_APPROVED', requestId: id, type: 'SWAP', shiftId: primary.id, swapShiftId: swap.id });
      await notify(r.requesterId, 'Shift change approved',
        `Your swap is approved. You now work ${shiftLabel(r.swapShift)}.`,
        { kind: 'SHIFT_CHANGE', event: 'SHIFT_CHANGE_APPROVED', requestId: id, type: 'SWAP', shiftId: primary.id, swapShiftId: swap.id });
    } else {
      await notify(r.targetWorkerId, 'Shift change approved', `You are now covering ${shiftLabel(r.primaryShift)}.`,
        { kind: 'SHIFT_CHANGE', event: 'SHIFT_CHANGE_APPROVED', requestId: id, type: 'COVER', shiftId: primary.id });
      await notify(r.requesterId, 'Shift change approved', `${r.targetWorker.name} is now covering your ${shiftLabel(r.primaryShift)}.`,
        { kind: 'SHIFT_CHANGE', event: 'SHIFT_CHANGE_APPROVED', requestId: id, type: 'COVER', shiftId: primary.id });
    }
  } catch (e) {
    console.error('[shift-change] post-approval side effect failed:', e.message);
  }

  return serialize(await reloadOrFallback(id, r, {
    status: 'APPROVED', managerId: manager.id, managerDecisionAt: now,
    managerReason: overrideReason ? String(overrideReason).slice(0, 1000) : null,
  }));
}

module.exports = {
  INFLIGHT,
  getEligibleWorkers,
  getSwapCandidateShifts,
  createCoverRequest,
  createSwapRequest,
  listForMe,
  listPendingApproval,
  getOneForUser,
  respond,
  cancel,
  reject,
  approve,
  serialize,
};
