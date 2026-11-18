const prisma = require('../lib/prisma');
const config = require('../config');
const { unauthorized } = require('../utils/response');

const userSelect = {
  id: true, agencyId: true, role: true, status: true, name: true, email: true, twoFactorEnabled: true,
};

// HR and managers can see DBS, right-to-work and resident data, so they must
// turn on two-step verification first. Until then only these calls work —
// enough for the web app to load their profile and show the setup screen.
const ROLES_REQUIRING_2FA = new Set(['HR', 'MANAGER']);
const ALLOWED_WITHOUT_2FA = [
  { method: 'GET', path: /^\/users\/me$/ },
  { method: 'GET', path: /^\/privacy-notice$/ },
  { method: 'POST', path: /^\/privacy-notice\/acknowledge$/ },
];

function allowedWithout2fa(req) {
  const path = `${req.baseUrl}${req.path}`.replace(/\/$/, '');
  return ALLOWED_WITHOUT_2FA.some((r) => r.method === req.method && r.path.test(path));
}

/** Who is calling? Better Auth session (cookie or bearer) in the app; a signed
 *  test JWT under Jest (see tests/*.test.js tokenFor()). */
async function resolveUserId(req) {
  if (process.env.JEST_WORKER_ID !== undefined) {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) return null;
    const { verifyAccess } = require('../utils/jwt');
    return verifyAccess(header.slice(7)).id;
  }
  const { getAuth } = require('../auth');
  const { fromNodeHeaders } = require('better-auth/node');
  const session = await getAuth().api.getSession({ headers: fromNodeHeaders(req.headers) });
  return session?.user?.id ?? null;
}

module.exports = async (req, res, next) => {
  let userId;
  try {
    userId = await resolveUserId(req);
  } catch {
    return unauthorized(res, 'Invalid or expired session');
  }
  if (!userId) return unauthorized(res);

  try {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: userSelect });
    if (!user || user.status === 'DEACTIVATED') {
      return unauthorized(res, 'User account is deactivated');
    }
    if (
      config.auth.require2faForAdmins
      && ROLES_REQUIRING_2FA.has(user.role)
      && !user.twoFactorEnabled
      && !allowedWithout2fa(req)
    ) {
      return res.status(403).json({
        success: false,
        code: 'TWO_FACTOR_REQUIRED',
        message: 'Turn on two-step verification to continue.',
      });
    }
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
};

module.exports.ROLES_REQUIRING_2FA = ROLES_REQUIRING_2FA;
