const { verifyWebhook } = require('@clerk/express/webhooks');
const prisma = require('../lib/prisma');
const clerkClient = require('../utils/clerkClient');
const { ORG_ROLE_TO_ROLE } = require('../utils/clerkRoles');
const agencyCache = require('../lib/agencyCache');

async function findAgencyByOrgId(clerkOrgId) {
  let agency = await prisma.agency.findUnique({ where: { clerkOrgId } });
  if (agency) return agency;

  // Fallback for out-of-order delivery: the organization.created event hasn't
  // landed yet, so fetch the org directly and create the Agency row now.
  const org = await clerkClient.organizations.getOrganization({ organizationId: clerkOrgId });
  return prisma.agency.upsert({
    where: { clerkOrgId },
    update: {},
    create: { name: org.name, clerkOrgId },
  });
}

async function handleOrganizationCreated(data) {
  await prisma.agency.upsert({
    where: { clerkOrgId: data.id },
    update: { name: data.name },
    create: { name: data.name, clerkOrgId: data.id },
  });

  // Instance-level "creator becomes HR" config isn't reliable via the API,
  // so promote the creating member explicitly. This fires an
  // organizationMembership.updated event that syncs the role afterward.
  if (data.created_by) {
    await clerkClient.organizations
      .updateOrganizationMembership({
        organizationId: data.id,
        userId: data.created_by,
        role: 'org:hr',
      })
      .catch((err) => console.error('[webhook] failed to promote org creator to HR:', err.message));
  }
}

async function handleOrganizationUpdated(data) {
  await prisma.agency.updateMany({ where: { clerkOrgId: data.id }, data: { name: data.name } });
  agencyCache.invalidateAll(); // rare event; cheapest correct move is a full drop
}

