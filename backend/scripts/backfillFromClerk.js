require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const clerkClient = require('../src/utils/clerkClient');
const { ORG_ROLE_TO_ROLE } = require('../src/utils/clerkRoles');

const prisma = new PrismaClient();

const DRY_RUN = process.argv.includes('--dry-run');
const PAGE = 100;

function log(...args) {
  console.log(...args);
}

async function listAllOrganizations() {
  const orgs = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data } = await clerkClient.organizations.getOrganizationList({ limit: PAGE, offset });
    orgs.push(...data);
    if (data.length < PAGE) break;
  }
  return orgs;
}

async function listAllMemberships(organizationId) {
  const members = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data } = await clerkClient.organizations.getOrganizationMembershipList({
      organizationId,
      limit: PAGE,
      offset,
    });
    members.push(...data);
    if (data.length < PAGE) break;
  }
  return members;
}

function nameFromClerkUser(clerkUser, fallbackEmail) {
  const joined = [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(' ').trim();
  return joined || fallbackEmail;
}

function primaryEmail(clerkUser) {
  return (
    clerkUser.emailAddresses.find((e) => e.id === clerkUser.primaryEmailAddressId)?.emailAddress
    ?? clerkUser.emailAddresses[0]?.emailAddress
    ?? null
  );
}

async function backfill() {
  const summary = { agencies: 0, users: 0, skipped: [] };
  const orgs = await listAllOrganizations();
  log(`Found ${orgs.length} Clerk organization(s).`);

  for (const org of orgs) {
    log(`\n▶ ${org.name}  (${org.id})`);

    let agency = await prisma.agency.findUnique({ where: { clerkOrgId: org.id } });
    if (!agency) {
      if (DRY_RUN) {
        log(`  would CREATE agency "${org.name}"`);
      } else {
        agency = await prisma.agency.create({ data: { name: org.name, clerkOrgId: org.id } });
        log(`  created agency ${agency.id}`);
      }
      summary.agencies += 1;
    } else if (agency.name !== org.name) {
      if (!DRY_RUN) {
        await prisma.agency.update({ where: { id: agency.id }, data: { name: org.name } });
      }
      log(`  renamed agency -> "${org.name}"`);
    } else {
      log(`  agency already linked (${agency.id})`);
    }

    const agencyId = agency?.id ?? '(dry-run)';
    const memberships = await listAllMemberships(org.id);

    for (const m of memberships) {
      const clerkUserId = m.publicUserData?.userId;
      const identifier = m.publicUserData?.identifier ?? clerkUserId;
      const role = ORG_ROLE_TO_ROLE[m.role];

      if (!clerkUserId) {
        summary.skipped.push(`${identifier}: membership has no user id (still a pending invite?)`);
        log(`  ⏭  ${identifier} — pending invite, skipped`);
        continue;
      }
      if (!role) {
        summary.skipped.push(`${identifier}: unmapped org role "${m.role}"`);
        log(`  ⏭  ${identifier} — unmapped org role "${m.role}", skipped`);
        continue;
      }

      const clerkUser = await clerkClient.users.getUser(clerkUserId);
      const email = primaryEmail(clerkUser);
      if (!email) {
        summary.skipped.push(`${identifier}: Clerk user has no email address`);
        log(`  ⏭  ${identifier} — no email address, skipped`);
        continue;
      }
      const name = nameFromClerkUser(clerkUser, email);

      const existing = await prisma.user.findUnique({ where: { clerkUserId } });
      if (DRY_RUN) {
        log(`  ${existing ? 'would UPDATE' : 'would CREATE'} ${email} as ${role}`);
        summary.users += 1;
        continue;
      }

      await prisma.user.upsert({
        where: { clerkUserId },
        update: { agencyId: agency.id, role, name, email, status: 'ACTIVE' },
        create: { clerkUserId, agencyId: agency.id, role, name, email, status: 'ACTIVE' },
      });
      log(`  ${existing ? 'updated' : 'created'} ${email} as ${role}`);
      summary.users += 1;
    }
  }

  return summary;
}

backfill()
  .then((summary) => {
    log('\n─────────────────────────────');
    log(`${DRY_RUN ? '[dry run] ' : ''}agencies touched: ${summary.agencies}, users touched: ${summary.users}`);
    if (summary.skipped.length) {
      log(`skipped ${summary.skipped.length}:`);
      summary.skipped.forEach((s) => log(`  - ${s}`));
    }
  })
  .catch((err) => {
    console.error('\nBackfill failed:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
