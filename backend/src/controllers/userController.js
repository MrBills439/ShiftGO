const path = require('path');
const fs = require('fs');
const prisma = require('../lib/prisma');
const { ok, created, fail, notFound } = require('../utils/response');
const { auditContext, createAuditLog } = require('../services/auditService');
const { agencyIdFor } = require('../utils/agency');
const { resolveStoredPath, discardUpload, AVATARS_DIR } = require('../lib/storage');

/**
 * Absolute on-disk path for a stored avatar web-path, or null. Two guards:
 *  - it must be a /uploads/avatars/ web path (never an external URL)
 *  - it must resolve to a real file strictly inside AVATARS_DIR — so a tampered
 *    value with "../" can never make us unlink a file in another upload folder.
 */
function safeAvatarFsPath(webPath) {
  if (typeof webPath !== 'string' || !webPath.startsWith('/uploads/avatars/')) return null;
  const abs = resolveStoredPath(webPath);
  if (!abs || !abs.startsWith(AVATARS_DIR + path.sep)) return null;
  return abs;
}
const clerkClient = require('../utils/clerkClient');
const { ROLE_TO_ORG_ROLE } = require('../utils/clerkRoles');
const { buildEmploymentData, rethrowP2002 } = require('../services/employmentService');
const { generateEmployeeId } = require('../services/employeeIdService');

// Whole-Workforce Phase 1: employment scalars + related-record labels. Selected
// (not deep-included) so a directory page never N+1s.
const employmentSelect = {
  employeeNumber: true,
  workPatternType: true,
  employmentType: true,
  departmentId: true,
  jobTitleId: true,
  primaryLocationId: true,
  lineManagerId: true,
  department: { select: { id: true, name: true } },
  jobTitle: { select: { id: true, name: true } },
  primaryLocation: { select: { id: true, name: true, type: true } },
  lineManager: { select: { id: true, name: true } },
};

// HR Onboarding V1: hire date + the employee's own emergency contact. Read-only
// here (no editor yet) — surfaced so a future profile/detail view can read them.
const onboardingSelect = {
  employmentStartDate: true,
  emergencyContactName: true,
  emergencyContactPhone: true,
  emergencyContactRelationship: true,
};

const userSelect = {
  id: true,
  agencyId: true,
  name: true,
  email: true,
  role: true,
  status: true,
  phone: true,
  profilePicture: true,
  contractedHours: true,
  deactivatedAt: true,
  deactivatedById: true,
  deactivationReason: true,
  createdAt: true,
  ...employmentSelect,
  ...onboardingSelect,
};

const meSelect = {
  id: true, agencyId: true, clerkUserId: true, name: true, email: true, role: true, status: true,
  phone: true, bio: true, profilePicture: true, address: true, contractedHours: true,
  onboardedAt: true, createdAt: true, updatedAt: true,
  agency: { select: { name: true } },
  ...employmentSelect,
  ...onboardingSelect,
};

/** True when `name` is missing or is really just the email address — the state
 *  the Clerk membership webhook leaves a user in when Clerk has no first/last
 *  name yet. Such a value must never be shown as a person's name. */
function nameIsUnset(name, email) {
  const n = (name || '').trim().toLowerCase();
  return !n || n === (email || '').trim().toLowerCase();
}

// Clerk user ids we have already tried to heal this process — so a user who
// genuinely has no name in Clerk does not cause a Clerk API call on every
// /users/me. The webhook (`user.updated`) is the real sync path; this is only a
// fallback for rows created before that handler existed. Resets on redeploy.
const _nameHealAttempted = new Set();

/** Exceptional fallback: if the stored name is just the email (legacy rows from
 *  before the user.updated webhook), pull the real name from Clerk once and
 *  persist it on this user's own row. Never throws, at most one Clerk call per
 *  user per process. */
