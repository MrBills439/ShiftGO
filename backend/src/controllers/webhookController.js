const { verifyWebhook } = require('@clerk/express/webhooks');
const prisma = require('../lib/prisma');
const clerkClient = require('../utils/clerkClient');
const { ORG_ROLE_TO_ROLE } = require('../utils/clerkRoles');

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

  await prisma.user.upsert({
    where: { clerkUserId },
    update: { agencyId: agency.id, role, name, email, status: 'ACTIVE' },
    create: { clerkUserId, agencyId: agency.id, role, name, email, status: 'ACTIVE' },
  });
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
