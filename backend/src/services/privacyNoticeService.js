/**
 * Staff privacy notice (UK GDPR Art. 13/14).
 *
 * Each agency is the data CONTROLLER for its staff; ShiftGO is its processor.
 * An agency can publish its own notice (Agency.privacyNoticeText). Until it
 * does, staff see DEFAULT_TEMPLATE with the agency's name filled in.
 *
 * DEFAULT_TEMPLATE is a starting draft written to match what this codebase
 * actually does (GPS only at clock-in/out and while clocked in, retention
 * periods, processors). It is NOT legal advice: each agency should have its
 * data protection lead review it and publish its own version.
 *
 * Versioning: the default template has a fixed version; a custom notice's
 * version is derived from when it was last edited. Any change of version means
 * every user is asked to acknowledge again.
 */
const prisma = require('../lib/prisma');

const DEFAULT_VERSION = 'shiftgo-default-2026-11';
const MAX_NOTICE_LENGTH = 50_000;

const DEFAULT_TEMPLATE = `# How {{agency}} uses your information

{{agency}} ("we") uses LeafRota (a product of PIPCoRD) to run rotas, attendance, leave and staff compliance. We decide how your information is used (we are the "controller"). PIPCoRD, which provides LeafRota, stores and processes it for us (our "processor").

## What we hold about you
- Identity and contact details: name, email, phone, address, emergency contact.
- Employment details: job title, department, contracted hours, employee number, start date.
- Rota and attendance: your shifts, clock-in and clock-out times, timesheets, leave.
- Location: your phone's location when you clock in or out, and every minute or so while you are clocked in, to confirm you are at the service. Location is never collected when you are not clocked in. Monitoring stops when you clock out.
- Compliance: right-to-work share code and proof document, DBS check result, training records.

## Why we use it (lawful basis)
- To run your employment contract: rotas, pay-related timesheets, leave.
- Because the law requires it: right-to-work checks, working-time and payroll records.
- Our legitimate interests: confirming attendance and keeping people we support safe.
- DBS information is criminal-offence data. We use it only for safer-recruitment checks required in care, under the employment conditions of the Data Protection Act 2018.
We do not rely on your consent, so you cannot be refused work for asking questions about this notice.

## Who sees it
- Your managers and HR see what they need for their role. Team leaders see only the staff at their own services.
- Our service providers: PIPCoRD (LeafRota) and its hosting, email delivery (Resend), notifications (Google Firebase, Expo) and error reporting. Some are based in the United States. Transfers are covered by the UK's approved safeguards.
We never sell your information.

## How long we keep it
- Exact GPS coordinates: {{gpsDays}} days. After that we keep only whether you were on site.
- Right-to-work records: for your employment and 2 years after you leave.
- Timesheet and payroll records: 6 years, as the law requires.

## Your rights
You can ask to see your information (in the app: Profile, Download my data), to correct it, to have it deleted or restricted, and to object. Some records must be kept by law, so deletion requests go to HR, who will tell you what can be removed.
Contact HR at {{agency}} with any question. If you are unhappy with our answer you can complain to the Information Commissioner's Office (ico.org.uk, 0303 123 1113).
`;

function versionFor(agency) {
  return agency.privacyNoticeText && agency.privacyNoticeUpdatedAt
    ? `custom-${agency.privacyNoticeUpdatedAt.toISOString()}`
    : DEFAULT_VERSION;
}

function renderDefault(agency) {
  const gpsDays = Number.parseInt(process.env.GPS_RETENTION_DAYS || '', 10) || 90;
  return DEFAULT_TEMPLATE.replaceAll('{{agency}}', agency.name).replaceAll('{{gpsDays}}', String(gpsDays));
}

async function loadAgency(agencyId) {
  return prisma.agency.findUnique({
    where: { id: agencyId },
    select: { id: true, name: true, privacyNoticeText: true, privacyNoticeUpdatedAt: true },
  });
}

/** The notice the user must acknowledge, plus whether they already have. */
async function currentNoticeFor(user) {
  const agency = await loadAgency(user.agencyId);
  const version = versionFor(agency);
  const row = await prisma.user.findUnique({
    where: { id: user.id }, select: { privacyNoticeVersion: true, privacyNoticeAcknowledgedAt: true },
  });
  return {
    version,
    isDefault: !agency.privacyNoticeText,
    updatedAt: agency.privacyNoticeUpdatedAt,
    text: agency.privacyNoticeText || renderDefault(agency),
    acknowledged: row?.privacyNoticeVersion === version,
    acknowledgedAt: row?.privacyNoticeVersion === version ? row.privacyNoticeAcknowledgedAt : null,
  };
}

async function acknowledge(user, version) {
  const notice = await currentNoticeFor(user);
  if (version !== notice.version) {
    const err = new Error('The privacy notice has changed. Please read the latest version.');
    err.statusCode = 409;
    err.code = 'NOTICE_VERSION_CHANGED';
    throw err;
  }
  const acknowledgedAt = new Date();
  await prisma.user.update({
    where: { id: user.id },
    data: { privacyNoticeVersion: version, privacyNoticeAcknowledgedAt: acknowledgedAt },
  });
  return { ...notice, acknowledged: true, acknowledgedAt };
}

/** HR publishes the agency's own notice; null/empty text returns to the template. */
async function setAgencyNotice(agencyId, text) {
  const clean = typeof text === 'string' ? text.trim() : '';
  if (clean.length > MAX_NOTICE_LENGTH) {
    const err = new Error(`The notice must be ${MAX_NOTICE_LENGTH.toLocaleString('en-GB')} characters or fewer.`);
    err.statusCode = 400;
    throw err;
  }
  await prisma.agency.update({
    where: { id: agencyId },
    data: clean ? { privacyNoticeText: clean, privacyNoticeUpdatedAt: new Date() } : { privacyNoticeText: null, privacyNoticeUpdatedAt: null },
  });
}

module.exports = { currentNoticeFor, acknowledge, setAgencyNotice, DEFAULT_VERSION, DEFAULT_TEMPLATE, MAX_NOTICE_LENGTH };