async function backfillNameFromClerk(user) {
  if (process.env.JEST_WORKER_ID !== undefined) return user;
  if (!user.clerkUserId || !nameIsUnset(user.name, user.email)) return user;
  if (_nameHealAttempted.has(user.clerkUserId)) return user;
  _nameHealAttempted.add(user.clerkUserId);
  try {
    const cu = await clerkClient.users.getUser(user.clerkUserId);
    const real = [cu.firstName, cu.lastName].filter(Boolean).join(' ').trim();
    if (real && real.toLowerCase() !== (user.email || '').toLowerCase()) {
      return prisma.user.update({ where: { id: user.id }, data: { name: real }, select: meSelect });
    }
  } catch (err) {
    console.warn('[users/me] could not backfill name from Clerk:', err.message);
  }
  return user;
}

async function listUsers(req, res) {
  const { role, status = 'ACTIVE', departmentId, jobTitleId, primaryLocationId, workPatternType, employmentType } = req.query;
  const where = {
    agencyId: agencyIdFor(req),
    status,
    ...(role ? { role } : {}),
    ...(departmentId ? { departmentId } : {}),
    ...(jobTitleId ? { jobTitleId } : {}),
    ...(primaryLocationId ? { primaryLocationId } : {}),
    ...(workPatternType ? { workPatternType } : {}),
    ...(employmentType ? { employmentType } : {}),
  };
  const users = await prisma.user.findMany({ where, select: userSelect, orderBy: { name: 'asc' } });
  ok(res, users);
}

async function getUser(req, res) {
  const user = await prisma.user.findFirst({ where: { id: req.params.id, agencyId: agencyIdFor(req) }, select: userSelect });
  if (!user) return notFound(res);
  ok(res, user);
}

