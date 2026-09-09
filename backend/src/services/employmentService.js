/**
 * Whole-Workforce Phase 1 — employment metadata for a User.
 *
 * Validates that department / job title / primary location / line manager all
 * belong to the SAME agency, that a user is never their own line manager, and
 * builds the Prisma `data` patch. Employee-number uniqueness is enforced by the
 * DB (`@@unique([agencyId, employeeNumber])`); this maps the P2002 to a 409.
 *
 * JobTitle.departmentId is a SUGGESTION only — if HR chooses a different
 * department it is honoured, never silently overwritten.
 */
const prisma = require('../lib/prisma');

function httpErr(message, statusCode, code) {
  const e = new Error(message);
  e.statusCode = statusCode;
  if (code) e.code = code;
  return e;
}

const EMPLOYMENT_KEYS = [
  'employeeNumber', 'departmentId', 'jobTitleId', 'primaryLocationId',
  'lineManagerId', 'workPatternType', 'employmentType',
];

/** Normalise "" -> null for the nullable string/enum fields. */
function norm(v) {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v === 'string') {
    const t = v.trim();
    return t === '' ? null : t;
  }
  return v;
}

/**
 * @param body        the request body (may contain any subset of EMPLOYMENT_KEYS)
 * @param agencyId     the agency all references must belong to
 * @param opts.userId  the user being updated (to reject self-management); omit on create
 * Returns a Prisma `data` object with only the keys that were present.
 */
async function buildEmploymentData(body, agencyId, { userId = null } = {}) {
  const data = {};
  for (const k of EMPLOYMENT_KEYS) {
    if (body[k] === undefined) continue;
    data[k] = norm(body[k]);
  }
  if (Object.keys(data).length === 0) return data;

  if ('departmentId' in data && data.departmentId) {
    const d = await prisma.department.findFirst({ where: { id: data.departmentId, agencyId }, select: { id: true } });
    if (!d) throw httpErr('That department is not in your agency', 400, 'INVALID_DEPARTMENT');
  }
  if ('jobTitleId' in data && data.jobTitleId) {
    const j = await prisma.jobTitle.findFirst({ where: { id: data.jobTitleId, agencyId }, select: { id: true } });
    if (!j) throw httpErr('That job title is not in your agency', 400, 'INVALID_JOB_TITLE');
  }
  if ('primaryLocationId' in data && data.primaryLocationId) {
    const l = await prisma.location.findFirst({ where: { id: data.primaryLocationId, agencyId }, select: { id: true } });
    if (!l) throw httpErr('That location is not in your agency', 400, 'INVALID_LOCATION');
  }
  if ('lineManagerId' in data && data.lineManagerId) {
    if (userId && data.lineManagerId === userId) {
      throw httpErr('A person cannot be their own line manager', 400, 'SELF_LINE_MANAGER');
    }
    const m = await prisma.user.findFirst({ where: { id: data.lineManagerId, agencyId }, select: { id: true } });
    if (!m) throw httpErr('That line manager is not in your agency', 400, 'INVALID_LINE_MANAGER');
  }
  return data;
}

/** Map the DB employee-number collision to a friendly 409. */
function rethrowP2002(err) {
  if (err && err.code === 'P2002' && Array.isArray(err.meta?.target) && err.meta.target.includes('employeeNumber')) {
    throw httpErr('That employee number is already used in your agency', 409, 'DUPLICATE_EMPLOYEE_NUMBER');
  }
  throw err;
}

module.exports = { EMPLOYMENT_KEYS, buildEmploymentData, rethrowP2002 };
