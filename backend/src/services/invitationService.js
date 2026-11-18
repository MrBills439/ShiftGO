/**
 * Staff invitations (replaces Clerk organization invitations + the membership
 * webhook).
 *
 *   1. HR creates an employee  -> userController stages a PendingEmployee row
 *      (employment data) and calls sendInvitation(): a random one-time token is
 *      generated, ONLY its SHA-256 is stored, and the raw token is emailed as a
 *      link to the web app: WEB_APP_URL/accept-invite?token=...
 *   2. The person opens the link -> previewInvitation() shows who/which agency.
 *   3. They choose a password   -> acceptInvitation() creates, in ONE database
 *      transaction, the User (agency, role, employment data), the Better Auth
 *      credential (hashed password) and marks the invitation consumed.
 *
 * The token proves they own the email address, so emailVerified = true.
 * Tokens expire after INVITE_TTL_DAYS and work once.
 */
const crypto = require('crypto');
const prisma = require('../lib/prisma');
const config = require('../config');
// Called as email.sendEmail(...) so tests can stub delivery failures.
const email = require('../lib/email');

const INVITE_TTL_DAYS = 7;
const MIN_PASSWORD = 10;
const MAX_PASSWORD = 128;

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function httpErr(message, statusCode, code) {
  const e = new Error(message);
  e.statusCode = statusCode;
  if (code) e.code = code;
  return e;
}

/** Issue (or re-issue) the invitation email for a staged PendingEmployee. */
async function sendInvitation(pendingId) {
  const pending = await prisma.pendingEmployee.findUnique({
    where: { id: pendingId },
    include: { agency: { select: { name: true } } },
  });
  if (!pending) throw httpErr('Invitation not found', 404);

  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000);
  await prisma.pendingEmployee.update({
    where: { id: pending.id },
    data: { inviteTokenHash: sha256(token), expiresAt, consumedAt: null },
  });

  const url = `${config.webAppUrl}/accept-invite?token=${encodeURIComponent(token)}`;
  const greeting = pending.name ? `Hello ${pending.name},` : 'Hello,';
  const lines = [
    greeting,
    `${pending.agency.name} has invited you to ShiftGO, where you will see your shifts, clock in and out, and manage your leave.`,
    `Use the button below to choose your password. The link works once and expires in ${INVITE_TTL_DAYS} days.`,
  ];
  await email.sendEmail({
    to: pending.email,
    subject: `You're invited to ShiftGO by ${pending.agency.name}`,
    text: `${lines.join('\n\n')}\n\n${url}`,
    html: email.layout('You have been invited to ShiftGO', lines, { url, label: 'Choose your password' }),
  });
  return { email: pending.email, expiresAt };
}

async function findValidPending(token) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 200) return null;
  const pending = await prisma.pendingEmployee.findUnique({
    where: { inviteTokenHash: sha256(token) },
    include: { agency: { select: { name: true } } },
  });
  if (!pending || pending.consumedAt || pending.expiresAt < new Date()) return null;
  return pending;
}

/** What the accept page shows before the person sets a password. */
async function previewInvitation(token) {
  const pending = await findValidPending(token);
  if (!pending) throw httpErr('This invitation link is invalid or has expired. Ask your HR team to send a new one.', 410, 'INVITE_INVALID');
  return { email: pending.email, name: pending.name, agencyName: pending.agency.name, role: pending.role };
}

/**
 * Employment data staged by HR, re-validated now: a department / job title /
 * location / line manager removed or deactivated since the invite is skipped
 * (never an FK failure) and the row is flagged for HR review instead.
 */