async function createUser(req, res) {
  const agencyId = agencyIdFor(req);
  if (req.body.agencyId && req.body.agencyId !== agencyId) {
    return fail(res, 'Cannot create users outside your agency', 403);
  }
  if (req.user.role === 'MANAGER' && req.body.role === 'HR') {
    return fail(res, 'Managers cannot create HR accounts', 403);
  }

  // Whole-Workforce Phase 1: validate employment references belong to THIS
  // agency BEFORE we create a Clerk invitation for a payload we can't honour.
  let employmentData;
  try {
    employmentData = await buildEmploymentData(req.body, agencyId);
  } catch (err) {
    if (err.statusCode) return fail(res, err.message, err.statusCode, err.code ? { code: err.code } : {});
    throw err;
  }
  const contractedHours =
    req.body.contractedHours === undefined || req.body.contractedHours === '' || req.body.contractedHours === null
      ? undefined
      : Number(req.body.contractedHours);

  const agency = await prisma.agency.findUnique({ where: { id: agencyId }, select: { clerkOrgId: true } });
  if (!agency?.clerkOrgId) return fail(res, 'Agency is not linked to a Clerk organization', 409);

  const email = String(req.body.email).trim().toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return fail(res, 'Email already in use');

  // Reject a duplicate employee number up front (the DB unique also guards it
  // at consumption time).
  if (employmentData.employeeNumber) {
    const dupe = await prisma.user.findFirst({
      where: { agencyId, employeeNumber: employmentData.employeeNumber }, select: { id: true },
    });
    if (dupe) return fail(res, 'That employee number is already used in your agency', 409, { code: 'DUPLICATE_EMPLOYEE_NUMBER' });
  }

  const priorPending = await prisma.pendingEmployee.findUnique({
    where: { agencyId_email: { agencyId, email } },
    select: { id: true, employeeNumber: true },
  });

  // Employee IDs are normally auto-generated from the agency's configured
  // prefix — HR only types one when explicitly overriding.
  //   - custom number supplied            -> use it (dup-checked above); no counter consumed
  //   - retry with a number still staged  -> reuse it; do NOT burn a fresh number
  //   - otherwise                         -> reserve the next number atomically
  //                                          (400 NO_EMPLOYEE_ID_PREFIX if unset)
  let stagedEmployeeNumber = employmentData.employeeNumber ?? null;
  if (!stagedEmployeeNumber) {
    if (priorPending?.employeeNumber) {
      stagedEmployeeNumber = priorPending.employeeNumber;
    } else {
      try {
        stagedEmployeeNumber = await generateEmployeeId(agencyId);
      } catch (err) {
        if (err.statusCode) return fail(res, err.message, err.statusCode, err.code ? { code: err.code } : {});
        throw err;
      }
    }
  }
  const { employeeNumber: _customEmployeeNumber, ...employmentRest } = employmentData;

  // HR Onboarding V1: personal + emergency-contact values are staged on the
  // PendingEmployee row and applied to the User by the membership webhook.
  // Only keys actually present in the request are staged — a retry that omits a
  // field leaves the previously staged value in place (same semantics as the
  // employment fields). `name` is always present (required by the validator).
  const trimOrNull = (v) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
  const parseDateOrNull = (v) => {
    if (v === undefined || v === null || v === '') return null;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  };
  const personalStaging = {};
  if (req.body.name !== undefined) personalStaging.name = trimOrNull(req.body.name);
  if (req.body.phone !== undefined) personalStaging.phone = trimOrNull(req.body.phone);
  if (req.body.address !== undefined) personalStaging.address = trimOrNull(req.body.address);
  if (req.body.employmentStartDate !== undefined) personalStaging.employmentStartDate = parseDateOrNull(req.body.employmentStartDate);
  if (req.body.emergencyContactName !== undefined) personalStaging.emergencyContactName = trimOrNull(req.body.emergencyContactName);
  if (req.body.emergencyContactPhone !== undefined) personalStaging.emergencyContactPhone = trimOrNull(req.body.emergencyContactPhone);
  if (req.body.emergencyContactRelationship !== undefined) personalStaging.emergencyContactRelationship = trimOrNull(req.body.emergencyContactRelationship);

  // Staff onboarding sends a Clerk organization invitation rather than creating
  // a local password — the User row is created by the organizationMembership
  // webhook once the invite is accepted.
  //
  // Prisma and Clerk cannot share a transaction, so the two writes are ordered
  // so the recoverable one runs first:
  //   1. stage the employment data (never in client-controlled Clerk metadata);
  //   2. create the Clerk invitation;
  //   3. attach the invitation id to the staging row.
  // If (1) fails, no invitation goes out. If (2) fails, a staging row we just
  // created is rolled back. An invitation must never succeed while the HR
  // employment data is silently lost.
  const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
  try {
    await prisma.pendingEmployee.upsert({
      where: { agencyId_email: { agencyId, email } },
      create: {
        agencyId, email, role: req.body.role, invitedById: req.user.id,
        expiresAt: new Date(Date.now() + THIRTY_DAYS_MS),
        contractedHours, employeeNumber: stagedEmployeeNumber, ...employmentRest, ...personalStaging,
      },
      update: {
        role: req.body.role, invitedById: req.user.id,
        expiresAt: new Date(Date.now() + THIRTY_DAYS_MS),
        consumedAt: null, needsReview: false, reviewNote: null, invitationId: null,
        contractedHours: contractedHours ?? null, employeeNumber: stagedEmployeeNumber, ...employmentRest, ...personalStaging,
      },
    });
  } catch (err) {
    console.error('[users/create] failed to stage pending employee:', err.message);
    return fail(res, 'Could not save the employment details — no invitation was sent. Please try again.', 500);
  }

  // No inviterUserId: Clerk checks that user's own org-role permissions for this
  // action, and the org:hr/org:manager custom roles in this Clerk instance
  // currently have zero permissions granted (a Dashboard config gap, not
  // something fixable from here — Organization Settings > Roles > grant
  // "Manage members" to fix it there instead). Omitting it sends the invite
  // as the API key itself, which bypasses that check entirely.
  let invitation;
  try {
    invitation = await clerkClient.organizations.createOrganizationInvitation({
      organizationId: agency.clerkOrgId,
      emailAddress: email,
      role: ROLE_TO_ORG_ROLE[req.body.role],
    });
  } catch (err) {
    // Roll back a staging row we created for this call; leave a pre-existing one
    // (its data is still the latest HR intent, and its old invitation may live).
    if (!priorPending) {
      await prisma.pendingEmployee
        .deleteMany({ where: { agencyId, email } })
        .catch((e) => console.error('[users/create] could not roll back staging row:', e.message));
    }
    const clerkError = err.errors?.[0];
    if (clerkError?.code === 'organization_membership_quota_exceeded') {
      return fail(res, 'Your organization has reached its member limit for this Clerk plan. Remove an unused pending invite or upgrade the plan, then try again.', 403);
    }
    if (clerkError?.code === 'duplicate_record') {
      return fail(res, 'This email already has a pending invitation or is already a member', 409);
    }
    throw err;
  }

  try {
    await prisma.pendingEmployee.update({
      where: { agencyId_email: { agencyId, email } },
      data: { invitationId: invitation.id },
    });
    // Opportunistic, bounded housekeeping — clear this agency's consumed /
    // long-expired staging rows, but never one still awaiting HR review. No cron.
    await prisma.pendingEmployee.deleteMany({
      where: {
        agencyId, needsReview: false,
        OR: [{ consumedAt: { not: null } }, { expiresAt: { lt: new Date(Date.now() - THIRTY_DAYS_MS) } }],
      },
    });
  } catch (err) {
    console.error('[users/create] could not attach invitation id / run cleanup:', err.message);
    // The employment data is safely staged and the invitation is out; the
    // invitation id is non-critical metadata. Do not fail the request.
  }

  await createAuditLog({
    ...auditContext(req),
    action: 'USER_INVITED',
    entityType: 'OrganizationInvitation',
    entityId: invitation.id,
    newValue: {
      email, name: req.body.name, role: req.body.role,
      employeeNumber: stagedEmployeeNumber,
      hasEmploymentData: Object.keys(employmentData).length > 0,
    },
  });
  created(res, {
    invitationId: invitation.id, email, role: req.body.role,
    status: invitation.status, employeeNumber: stagedEmployeeNumber,
  });
}