async function handleMembershipUpsert(data) {
  const role = ORG_ROLE_TO_ROLE[data.role];
  if (!role) {
    console.warn(`[webhook] unmapped org role "${data.role}" for user ${data.public_user_data?.user_id} — skipping`);
    return;
  }

  const agency = await findAgencyByOrgId(data.organization.id);
  const clerkUserId = data.public_user_data.user_id;
  const clerkUser = await clerkClient.users.getUser(clerkUserId);
  const email = clerkUser.emailAddresses.find((e) => e.id === clerkUser.primaryEmailAddressId)?.emailAddress
    ?? clerkUser.emailAddresses[0]?.emailAddress;
  const name = [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(' ') || email;

  if (!email) {
    console.warn(`[webhook] Clerk user ${clerkUserId} has no email address — skipping`);
    return;
  }

  const user = await prisma.user.upsert({
    where: { clerkUserId },
    update: { agencyId: agency.id, role, name, email, status: 'ACTIVE' },
    create: { clerkUserId, agencyId: agency.id, role, name, email, status: 'ACTIVE' },
  });

  // Whole-Workforce Phase 1: apply any HR-staged employment data for THIS
  // agency + email. Idempotent under duplicate delivery (consumedAt guard);
  // an unrelated agency's pending row is never matched.
  await consumePendingEmployee(user, agency.id, email).catch((err) =>
    console.error('[webhook] failed to apply pending employment data:', err.message),
  );
}

/**
 * Merge a staged PendingEmployee onto a freshly-created/updated User.
 * - matched by (agencyId, lower-cased email) AND consumedAt IS NULL
 * - a staged department / job title / location / line manager that was removed
 *   or deactivated between invite and acceptance is skipped (never an FK failure)
 *   and the row is marked needsReview so HR can finish the setup
 * - a clashing employee number is skipped the same way
 * - always marks the row consumed, so a webhook retry is a no-op
 * The User + auth membership are always created regardless.
 */
async function consumePendingEmployee(user, agencyId, email) {
  const pending = await prisma.pendingEmployee.findFirst({
    where: { agencyId, email: email.toLowerCase(), consumedAt: null },
  });
  if (!pending) return;

  const data = {};
  const skipped = [];
  if (pending.contractedHours != null) data.contractedHours = pending.contractedHours;
  if (pending.workPatternType) data.workPatternType = pending.workPatternType;
  if (pending.employmentType) data.employmentType = pending.employmentType;
  if (pending.employeeNumber) data.employeeNumber = pending.employeeNumber;

  if (pending.departmentId) {
    const d = await prisma.department.findFirst({ where: { id: pending.departmentId, agencyId, active: true }, select: { id: true } });
    if (d) data.departmentId = d.id;
    else skipped.push('department (no longer available)');
  }
  if (pending.jobTitleId) {
    const j = await prisma.jobTitle.findFirst({ where: { id: pending.jobTitleId, agencyId, active: true }, select: { id: true } });
    if (j) data.jobTitleId = j.id;
    else skipped.push('job title (no longer available)');
  }
  if (pending.primaryLocationId) {
    const l = await prisma.location.findFirst({ where: { id: pending.primaryLocationId, agencyId, active: true }, select: { id: true } });
    if (l) data.primaryLocationId = l.id;
    else skipped.push('primary location (no longer available)');
  }
  if (pending.lineManagerId) {
    const m = pending.lineManagerId === user.id
      ? null
      : await prisma.user.findFirst({ where: { id: pending.lineManagerId, agencyId, status: 'ACTIVE' }, select: { id: true } });
    if (m) data.lineManagerId = m.id;
    else skipped.push('line manager (no longer valid)');
  }

  const finish = async (extraSkips = []) => {
    const allSkips = [...skipped, ...extraSkips];
    await prisma.pendingEmployee.update({
      where: { id: pending.id },
      data: {
        consumedAt: new Date(),
        needsReview: allSkips.length > 0,
        reviewNote: allSkips.length > 0
          ? `Onboarding applied without: ${allSkips.join('; ')}. HR to set these on the user.`
          : null,
      },
    });
    if (allSkips.length > 0) {
      console.warn(`[webhook] pending employee for ${email} in agency ${agencyId} needs HR review: ${allSkips.join('; ')}`);
    }
  };

  try {
    if (Object.keys(data).length > 0) {
      await prisma.user.update({ where: { id: user.id }, data });
    }
    await finish();
  } catch (err) {
    // A duplicate employee number (someone else took it since the invite) must
    // not brick onboarding — apply everything else, leave the number unset, and
    // flag the row for HR.
    if (err.code === 'P2002') {
      const { employeeNumber, ...rest } = data;
      if (Object.keys(rest).length > 0) await prisma.user.update({ where: { id: user.id }, data: rest });
      await finish([`employee number "${employeeNumber}" (already in use)`]);
      return;
    }
    throw err;
  }
}

async function handleMembershipDeleted(data) {
  await prisma.user.updateMany({
    where: { clerkUserId: data.public_user_data.user_id },
    data: { status: 'DEACTIVATED', deactivatedAt: new Date(), deactivationReason: 'Removed from Clerk organization' },
  });
}

async function handleUserDeleted(data) {
  await prisma.user.updateMany({
    where: { clerkUserId: data.id },
    data: { status: 'DEACTIVATED', deactivatedAt: new Date(), deactivationReason: 'Clerk account deleted' },
  });
}

/**
 * `user.updated` — keep the local User's name/email in step with Clerk when a
 * person edits their profile. Touches name/email ONLY: role, agency membership
 * and status are owned by the organizationMembership.* handlers and must never
 * be changed here. A blank Clerk name is not written over an existing good name
 * (that would recreate the "name === email" state the self-heal exists to fix).
 * If the user has no local row yet, updateMany matches nothing and a later
 * organizationMembership.created will create them.
 */
async function handleUserUpdated(data) {
  const clerkUserId = data.id;
  if (!clerkUserId) return;

  const emails = data.email_addresses || [];
  const email =
    emails.find((e) => e.id === data.primary_email_address_id)?.email_address ??
    emails[0]?.email_address ??
    null;
  const realName = [data.first_name, data.last_name].filter(Boolean).join(' ').trim();

  const patch = {};
  if (realName) patch.name = realName;
  if (email) patch.email = email;
  if (Object.keys(patch).length === 0) return;

  await prisma.user.updateMany({ where: { clerkUserId }, data: patch });
}

async function receive(req, res) {
  let event;
  try {
    event = await verifyWebhook(req);
  } catch (err) {
    console.error('[webhook] signature verification failed:', err.message);
    return res.status(400).send('Invalid signature');
  }

  try {
    switch (event.type) {
      case 'organization.created':
        await handleOrganizationCreated(event.data);
        break;
      case 'organization.updated':
        await handleOrganizationUpdated(event.data);
        break;
      case 'organizationMembership.created':
      case 'organizationMembership.updated':
        await handleMembershipUpsert(event.data);
        break;
      case 'organizationMembership.deleted':
        await handleMembershipDeleted(event.data);
        break;
      case 'user.updated':
        await handleUserUpdated(event.data);
        break;
      case 'user.deleted':
        await handleUserDeleted(event.data);
        break;
      default:
        break;
    }
    res.status(200).send('OK');
  } catch (err) {
    console.error(`[webhook] handler error for ${event.type}:`, err);
    // Acknowledge anyway — a bad event shouldn't loop forever on Svix retries.
    res.status(200).send('Handled with errors');
  }
}

module.exports = { receive };
