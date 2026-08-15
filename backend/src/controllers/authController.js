const authService = require('../services/authService');
const { auditContext, createAuditLog } = require('../services/auditService');
const { agencyIdFor } = require('../utils/agency');
const { ok, fail, unauthorized, created } = require('../utils/response');

async function login(req, res) {
  const { email, password } = req.body;
  if (!email || !password) return fail(res, 'Email and password required');

  const result = await authService.login(email, password);
  if (!result) return unauthorized(res, 'Invalid credentials');

  ok(res, result);
}

async function refresh(req, res) {
  const { refreshToken } = req.body;
  if (!refreshToken) return fail(res, 'Refresh token required');

  try {
    const result = await authService.refresh(refreshToken);
    if (!result) return unauthorized(res, 'Invalid refresh token');
    ok(res, result);
  } catch {
    unauthorized(res, 'Invalid refresh token');
  }
}

async function register(req, res) {
  try {
    const user = await authService.createUser(req.body, agencyIdFor(req));
    await createAuditLog({
      ...auditContext(req),
      action: 'USER_CREATED',
      entityType: 'User',
      entityId: user.id,
      newValue: user,
    });
    created(res, user);
  } catch (err) {
    if (err.code === 'P2002') return fail(res, 'Email already in use');
    throw err;
  }
}

module.exports = { login, refresh, register };
