const { verifyAccess } = require('../utils/jwt');
const { unauthorized } = require('../utils/response');

module.exports = (req, res, next) => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return unauthorized(res);

  const token = header.slice(7);
  try {
    req.user = verifyAccess(token);
    next();
  } catch {
    unauthorized(res, 'Invalid or expired token');
  }
};
