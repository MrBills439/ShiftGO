/**
 * Whole-Workforce — per-agency automatic employee IDs.
 *
 * Format: `${PREFIX}-${n}` where n is left-padded to a MINIMUM of 4 digits and
 * NOT capped (1 -> PIP-0001, 9999 -> PIP-9999, 10000 -> PIP-10000).
 *
 * Reservation is concurrency-safe: a single atomic
 *   UPDATE "Agency" SET "employeeIdNextNumber" = "employeeIdNextNumber" + 1 RETURNING
 * (Prisma `{ increment: 1 }`). Postgres row-locks the agency row, so two HR
 * users onboarding at the same moment get two distinct numbers — never the
 * same one. The counter only moves forward. A number left unused by a failed
 * Clerk invite just leaves a gap; the counter is never decremented or reused.
 */
const prisma = require('../lib/prisma');

function httpErr(message, statusCode, code) {
  const e = new Error(message);
  e.statusCode = statusCode;
  if (code) e.code = code;
  return e;
}

const PREFIX_RE = /^[A-Z0-9]{2,8}$/;

/** Normalise an HR-entered prefix: trim the ends, uppercase. `null`/'' clears it
 *  (returns null). Any interior whitespace or punctuation, or a length outside
 *  2–8, throws 400 INVALID_EMPLOYEE_ID_PREFIX. */
function normalizeEmployeeIdPrefix(raw) {
  if (raw == null) return null;
  const s = String(raw).trim().toUpperCase();
  if (s === '') return null;
  if (!PREFIX_RE.test(s)) {
    throw httpErr(
      'Employee ID prefix must be 2–8 letters or digits, with no spaces or punctuation.',
      400, 'INVALID_EMPLOYEE_ID_PREFIX',
    );
  }
  return s;
}

/** `PIP` + 1 -> `PIP-0001`; `PIP` + 10000 -> `PIP-10000`. */
function formatEmployeeId(prefix, n) {
  return `${prefix}-${String(n).padStart(4, '0')}`;
}

/** The id the NEXT auto-generated hire would receive — for a read-only UI
 *  preview. `null` when no prefix is configured. Consumes nothing. */
function previewNextEmployeeId(agency) {
  if (!agency || !agency.employeeIdPrefix) return null;
  return formatEmployeeId(agency.employeeIdPrefix, agency.employeeIdNextNumber ?? 1);
}

/**
 * Reserve and return the next employee ID for `agencyId`.
 *  - 400 NO_EMPLOYEE_ID_PREFIX if the agency has no prefix configured.
 *  - If the formatted candidate collides with a MANUALLY assigned employeeNumber
 *    (a User, or a live PendingEmployee) it is skipped and the next number tried,
 *    so the sequence can never hand back a duplicate.
 */
async function generateEmployeeId(agencyId, client = prisma) {
  const agency = await client.agency.findUnique({
    where: { id: agencyId }, select: { employeeIdPrefix: true },
  });
  const prefix = agency && agency.employeeIdPrefix;
  if (!prefix) {
    throw httpErr(
      'Set an Employee ID prefix in Admin → General before adding employees.',
      400, 'NO_EMPLOYEE_ID_PREFIX',
    );
  }

  for (let i = 0; i < 50; i++) {
    const updated = await client.agency.update({
      where: { id: agencyId },
      data: { employeeIdNextNumber: { increment: 1 } },
      select: { employeeIdNextNumber: true },
    });
    const candidate = formatEmployeeId(prefix, updated.employeeIdNextNumber - 1);
    const [userClash, pendingClash] = await Promise.all([
      client.user.findFirst({ where: { agencyId, employeeNumber: candidate }, select: { id: true } }),
      client.pendingEmployee.findFirst({
        where: { agencyId, employeeNumber: candidate, consumedAt: null }, select: { id: true },
      }),
    ]);
    if (!userClash && !pendingClash) return candidate;
  }
  throw httpErr(
    'Could not allocate a free Employee ID — resolve manually assigned IDs that clash with the sequence.',
    500, 'EMPLOYEE_ID_UNAVAILABLE',
  );
}

module.exports = {
  PREFIX_RE,
  normalizeEmployeeIdPrefix,
  formatEmployeeId,
  previewNextEmployeeId,
  generateEmployeeId,
};
