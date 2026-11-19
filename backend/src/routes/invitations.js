/**
 * Public invitation endpoints (no session yet — the token is the credential).
 *   GET  /invitations/:token          who / which agency, before setting a password
 *   POST /invitations/accept          { token, password, name? } -> creates the account
 * Rate-limited by IP: tokens are 256-bit random, but guessing is still throttled.
 */
const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const { clientIpKey } = require('../middleware/rateLimit');
const asyncHandler = require('../middleware/asyncHandler');
const { ok, created, fail } = require('../utils/response');
const invitations = require('../services/invitationService');
const { createAuditLog } = require('../services/auditService');

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number.parseInt(process.env.INVITE_RATE_LIMIT_MAX || '', 10) || 30,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.RATE_LIMIT_DISABLED === 'true',
  keyGenerator: (req) => clientIpKey(req),
});
router.use(limiter);

const sendError = (res, err) => {
  if (err.statusCode) return fail(res, err.message, err.statusCode, err.code ? { code: err.code } : {});
  throw err;
};

router.get('/:token', asyncHandler(async (req, res) => {
  try { ok(res, await invitations.previewInvitation(req.params.token)); } catch (err) { sendError(res, err); }
}));

router.post('/accept', asyncHandler(async (req, res) => {
  const { token, password, name } = req.body || {};
  try {
    // Better Auth's own password hasher, so the credential verifies at sign-in.
    // Injectable for tests that run without Better Auth.
    const hashPassword = router.hashPassword || (async (p) => {
      const { getAuth } = require('../auth');
      const ctx = await getAuth().$context;
      return ctx.password.hash(p);
    });
    const result = await invitations.acceptInvitation({ token, password, name, hashPassword });
    await createAuditLog({
      agencyId: result.user.agencyId, actorId: result.user.id, actorRole: result.user.role,
      action: 'INVITATION_ACCEPTED', entityType: 'User', entityId: result.user.id,
      newValue: { email: result.user.email, needsReview: result.needsReview },
      ipAddress: req.clientIp || req.ip, userAgent: req.get('user-agent') || null,
    });
    created(res, { email: result.user.email });
  } catch (err) { sendError(res, err); }
}));

module.exports = router;
