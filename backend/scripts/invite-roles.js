require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const clerkClient = require('../src/utils/clerkClient');
const { ROLE_TO_ORG_ROLE } = require('../src/utils/clerkRoles');

const prisma = new PrismaClient();

const AGENCY_ID = 'cmt0jfmoc000bl6ccykbw1wr6';

const invites = [
  { email: 'uglydemon439+staff@gmail.com', role: 'WORKER' },
  { email: 'uglydemon439+teamlead@gmail.com', role: 'TEAM_LEADER' },
  { email: 'feddybills17.felix@gmail.com', role: 'HR' },
];

async function main() {
  const agency = await prisma.agency.findUnique({ where: { id: AGENCY_ID }, select: { clerkOrgId: true } });
  if (!agency?.clerkOrgId) throw new Error('Agency not linked to Clerk org');

  for (const { email, role } of invites) {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      console.log(`SKIP ${email} — already exists as ${existing.role}`);
      continue;
    }
    try {
      // No inviterUserId: the org:hr custom role currently lacks the Clerk
      // "manage memberships" permission (a Dashboard config gap, not a code
      // issue), which makes an attributed invite 403. Omitting it sends the
      // invite as the API key itself instead of impersonating a member.
      const invitation = await clerkClient.organizations.createOrganizationInvitation({
        organizationId: agency.clerkOrgId,
        emailAddress: email,
        role: ROLE_TO_ORG_ROLE[role],
      });
      console.log(`OK   ${email} -> ${role} (invitation ${invitation.id}, status ${invitation.status})`);
    } catch (err) {
      console.log(`FAIL ${email} -> ${role}:`, err.errors ? JSON.stringify(err.errors) : err.message);
    }
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
