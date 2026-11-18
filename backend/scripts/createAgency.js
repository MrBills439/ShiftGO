#!/usr/bin/env node
/**
 * Platform owner only: create a new agency (customer) and invite its first HR
 * user. There is no public sign-up — this is the only way an agency is created.
 *
 *   node scripts/createAgency.js --name "Sunrise Care" --hr-email jo@sunrise.co.uk \
 *        --hr-name "Jo Smith" [--prefix SUN] [--timezone Europe/London] [--dry-run]
 *
 * The HR user receives an invitation email (link valid 7 days) to choose a
 * password; they then set up two-step verification on first sign-in and can
 * invite everyone else from the Staff page.
 * Needs the same environment as the server (DATABASE_URL, WEB_APP_URL,
 * RESEND_API_KEY, EMAIL_FROM). Run on Railway with: railway run node scripts/createAgency.js ...
 */
require('dotenv').config();

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

async function main() {
  const name = arg('name')?.trim();
  const hrEmail = arg('hr-email')?.trim().toLowerCase();
  const hrName = arg('hr-name')?.trim();
  const prefix = arg('prefix')?.trim().toUpperCase();
  const timezone = arg('timezone')?.trim() || 'Europe/London';
  const dryRun = process.argv.includes('--dry-run');

  if (!name || !hrEmail || !hrName) {
    throw new Error('Usage: --name "Agency name" --hr-email person@example.com --hr-name "Full Name" [--prefix ABC] [--dry-run]');
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(hrEmail)) throw new Error('--hr-email is not a valid email address');
  if (prefix && !/^[A-Z0-9]{2,8}$/.test(prefix)) throw new Error('--prefix must be 2-8 letters or digits');

  const prisma = require('../src/lib/prisma');
  const { sendInvitation } = require('../src/services/invitationService');

  const existingUser = await prisma.user.findUnique({ where: { email: hrEmail }, select: { id: true } });
  if (existingUser) throw new Error(`${hrEmail} already has a ShiftGO account.`);

  if (dryRun) {
    console.log(`[dry run] would create agency "${name}" (${timezone}${prefix ? `, IDs ${prefix}-0001` : ''}) and invite ${hrName} <${hrEmail}> as HR.`);
    await prisma.$disconnect();
    return;
  }

  const { agency, pending } = await prisma.$transaction(async (tx) => {
    const agency = await tx.agency.create({ data: { name, timezone, employeeIdPrefix: prefix || null } });
    const pending = await tx.pendingEmployee.create({
      data: {
        agencyId: agency.id, email: hrEmail, name: hrName, role: 'HR',
        expiresAt: new Date(Date.now() + 30 * 86_400_000),
      },
    });
    return { agency, pending };
  });

  try {
    const sent = await sendInvitation(pending.id);
    console.log(`Created agency "${agency.name}" (${agency.id}).`);
    console.log(`Invitation sent to ${sent.email}; the link expires ${sent.expiresAt.toISOString().slice(0, 10)}.`);
  } catch (err) {
    console.error(`Agency created (${agency.id}) but the invitation email failed: ${err.message}`);
    console.error('Fix email settings, then re-send by running this again with the same --hr-email after deleting the agency, or invite from the database.');
    process.exitCode = 1;
  }
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
