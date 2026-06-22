const { forbidden } = require('../utils/response');

const ROLE_RANK = { WORKER: 1, TEAM_LEADER: 2, MANAGER: 3, HR: 4 };

const allow = (...roles) => (req, res, next) => {
  if (!roles.includes(req.user?.role)) return forbidden(res);
  next();
};

const atLeast = (minRole) => (req, res, next) => {
  const userRank = ROLE_RANK[req.user?.role] || 0;
  const minRank = ROLE_RANK[minRole] || 0;
  if (userRank < minRank) return forbidden(res);
  next();
};

module.exports = { allow, atLeast };