async function updateUser(req, res) {
  const agencyId = agencyIdFor(req);
  const existing = await prisma.user.findFirst({ where: { id: req.params.id, agencyId }, select: userSelect });
  if (!existing) return notFound(res);

  const data = {};
  if (req.body.contractedHours !== undefined) {
    data.contractedHours =
      req.body.contractedHours === '' || req.body.contractedHours === null ? null : Number(req.body.contractedHours);
  }
  // Whole-Workforce Phase 1: HR / management may also edit employment metadata.
  try {
    Object.assign(data, await buildEmploymentData(req.body, agencyId, { userId: req.params.id, existing }));
  } catch (err) {
    if (err.statusCode) return fail(res, err.message, err.statusCode, err.code ? { code: err.code } : {});
    throw err;
  }

  let user;
  try {
    user = await prisma.user.update({ where: { id: req.params.id }, data, select: userSelect });
  } catch (err) {
    try { rethrowP2002(err); } catch (mapped) {
      if (mapped.statusCode) return fail(res, mapped.message, mapped.statusCode, mapped.code ? { code: mapped.code } : {});
      throw mapped;
    }
    throw err;
  }

  await createAuditLog({
    ...auditContext(req),
    action: 'USER_UPDATED',
    entityType: 'User',
    entityId: user.id,
    oldValue: existing,
    newValue: user,
  });
  ok(res, user);
}

// ─── Whole-Workforce Phase 1 (hardening): onboarding rows that need HR ────
// A PendingEmployee is flagged needsReview when the membership webhook could
// not apply every staged field (employee-number clash, or a
// department/job title/location/line manager removed or deactivated between
// invite and acceptance). The User + auth membership already exist — these are
// the employment details HR still has to set on the person by hand.
async function listOnboardingReview(req, res) {
  const agencyId = agencyIdFor(req);
  const rows = await prisma.pendingEmployee.findMany({
    where: { agencyId, needsReview: true },
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true, email: true, role: true, reviewNote: true,
      employeeNumber: true, departmentId: true, jobTitleId: true,
      primaryLocationId: true, lineManagerId: true, contractedHours: true,
      workPatternType: true, employmentType: true,
      consumedAt: true, createdAt: true, updatedAt: true,
    },
  });
  ok(res, rows);
}

