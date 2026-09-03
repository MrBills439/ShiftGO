const { verifyToken } = require('@clerk/backend');
const prisma = require('../lib/prisma');
const { unauthorized } = require('../utils/response');

const userSelect = { id: true, agencyId: true, clerkUserId: true, role: true, status: true, name: true, email: true };

module.exports = async (req, res, next) => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return unauthorized(res);

  const token = header.slice(7);
  let identity;
  try {
    if (process.env.JEST_WORKER_ID !== undefined) {
      // Under Jest (set by the runner itself, unaffected by a test reassigning
      // NODE_ENV mid-run), tests mint tokens directly via utils/jwt.js rather
      // than calling Clerk's network API — see tests/*.test.js `tokenFor()` helpers.
      const { verifyAccess } = require('../utils/jwt');
      const decoded = verifyAccess(token);
      identity = { where: { id: decoded.id } };
    } else {
      const claims = await verifyToken(token, { secretKey: process.env.CLERK_SECRET_KEY });
      identity = { where: { clerkUserId: claims.sub } };
    }
  } catch {
    return unauthorized(res, 'Invalid or expired token');
  }

  try {
    const user = await prisma.user.findUnique({ ...identity, select: userSelect });
    if (!user || user.status === 'DEACTIVATED') {
      return unauthorized(res, 'User account is deactivated');
    }
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
};