async function employmentFromPending(pending, tx) {
  const data = {};
  const skipped = [];
  for (const key of ['contractedHours', 'workPatternType', 'employmentType', 'employeeNumber', 'phone', 'address',
    'employmentStartDate', 'emergencyContactName', 'emergencyContactPhone', 'emergencyContactRelationship']) {
    if (pending[key] != null) data[key] = pending[key];
  }
  const agencyId = pending.agencyId;
  const checks = [
    ['departmentId', 'department', () => tx.department.findFirst({ where: { id: pending.departmentId, agencyId, active: true }, select: { id: true } })],
    ['jobTitleId', 'job title', () => tx.jobTitle.findFirst({ where: { id: pending.jobTitleId, agencyId, active: true }, select: { id: true } })],
    ['primaryLocationId', 'primary location', () => tx.location.findFirst({ where: { id: pending.primaryLocationId, agencyId, active: true }, select: { id: true } })],
    ['lineManagerId', 'line manager', () => tx.user.findFirst({ where: { id: pending.lineManagerId, agencyId, status: 'ACTIVE' }, select: { id: true } })],
  ];
  for (const [field, label, find] of checks) {
    if (!pending[field]) continue;
    if (await find()) data[field] = pending[field];
    else skipped.push(`${label} (no longer available)`);
  }
  if (data.employeeNumber) {
    const clash = await tx.user.findFirst({ where: { agencyId, employeeNumber: data.employeeNumber }, select: { id: true } });
    if (clash) {
      skipped.push(`employee number "${data.employeeNumber}" (already in use)`);
      delete data.employeeNumber;
    }
  }
  return { data, skipped };
}

/**
 * Set the first password and create the account.
 * @param {{ token: string, password: string, name?: string, hashPassword: (p: string) => Promise<string> }} input
 *        hashPassword is Better Auth's own hasher (getAuth().$context.password.hash)
 *        so the credential verifies at sign-in.
 */
async function acceptInvitation({ token, password, name, hashPassword }) {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD || password.length > MAX_PASSWORD) {
    throw httpErr(`Choose a password of at least ${MIN_PASSWORD} characters.`, 400, 'WEAK_PASSWORD');
  }
  const pending = await findValidPending(token);
  if (!pending) throw httpErr('This invitation link is invalid or has expired. Ask your HR team to send a new one.', 410, 'INVITE_INVALID');

  const existing = await prisma.user.findUnique({ where: { email: pending.email }, select: { id: true } });
  if (existing) throw httpErr('An account with this email already exists. Sign in instead.', 409, 'ACCOUNT_EXISTS');

  // Name authority (unchanged from the Clerk era): a name HR entered — often
  // the legal name — wins; the person's own input is used only when HR left it
  // blank. They can still edit their display name later in their profile.
  const displayName = (pending.name && pending.name.trim()) || (typeof name === 'string' && name.trim()) || pending.email;
  const passwordHash = await hashPassword(password);

  return prisma.$transaction(async (tx) => {
    // Claim the invitation first: a concurrent second accept matches 0 rows.
    const claimed = await tx.pendingEmployee.updateMany({
      where: { id: pending.id, consumedAt: null },
      data: { consumedAt: new Date(), inviteTokenHash: null },
    });
    if (claimed.count !== 1) throw httpErr('This invitation has already been used.', 409, 'INVITE_USED');

    const { data, skipped } = await employmentFromPending(pending, tx);
    const user = await tx.user.create({
      data: {
        agencyId: pending.agencyId,
        email: pending.email,
        name: displayName.trim().slice(0, 120),
        role: pending.role,
        status: 'ACTIVE',
        emailVerified: true,
        ...data,
      },
      select: { id: true, email: true, name: true, role: true, agencyId: true },
    });
    await tx.account.create({
      data: {
        id: crypto.randomUUID(),
        accountId: user.id,
        providerId: 'credential',
        userId: user.id,
        password: passwordHash,
      },
    });
    if (skipped.length) {
      await tx.pendingEmployee.update({
        where: { id: pending.id },
        data: { needsReview: true, reviewNote: `Onboarding applied without: ${skipped.join('; ')}. HR to set these on the user.` },
      });
    }
    return { user, needsReview: skipped.length > 0 };
  });
}

module.exports = { sendInvitation, previewInvitation, acceptInvitation, INVITE_TTL_DAYS, sha256 };
