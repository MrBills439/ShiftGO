/**
 * Whole-Workforce Phase 1 — employment metadata for a User.
 *
 * Validates that department / job title / primary location / line manager all
 * belong to the SAME agency, that a user is never their own line manager, and
 * builds the Prisma `data` patch. Employee-number uniqueness is enforced by the
 * DB (`@@unique([agencyId, employeeNumber])`); this maps the P2002 to a 409.
 *
 * Department ↔ Job Title consistency: when HR actively sets a department and/or
 * a job title in one request, the job title must belong to that department —
 * unless the job title has no department (a legacy / unassigned title, which
 * fits anywhere). Mismatches created later by re-parenting the JobTitle record
 * itself are NOT retro-enforced: they never mutate the employee.
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
async function buildEmploymentData(body, agencyId, { userId = null, existing = null } = {}) {
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
  let jobTitleRow;
  if ('jobTitleId' in data && data.jobTitleId) {
    jobTitleRow = await prisma.jobTitle.findFirst({
      where: { id: data.jobTitleId, agencyId }, select: { id: true, departmentId: true },
    });
    if (!jobTitleRow) throw httpErr('That job title is not in your agency', 400, 'INVALID_JOB_TITLE');
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

  // Department ↔ Job Title consistency. The "effective" pair is the request
  // value where present, otherwise the user's current value (null on create).
  // Only enforced when HR is actually CHANGING the pairing: a request that
  // re-sends the identical department + job title (the edit form echoes both
  // fields on every save) is not a change and must not be retro-rejected — a
  // mismatch introduced later by re-parenting the JobTitle record never mutates
  // or blocks the employee. A job title with no department fits any department
  // (legacy / unassigned).
  if ('departmentId' in data || 'jobTitleId' in data) {
    const curDeptId = existing ? (existing.departmentId ?? null) : null;
    const curJobId = existing ? (existing.jobTitleId ?? null) : null;
    const effectiveDeptId = 'departmentId' in data ? data.departmentId : curDeptId;
    const effectiveJobId = 'jobTitleId' in data ? data.jobTitleId : curJobId;
    const pairingChanged = !existing || effectiveDeptId !== curDeptId || effectiveJobId !== curJobId;

    if (pairingChanged && effectiveDeptId && effectiveJobId) {
      let jobTitleDeptId;
      if (jobTitleRow && jobTitleRow.id === effectiveJobId) {
        jobTitleDeptId = jobTitleRow.departmentId;
      } else {
        const jt = await prisma.jobTitle.findFirst({
          where: { id: effectiveJobId, agencyId }, select: { departmentId: true },
        });
        jobTitleDeptId = jt ? jt.departmentId : null;
      }
      if (jobTitleDeptId != null && jobTitleDeptId !== effectiveDeptId) {
        throw httpErr(
          'That job title belongs to a different department. Pick a job title from the selected department, or change the department.',
          400, 'JOB_TITLE_DEPARTMENT_MISMATCH',
        );
      }
    }
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