// HR marks an onboarding-review row handled once they've set the details on the
// user. The next opportunistic cleanup then sweeps the (consumed) row.
async function resolveOnboardingReview(req, res) {
  const agencyId = agencyIdFor(req);
  const row = await prisma.pendingEmployee.findFirst({
    where: { id: req.params.id, agencyId }, select: { id: true },
  });
  if (!row) return notFound(res);
  const updated = await prisma.pendingEmployee.update({
    where: { id: row.id }, data: { needsReview: false, reviewNote: null },
    select: { id: true, email: true, needsReview: true },
  });
  await createAuditLog({
    ...auditContext(req),
    action: 'ONBOARDING_REVIEW_RESOLVED',
    entityType: 'PendingEmployee',
    entityId: row.id,
    newValue: { email: updated.email },
  });
  ok(res, updated);
}

async function deactivateUser(req, res) {
  const agencyId = agencyIdFor(req);
  const { id } = req.params;
  const reason = req.body.reason.trim();

  if (id === req.user.id) return fail(res, 'You cannot deactivate your own account', 409);

  const oldUser = await prisma.user.findFirst({ where: { id, agencyId }, select: userSelect });
  if (!oldUser) return notFound(res);
  if (oldUser.status === 'DEACTIVATED') return fail(res, 'User is already deactivated', 409);

  const user = await prisma.user.update({
    where: { id },
    data: {
      status: 'DEACTIVATED',
      deactivatedAt: new Date(),
      deactivatedById: req.user.id,
      deactivationReason: reason,
      fcmToken: null,
    },
    select: userSelect,
  });

  await createAuditLog({
    ...auditContext(req),
    action: 'USER_DEACTIVATED',
    entityType: 'User',
    entityId: user.id,
    oldValue: oldUser,
    newValue: user,
  });

  ok(res, user);
}

async function getMe(req, res) {
  let user = await prisma.user.findUnique({ where: { id: req.user.id }, select: meSelect });
  if (!user) return notFound(res);
  user = await backfillNameFromClerk(user);
  ok(res, user);
}

// First-run onboarding: capture name + phone and stamp onboardedAt so the
// mobile app stops routing this user into the onboarding flow. Idempotent —
// re-calling it won't move an already-set onboardedAt.
async function completeOnboarding(req, res) {
  const existing = await prisma.user.findUnique({
    where: { id: req.user.id },
    select: { onboardedAt: true },
  });

  const data = {};
  if (typeof req.body.name === 'string' && req.body.name.trim()) data.name = req.body.name.trim();
  if (req.body.phone !== undefined) data.phone = req.body.phone?.trim() || null;
  if (!existing?.onboardedAt) data.onboardedAt = new Date();

  const user = await prisma.user.update({
    where: { id: req.user.id },
    data,
    select: meSelect,
  });

  await createAuditLog({
    ...auditContext(req),
    action: 'USER_ONBOARDED',
    entityType: 'User',
    entityId: user.id,
    newValue: { name: user.name, phone: user.phone, onboardedAt: user.onboardedAt },
  });

  ok(res, user);
}

async function updateMe(req, res) {
  const allowed = ['name', 'phone', 'bio', 'address'];
  const data = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) data[key] = req.body[key];
  }
  const oldUser = await prisma.user.findUnique({ where: { id: req.user.id }, select: meSelect });
  const user = await prisma.user.update({
    where: { id: req.user.id },
    data,
    select: meSelect,
  });
  await createAuditLog({
    ...auditContext(req),
    action: 'USER_UPDATED',
    entityType: 'User',
    entityId: user.id,
    oldValue: oldUser,
    newValue: user,
  });
  ok(res, user);
}

async function uploadAvatar(req, res) {
  if (!req.file) return fail(res, 'No file uploaded');
  const profilePicture = `/uploads/avatars/${req.file.filename}`;

  let oldUser;
  let user;
  try {
    oldUser = await prisma.user.findUnique({ where: { id: req.user.id }, select: meSelect });
    user = await prisma.user.update({
      where: { id: req.user.id },
      data: { profilePicture },
      select: meSelect,
    });
  } catch (err) {
    // DB write failed after the file was already written to disk — don't orphan it.
    await discardUpload(req.file);
    throw err;
  }

  await createAuditLog({
    ...auditContext(req),
    action: 'USER_UPDATED',
    entityType: 'User',
    entityId: user.id,
    oldValue: oldUser,
    newValue: user,
  });

  // Delete the previous avatar once the new one is committed. Only files that
  // resolve strictly inside AVATARS_DIR — external URLs / nulls / tampered
  // "../" values are left alone.
  if (oldUser?.profilePicture && oldUser.profilePicture !== profilePicture) {
    const prev = safeAvatarFsPath(oldUser.profilePicture);
    if (prev) fs.promises.unlink(prev).catch(() => {});
  }

  ok(res, user);
}

