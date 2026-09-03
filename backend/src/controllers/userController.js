const path = require('path');
const prisma = require('../lib/prisma');
const { ok, created, fail, notFound } = require('../utils/response');
const { auditContext, createAuditLog } = require('../services/auditService');
const { agencyIdFor } = require('../utils/agency');
const clerkClient = require('../utils/clerkClient');
const { ROLE_TO_ORG_ROLE } = require('../utils/clerkRoles');

const userSelect = {
  id: true,
  agencyId: true,
  name: true,
  email: true,
  role: true,
  status: true,
  phone: true,
  contractedHours: true,
  deactivatedAt: true,
  deactivatedById: true,
  deactivationReason: true,
  createdAt: true,
};

const meSelect = {
  id: true, agencyId: true, name: true, email: true, role: true, status: true,
  phone: true, bio: true, profilePicture: true, address: true,
  onboardedAt: true, createdAt: true, updatedAt: true,
  agency: { select: { name: true } },
};

async function listUsers(req, res) {
  const { role, status = 'ACTIVE' } = req.query;
  const where = { agencyId: agencyIdFor(req), status, ...(role ? { role } : {}) };
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

  const agency = await prisma.agency.findUnique({ where: { id: agencyId }, select: { clerkOrgId: true } });
  if (!agency?.clerkOrgId) return fail(res, 'Agency is not linked to a Clerk organization', 409);

  const existing = await prisma.user.findUnique({ where: { email: req.body.email } });
  if (existing) return fail(res, 'Email already in use');

  // Staff onboarding sends a Clerk organization invitation rather than creating
  // a local password — the User row is created by the organizationMembership
  // webhook once the invite is accepted.
  //
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
      emailAddress: req.body.email,
      role: ROLE_TO_ORG_ROLE[req.body.role],
    });
  } catch (err) {
    const clerkError = err.errors?.[0];
    if (clerkError?.code === 'organization_membership_quota_exceeded') {
      return fail(res, 'Your organization has reached its member limit for this Clerk plan. Remove an unused pending invite or upgrade the plan, then try again.', 403);
    }
    if (clerkError?.code === 'duplicate_record') {
      return fail(res, 'This email already has a pending invitation or is already a member', 409);
    }
    throw err;
  }

  await createAuditLog({
    ...auditContext(req),
    action: 'USER_INVITED',
    entityType: 'OrganizationInvitation',
    entityId: invitation.id,
    newValue: { email: req.body.email, name: req.body.name, role: req.body.role },
  });
  created(res, { invitationId: invitation.id, email: req.body.email, role: req.body.role, status: invitation.status });
}

async function updateUser(req, res) {
  const agencyId = agencyIdFor(req);
  const existing = await prisma.user.findFirst({ where: { id: req.params.id, agencyId } });
  if (!existing) return notFound(res);

  const user = await prisma.user.update({
    where: { id: req.params.id },
    data: { contractedHours: req.body.contractedHours },
    select: userSelect,
  });
  ok(res, user);
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
  const user = await prisma.user.findUnique({ where: { id: req.user.id }, select: meSelect });
  if (!user) return notFound(res);
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
  const filename = req.file.filename;
  const profilePicture = `/uploads/avatars/${filename}`;
  const oldUser = await prisma.user.findUnique({ where: { id: req.user.id }, select: meSelect });
  const user = await prisma.user.update({
    where: { id: req.user.id },
    data: { profilePicture },
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
  assignWorkerToHouse, assignTeamLeaderToHouse, updateFcmToken,
};
