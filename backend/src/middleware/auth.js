const { verifyAccess } = require('../utils/jwt');
const { PrismaClient } = require('@prisma/client');
const { unauthorized } = require('../utils/response');

const prisma = new PrismaClient();

module.exports = async (req, res, next) => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return unauthorized(res);

  const token = header.slice(7);
  let decoded;
  try {
    decoded = verifyAccess(token);
  } catch {
    return unauthorized(res, 'Invalid or expired token');
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: decoded.id },
      select: { id: true, agencyId: true, role: true, status: true, name: true, email: true },
    });
    if (!user || user.status === 'DEACTIVATED') {
      return unauthorized(res, 'User account is deactivated');
    }
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
};