/**
 * DELETE /users/me/avatar — remove the caller's own profile picture.
 *
 * Scoped strictly to req.user.id (no id param), so a user can only clear their
 * own avatar; agency isolation is unaffected. The physical file is deleted only
 * when the stored value is a local /uploads/avatars/ path AND resolveStoredPath
 * keeps it inside UPLOAD_DIR (path-traversal safe) — a tampered/external value
 * clears the column but touches no file. A missing file is ignored.
 */
async function removeAvatar(req, res) {
  const oldUser = await prisma.user.findUnique({ where: { id: req.user.id }, select: meSelect });
  if (!oldUser) return notFound(res);

  if (!oldUser.profilePicture) return ok(res, oldUser); // nothing to remove

  const user = await prisma.user.update({
    where: { id: req.user.id },
    data: { profilePicture: null },
    select: meSelect,
  });

  await createAuditLog({
    ...auditContext(req),
    action: 'USER_UPDATED',
    entityType: 'User',
    entityId: user.id,
    oldValue: oldUser,
    newValue: user,
  });

  const prev = safeAvatarFsPath(oldUser.profilePicture);
  if (prev) fs.promises.unlink(prev).catch(() => {}); // already-missing file is fine

  ok(res, user);
}

async function assignWorkerToHouse(req, res) {
  const agencyId = agencyIdFor(req);
  const { workerId, houseId } = req.body;
  if (!workerId || !houseId) return fail(res, 'workerId and houseId required');
  const [worker, house] = await Promise.all([
    prisma.user.findFirst({ where: { id: workerId, agencyId } }),
    prisma.house.findFirst({ where: { id: houseId, agencyId } }),
  ]);
  if (!worker || !house) return fail(res, 'Worker and house must belong to your agency', 403);
  if (worker.status === 'DEACTIVATED') return fail(res, 'Worker is deactivated and cannot be assigned to a house', 403);

  const record = await prisma.houseWorker.upsert({
    where: { houseId_workerId: { houseId, workerId } },
    create: { houseId, workerId },
    update: {},
  });
  created(res, record);
}

async function assignTeamLeaderToHouse(req, res) {
  const agencyId = agencyIdFor(req);
  const { teamLeaderId, houseId } = req.body;
  if (!teamLeaderId || !houseId) return fail(res, 'teamLeaderId and houseId required');
  const [teamLeader, house] = await Promise.all([
    prisma.user.findFirst({ where: { id: teamLeaderId, agencyId } }),
    prisma.house.findFirst({ where: { id: houseId, agencyId } }),
  ]);
  if (!teamLeader || !house) return fail(res, 'Team leader and house must belong to your agency', 403);
  if (teamLeader.status === 'DEACTIVATED') return fail(res, 'Team leader is deactivated and cannot be assigned to a house', 403);

  const record = await prisma.houseTeamLeader.upsert({
    where: { houseId_teamLeaderId: { houseId, teamLeaderId } },
    create: { houseId, teamLeaderId },
    update: {},
  });
  created(res, record);
}

async function updateFcmToken(req, res) {
  const { fcmToken } = req.body;
  const user = await prisma.user.update({
    where: { id: req.user.id },
    data: { fcmToken },
    select: userSelect,
  });
  ok(res, user);
}

module.exports = {
  listUsers, getUser, createUser, updateUser, deactivateUser, getMe, updateMe, completeOnboarding, uploadAvatar,
  removeAvatar, assignWorkerToHouse, assignTeamLeaderToHouse, updateFcmToken,
  listOnboardingReview, resolveOnboardingReview,
};
